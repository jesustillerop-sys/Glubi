'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createAnalysis = require('../core/analysis.js');
const indicators = require('../core/indicators.js');
const { resolveSignal } = require('../core/signals.js');
const { applyValidatedModel } = require('../ai/decision.js');

test('core analysis preserves the indicator result shape used by the API', () => {
  const analyze = createAnalysis({
    step: { '1h': 3600 },
    htf: { '1h': '4h' },
    indicators,
    resolveSignal
  });
  const candles = Array.from({ length: 500 }, (_, index) => {
    const close = 200 + index * 0.02 + 3 * Math.sin(index / 9);
    return [1700000000 + index * 3600, close - 0.2, close + 1, close - 1, close, 1000 + index];
  });
  const result = analyze(candles, 'BTCUSDT', '1h', { htfA: null });

  assert.equal(result.symbol, 'BTCUSDT');
  assert.equal(result.candles.length, candles.length);
  assert.equal(result.modelData.close.length, candles.length);
  assert.equal(result.rows.length, 11);
  assert.ok(['COMPRAR', 'ESPERAR', 'VENDER'].includes(result.decision));
  assert.ok(Number.isFinite(result.score));
});

test('only a qualified TensorFlow model contributes one point to the existing signal', () => {
  const analysis = {
    rows: [],
    score: 4,
    conf: { bull: 3, bear: 0 },
    rr: 2,
    adx: 25,
    ctx: null
  };
  applyValidatedModel(analysis, {
    qualified: true,
    probability: 0.6,
    accuracy: 0.6,
    baseline: 0.55,
    validationCount: 100,
    horizon: 6
  });

  assert.equal(analysis.score, 5);
  assert.equal(analysis.rows[0].pts, 1);
  assert.equal(analysis.decision, 'COMPRAR');
});
