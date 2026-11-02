'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const adaptiveRisk = require('../trading/adaptive_risk.js');
const createRiskManager = require('../trading/risk_manager.js');

test('long and short trailing stops move only in the protective direction', () => {
  const long = { side: 'long', initialStop: 90, currentStop: 90, peakPrice: 100, atr: 2, multiplier: 2.5 };
  const raised = adaptiveRisk.trailStop({ ...long, price: 110 });
  assert.equal(raised.stop, 105);
  assert.equal(raised.peakPrice, 110);
  assert.equal(adaptiveRisk.trailStop({ ...long, currentStop: raised.stop, peakPrice: 110, price: 105 }).stop, 105);

  const short = { side: 'short', initialStop: 110, currentStop: 110, peakPrice: 100, atr: 2, multiplier: 2.5 };
  const lowered = adaptiveRisk.trailStop({ ...short, price: 90 });
  assert.equal(lowered.stop, 95);
  assert.equal(lowered.peakPrice, 90);
  assert.equal(adaptiveRisk.trailStop({ ...short, currentStop: lowered.stop, peakPrice: 90, price: 95 }).stop, 95);
});

test('keeps the original loss stop and does not adapt before five stop outcomes', () => {
  const learning = adaptiveRisk.createLearning();
  for (let index = 0; index < 4; index++) {
    adaptiveRisk.recordStopOutcome(learning, { reason: 'stop', rMultiple: -1, closedAt: index });
  }
  assert.equal(learning.atrMultiplier, 2.5);
  assert.equal(adaptiveRisk.trailStop({
    side: 'long',
    initialStop: 95,
    currentStop: 95,
    peakPrice: 100,
    price: 100,
    atr: 3,
    multiplier: learning.atrMultiplier
  }).stop, 95);
  adaptiveRisk.recordStopOutcome(learning, { reason: 'stop', rMultiple: -1, closedAt: 5 });
  assert.equal(learning.atrMultiplier, 2.6);
  assert.equal(adaptiveRisk.normalizeLearning(learning).totalStopSamples, 5);
});

test('ignores non-stop outcomes and clamps learned settings', () => {
  const learning = adaptiveRisk.createLearning();
  for (let index = 0; index < 10; index++) {
    adaptiveRisk.recordStopOutcome(learning, { reason: 'objetivo', rMultiple: 5, closedAt: index });
  }
  assert.equal(learning.totalStopSamples, 0);

  learning.atrMultiplier = adaptiveRisk.MAX_ATR_MULTIPLIER;
  for (let index = 0; index < 5; index++) {
    adaptiveRisk.recordStopOutcome(learning, { reason: 'stop', rMultiple: -2, closedAt: index });
  }
  assert.equal(learning.atrMultiplier, adaptiveRisk.MAX_ATR_MULTIPLIER);
});

test('capital risk manager learns a trailing multiplier from closed stop trades', () => {
  let saved;
  const manager = createRiskManager({
    get: async () => [],
    BASE: 'https://example.invalid',
    MEM: { signals: [] },
    POS: {},
    readJ: () => ({}),
    writeJ: (_file, value) => { saved = structuredClone(value); },
    sum: values => values.reduce((total, value) => total + value, 0),
    analyzeC: async () => ({}),
    SYM: /^[A-Z0-9_]{2,28}USDT$/,
    dir: '.'
  });

  for (let index = 0; index < 5; index++) {
    manager.onClose('BTCUSDT', {
      side: 'long',
      entry: 100,
      stop: 95,
      target: 110,
      notional: 100,
      margin: 100,
      lev: 1,
      sd: 0.05,
      riskUsd: 5,
      fee: 0.001,
      tf: '1h'
    }, 94, -6, index + 1);
  }

  assert.equal(manager.stopMultiplier(), 2.6);
  assert.equal(saved.stopLearning.totalStopSamples, 5);
});
