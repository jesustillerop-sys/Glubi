'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createTelegramNotifier = require('../alerts/telegram.js');
const createSignalScheduler = require('../alerts/scheduler.js');

test('sends Telegram only after a paper buy or sell has been executed', async () => {
  const requests = [];
  const notify = createTelegramNotifier({
    env: { TELEGRAM_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' },
    request: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ ok: true }) };
    },
    logger: { error: assert.fail }
  });
  const scheduler = createSignalScheduler({ windowSeconds: 30 });
  const events = scheduler.observe({
    symbol: 'BTCUSDT',
    tf: '1m',
    decision: 'COMPRAR',
    stepSeconds: 60,
    nowSeconds: 35,
    confirmed: false
  });

  assert.equal(events[0].type, 'PREPARAR');
  assert.equal(await notify({
    to: events[0].type
  }, value => String(value)), false);
  assert.equal(requests.length, 0);

  assert.equal(await notify({
    kind: 'paper-execution',
    action: 'COMPRA',
    phase: 'apertura',
    symbol: 'BTCUSDT',
    tf: '1m',
    side: 'long',
    price: 100,
    stop: 95,
    target: 110,
    notional: 50,
    equity: 100,
    reason: 'Señal confirmada y operación simulada abierta.'
  }, value => String(value)), true);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/sendMessage$/);
  const payload = new URLSearchParams(requests[0].options.body);
  assert.equal(payload.get('chat_id'), 'test-chat');
  assert.match(payload.get('text'), /GLUBI PAPER · COMPRA APERTURA CONFIRMADA/);
  assert.match(payload.get('text'), /SIMULACIÓN: no se enviaron órdenes reales/);
});

test('does not attempt delivery when Telegram credentials are missing', async () => {
  let requests = 0;
  const notify = createTelegramNotifier({
    env: {},
    request: async () => { requests++; },
    logger: { error: assert.fail }
  });

  assert.equal(notify.isConfigured(), false);
  assert.equal(await notify({ kind: 'paper-execution', action: 'COMPRA', phase: 'apertura' }, String), false);
  assert.equal(requests, 0);
});

test('redacts the bot token from delivery errors', async () => {
  const logged = [];
  const token = 'test-secret-token';
  const notify = createTelegramNotifier({
    env: { TELEGRAM_TOKEN: token, TELEGRAM_CHAT_ID: 'test-chat' },
    request: async () => { throw new Error(`Request failed for ${token}`); },
    logger: { error: (...args) => logged.push(args.join(' ')) }
  });

  assert.equal(await notify({
    kind: 'paper-execution',
    action: 'VENTA',
    phase: 'cierre',
    symbol: 'BTCUSDT'
  }, String), false);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].includes(token), false);
  assert.match(logged[0], /\[redacted\]/);
});
