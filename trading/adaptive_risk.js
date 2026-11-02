'use strict';

const DEFAULT_ATR_MULTIPLIER = 2.5;
const MIN_ATR_MULTIPLIER = 1.5;
const MAX_ATR_MULTIPLIER = 4;
const LEARNING_STEP = 0.1;
const MIN_SAMPLES = 5;
const MAX_SAMPLES = 20;

function createLearning() {
  return { atrMultiplier: DEFAULT_ATR_MULTIPLIER, totalStopSamples: 0, samples: [] };
}

function normalizeLearning(value) {
  if (value == null) return createLearning();
  if (!value || !Number.isFinite(value.atrMultiplier) ||
      value.atrMultiplier < MIN_ATR_MULTIPLIER || value.atrMultiplier > MAX_ATR_MULTIPLIER ||
      !Number.isInteger(value.totalStopSamples) || value.totalStopSamples < 0 ||
      !Array.isArray(value.samples) || value.samples.length > MAX_SAMPLES ||
      value.totalStopSamples < value.samples.length ||
      value.samples.some(sample => !sample || !Number.isFinite(sample.r))) {
    throw new Error('Los datos de aprendizaje de riesgo tienen un formato inválido.');
  }
  return {
    atrMultiplier: value.atrMultiplier,
    totalStopSamples: value.totalStopSamples,
    samples: value.samples.slice(-MAX_SAMPLES).map(sample => ({ r: sample.r, time: sample.time }))
  };
}

function trailStop({ side, initialStop, currentStop, peakPrice, price, atr, multiplier }) {
  if (!['long', 'short'].includes(side) ||
      ![initialStop, currentStop, peakPrice, price].every(Number.isFinite)) {
    throw new Error('No se puede calcular el stop dinámico con datos inválidos.');
  }
  if (!Number.isFinite(atr) || atr <= 0) return { stop: currentStop, peakPrice };
  if (!Number.isFinite(multiplier) || multiplier < MIN_ATR_MULTIPLIER || multiplier > MAX_ATR_MULTIPLIER) {
    throw new Error('El múltiplo ATR del stop dinámico está fuera de rango.');
  }

  if (side === 'long') {
    const peak = Math.max(peakPrice, price);
    return {
      stop: Math.max(currentStop, initialStop, peak - atr * multiplier),
      peakPrice: peak
    };
  }
  const trough = Math.min(peakPrice, price);
  return {
    stop: Math.min(currentStop, initialStop, trough + atr * multiplier),
    peakPrice: trough
  };
}

function recordStopOutcome(learning, trade) {
  if (trade.reason !== 'stop' || !Number.isFinite(trade.rMultiple)) return learning;

  learning.samples.push({ r: trade.rMultiple, time: trade.closedAt });
  learning.samples = learning.samples.slice(-MAX_SAMPLES);
  learning.totalStopSamples++;

  if (learning.totalStopSamples >= MIN_SAMPLES && learning.totalStopSamples % MIN_SAMPLES === 0) {
    const recent = learning.samples.slice(-MIN_SAMPLES);
    const averageR = recent.reduce((total, sample) => total + sample.r, 0) / recent.length;
    if (averageR < -0.25) learning.atrMultiplier += LEARNING_STEP;
    else if (averageR > 0.25) learning.atrMultiplier -= LEARNING_STEP;
    learning.atrMultiplier = Math.min(MAX_ATR_MULTIPLIER,
      Math.max(MIN_ATR_MULTIPLIER, learning.atrMultiplier));
  }
  return learning;
}

function summary(learning) {
  const samples = learning.samples;
  return {
    atrMultiplier: learning.atrMultiplier,
    stopSamples: learning.totalStopSamples,
    recentAverageR: samples.length
      ? samples.reduce((total, sample) => total + sample.r, 0) / samples.length
      : null,
    method: 'ajuste heurístico acotado por resultados de stops'
  };
}

module.exports = {
  DEFAULT_ATR_MULTIPLIER,
  MIN_ATR_MULTIPLIER,
  MAX_ATR_MULTIPLIER,
  createLearning,
  normalizeLearning,
  trailStop,
  recordStopOutcome,
  summary
};
