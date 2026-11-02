'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createSignalScheduler = require('../glubi_scheduler');

test('emits one preparation alert inside the 30-second window and confirms after candle close', () => {
  const scheduler = createSignalScheduler();
  const observe = (nowSeconds, confirmed = false) => scheduler.observe({
    symbol: 'BTCUSDT',
    tf: '1m',
    decision: 'COMPRAR',
    stepSeconds: 60,
    nowSeconds,
    confirmed
  });

  assert.deepEqual(observe(20), []);
  assert.equal(observe(31)[0].type, 'PREPARAR');
  assert.deepEqual(observe(40), []);
  assert.deepEqual(observe(60), []);
  assert.equal(observe(61, true)[0].type, 'CONFIRMADA');
});

test('cancels the preparation when the decision changes before confirmation', () => {
  const scheduler = createSignalScheduler();
  const observe = (decision, nowSeconds, confirmed = false) => scheduler.observe({
    symbol: 'ETHUSDT',
    tf: '5m',
    decision,
    stepSeconds: 300,
    nowSeconds,
    confirmed
  });

  assert.equal(observe('VENDER', 275)[0].type, 'PREPARAR');
  assert.equal(observe('ESPERAR', 301, true)[0].type, 'CANCELADA');
  assert.deepEqual(observe('ESPERAR', 302, true), []);
});
