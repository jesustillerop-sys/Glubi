'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const createTrainer = require('../ai/trainer.js');

function createMarketData(length) {
  const close = Array.from({ length }, (_, index) =>
    100 + index * 0.02 + 8 * Math.sin(index / 17));
  return {
    close,
    volume: close.map((_, index) => 1000 + 400 * Math.cos(index / 9)),
    ema50: close.map((price, index) => price - Math.sin(index / 11)),
    ema200: close.map((price, index) => price - Math.cos(index / 19)),
    rsi: close.map((_, index) => 50 + 20 * Math.sin(index / 13)),
    adx: close.map((_, index) => 22 + 8 * Math.cos(index / 15)),
    plusDi: close.map((_, index) => 25 + 10 * Math.sin(index / 12)),
    minusDi: close.map((_, index) => 25 - 10 * Math.sin(index / 12)),
    macdHistogram: close.map((_, index) => Math.sin(index / 8))
  };
}

test('trains, saves, and reloads a TensorFlow model using a time-embargoed validation set', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glubi-tf-'));
  const data = createMarketData(500);
  const trainer = createTrainer({ dir });
  let reloaded;
  t.after(() => {
    trainer.dispose();
    if (reloaded) reloaded.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const prediction = await trainer.predict({ key: 'BTCUSDT|1h', data, length: data.close.length });
  assert.ok(prediction);
  assert.ok(prediction.probability >= 0 && prediction.probability <= 1);
  assert.equal(prediction.trainingCount, 303);
  assert.equal(prediction.validationCount, 125);
  assert.ok(fs.existsSync(path.join(dir, 'ai', 'models', 'BTCUSDT_1h.json')));

  trainer.invalidate('BTCUSDT|1h');
  const retrained = await trainer.predict({ key: 'BTCUSDT|1h', data, length: data.close.length });
  assert.ok(retrained.trainedAt > prediction.trainedAt);

  reloaded = createTrainer({ dir });
  const restored = await reloaded.predict({ key: 'BTCUSDT|1h', data, length: data.close.length });
  assert.ok(restored);
  assert.equal(restored.trainedAt, retrained.trainedAt);
  assert.equal(reloaded.summary().length, 1);
});
