'use strict';

const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs');
const { extractFeatures, createTrainingSamples } = require('./features');

const HORIZON = 6;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MIN_TRAINING_SAMPLES = 300;
const EPOCHS = 24;
const BATCH_SIZE = 32;

module.exports = function createTrainer({ dir }) {
  const modelDir = path.join(dir, 'ai', 'models');
  fs.mkdirSync(modelDir, { recursive: true });

  const models = new Map();
  const inflight = new Map();
  let ready;
  let forced = new Set();

  function modelPath(key) {
    const file = key.replace(/[^A-Z0-9_-]/gi, '_') + '.json';
    return path.join(modelDir, file);
  }

  function buildModel() {
    const model = tf.sequential();
    model.add(tf.layers.dense({ inputShape: [10], units: 16, activation: 'relu' }));
    model.add(tf.layers.dropout({ rate: 0.1 }));
    model.add(tf.layers.dense({ units: 8, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
    model.compile({ optimizer: tf.train.adam(0.003), loss: 'binaryCrossentropy' });
    return model;
  }

  function normalize(rows, mean, standardDeviation) {
    return rows.map(row => row.map((value, index) => (value - mean[index]) / standardDeviation[index]));
  }

  function load(key) {
    if (models.has(key)) return models.get(key);
    const file = modelPath(key);
    if (!fs.existsSync(file)) return null;

    let stored;
    try {
      stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`No se pudo leer el modelo TensorFlow ${key}: ${error.message}`);
    }
    if (stored.version !== 1 || !Array.isArray(stored.mean) || stored.mean.length !== 10 ||
        !Array.isArray(stored.std) || stored.std.length !== 10 || !Array.isArray(stored.weights) ||
        stored.weights.length !== 6) {
      throw new Error(`El modelo TensorFlow ${key} tiene un formato inválido.`);
    }
    const model = buildModel();
    const weights = stored.weights.map(item => tf.tensor(item.values, item.shape));
    try {
      model.setWeights(weights);
    } catch (error) {
      model.dispose();
      throw new Error(`No se pudo restaurar el modelo TensorFlow ${key}: ${error.message}`);
    } finally {
      weights.forEach(weight => weight.dispose());
    }
    const entry = { ...stored, model };
    models.set(key, entry);
    return entry;
  }

  async function save(key, entry) {
      const weights = entry.model.getWeights().map(weight => weight.clone());
      try {
        const stored = {
          version: 1,
          key,
          mean: entry.mean,
          std: entry.std,
          accuracy: entry.accuracy,
          baseline: entry.baseline,
          validationCount: entry.validationCount,
          trainingCount: entry.trainingCount,
          qualified: entry.qualified,
          trainedAt: Date.now(),
          weights: weights.map(weight => ({ shape: weight.shape, values: Array.from(weight.dataSync()) }))
        };
        const file = modelPath(key);
        const temporary = file + '.tmp';
        try {
          fs.writeFileSync(temporary, JSON.stringify(stored));
          fs.renameSync(temporary, file);
        } catch (error) {
          if (fs.existsSync(temporary)) fs.rmSync(temporary);
          throw error;
        }
        entry.trainedAt = stored.trainedAt;
      } finally {
        weights.forEach(weight => weight.dispose());
      }
  }

  async function train(key, data, length) {
    const samples = createTrainingSamples(data, length, HORIZON);
    if (samples.length < MIN_TRAINING_SAMPLES) return null;

    const split = Math.floor(samples.length * 0.7);
    const training = samples.slice(0, split);
    const validation = samples.slice(split + HORIZON);
    if (training.length < 200 || validation.length < 80) return null;

    const means = Array.from({ length: 10 }, (_, index) =>
      training.reduce((total, sample) => total + sample.features[index], 0) / training.length);
    const stds = Array.from({ length: 10 }, (_, index) => {
      const variance = training.reduce((total, sample) =>
        total + (sample.features[index] - means[index]) ** 2, 0) / training.length;
      return Math.sqrt(variance) || 1;
    });

    const xTrain = tf.tensor2d(normalize(training.map(sample => sample.features), means, stds));
    const yTrain = tf.tensor2d(training.map(sample => [sample.label]));
    const xValidation = tf.tensor2d(normalize(validation.map(sample => sample.features), means, stds));
    let model;
    try {
      await (ready ||= tf.ready());
      model = buildModel();
      await model.fit(xTrain, yTrain, { epochs: EPOCHS, batchSize: BATCH_SIZE, shuffle: false, verbose: 0 });
      const prediction = model.predict(xValidation);
      let probabilities;
      try {
        probabilities = Array.from(await prediction.data());
      } finally {
        prediction.dispose();
      }
      const correct = probabilities.reduce((total, probability, index) =>
        total + (Number(probability >= 0.5) === validation[index].label ? 1 : 0), 0);
      const accuracy = correct / validation.length;
      const positives = validation.reduce((total, sample) => total + sample.label, 0) / validation.length;
      const baseline = Math.max(positives, 1 - positives);
      const previous = models.get(key);
      const entry = {
        model,
        mean: means,
        std: stds,
        accuracy,
        baseline,
        validationCount: validation.length,
        trainingCount: training.length,
        qualified: validation.length >= 80 && accuracy >= 0.55 && accuracy > baseline + 0.02
      };
      await save(key, entry);
      models.set(key, entry);
      if (previous) previous.model.dispose();
      return entry;
    } catch (error) {
      if (model) model.dispose();
      throw new Error(`Falló el entrenamiento TensorFlow de ${key}: ${error.message}`);
    } finally {
      xTrain.dispose();
      yTrain.dispose();
      xValidation.dispose();
    }
  }

  async function getModel(key, data, length, force = false) {
    await (ready ||= tf.ready());
    const current = models.get(key) || load(key);
    if (!force && !forced.has(key) && current && Date.now() - current.trainedAt < MAX_AGE_MS) return current;
    if (inflight.has(key)) return inflight.get(key);

    const pending = train(key, data, length)
      .then(trained => trained || current)
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
    forced.delete(key);
    return pending;
  }

  async function predict({ key, data, length, force = false }) {
    const model = await getModel(key, data, length, force);
    if (!model) return null;
    const features = extractFeatures(length - 1, data);
    if (!features.every(Number.isFinite)) return null;
    const input = tf.tensor2d([normalize([features], model.mean, model.std)[0]]);
    try {
      const output = model.model.predict(input);
      let probability;
      try {
        probability = (await output.data())[0];
      } finally {
        output.dispose();
      }
      return {
        probability,
        accuracy: model.accuracy,
        baseline: model.baseline,
        validationCount: model.validationCount,
        trainingCount: model.trainingCount,
        qualified: model.qualified,
        horizon: HORIZON,
        trainedAt: model.trainedAt
      };
    } finally {
      input.dispose();
    }
  }

  function invalidate(key) {
    if (key) {
      const model = models.get(key);
      if (model) model.trainedAt = 0;
      forced.add(key);
    } else {
      for (const [modelKey, model] of models) {
        model.trainedAt = 0;
        forced.add(modelKey);
      }
    }
  }

  function summary() {
    return [...models].map(([key, model]) => ({
      key,
      acc: model.accuracy,
      base: model.baseline,
      valN: model.validationCount,
      trainN: model.trainingCount,
      qualified: model.qualified,
      time: model.trainedAt
    }));
  }

  function dispose() {
    for (const { model } of models.values()) model.dispose();
    models.clear();
  }

  return { predict, invalidate, summary, dispose };
};
