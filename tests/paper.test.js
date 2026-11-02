'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const createPaper = require('../glubi_paper');

function setup({ onTrade } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glubi-paper-'));
  let price = 100;
  let decision = 'COMPRAR';
  const paper = createPaper({
    dir,
    analyze: async () => ({ price, decision, stop: 95, target: 110, stop_s: 105, target_s: 90, atr: 3 }),
    market: symbol => symbol.startsWith('FUT') ? 'F' : 'S',
    onTrade
  });
  return { dir, paper, setPrice: value => { price = value; }, setDecision: value => { decision = value; } };
}

test('opens a cash-backed paper trade, closes it at the target, and persists metrics', async t => {
  const { dir, paper, setPrice } = setup();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const opened = await paper.open({ symbol: 'BTCUSDT', tf: '1h', side: 'long' });
  assert.ok(opened.notional > 0 && opened.notional < 100);
  assert.ok(paper.summary().balance < 100);

  setPrice(112);
  await paper.monitor();
  const result = paper.summary();
  assert.equal(result.openCount, 0);
  assert.equal(result.trades[0].reason, 'objetivo');
  assert.ok(result.trades[0].pnl > 0);
  assert.ok(result.equity > 100);
  assert.equal(result.equityCurve.at(-1).value, result.equity);
  assert.ok(result.equityCurve.every((point, index, curve) => index === 0 || point.time > curve[index - 1].time));

  const restored = createPaper({
    dir,
    analyze: async () => ({ price: 100, stop: 95, target: 110, stop_s: 105, target_s: 90 }),
    market: () => 'F'
  });
  assert.equal(restored.summary().tradeCount, 1);
  assert.equal(restored.summary().equity, result.equity);
});

test('uses the stop and refuses shorts outside futures', async t => {
  const { dir, paper, setPrice, setDecision } = setup();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await assert.rejects(
    paper.open({ symbol: 'BTCUSDT', tf: '1h', side: 'short' }),
    /solo están disponibles para futuros/
  );
  setDecision('VENDER');
  await paper.open({ symbol: 'FUTBTCUSDT', tf: '15m', side: 'short' });
  setPrice(106);
  await paper.monitor();

  const result = paper.summary();
  assert.equal(result.openCount, 0);
  assert.equal(result.trades[0].reason, 'stop');
  assert.ok(result.trades[0].pnl < 0);
});

test('trails paper stops and learns from a bounded history of stop outcomes', async t => {
  const { dir, paper, setPrice } = setup();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await paper.open({ symbol: 'BTCUSDT', tf: '1h', side: 'long' });
  setPrice(105);
  await paper.monitor();
  const open = paper.summary().openPositions[0];
  assert.equal(open.initialStop, 95);
  assert.equal(open.stop, 97.5);
  assert.equal(open.trailAtrMultiplier, 2.5);

  setPrice(97);
  await paper.monitor();
  assert.equal(paper.summary().trades[0].reason, 'stop');
  assert.equal(paper.summary().stopLearning.stopSamples, 1);

  for (const symbol of ['ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT']) {
    setPrice(100);
    await paper.open({ symbol, tf: '1h', side: 'long' });
    setPrice(94);
    await paper.monitor();
  }
  assert.equal(paper.summary().stopLearning.atrMultiplier, 2.6);
  assert.equal(paper.summary().stopLearning.stopSamples, 6);

  const restored = createPaper({
    dir,
    analyze: async () => ({ price: 100, stop: 95, target: 110, stop_s: 105, target_s: 90, atr: 3 }),
    market: () => 'S'
  });
  assert.equal(restored.summary().stopLearning.atrMultiplier, 2.6);
});

test('does not allow the initial balance to overwrite an existing paper history', async t => {
  const { dir, paper } = setup();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.throws(() => paper.configure({ initialBalance: -1 }), /mayor que cero/);
  await paper.open({ symbol: 'BTCUSDT', tf: '1h', side: 'long' });
  assert.throws(() => paper.configure({ initialBalance: 500 }), /no se puede cambiar/);
  assert.equal(paper.summary().cfg.initialBalance, 100);
});

test('cancels a paper entry when the analyzed signal has changed', async t => {
  const { dir, paper, setDecision } = setup();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  setDecision('ESPERAR');
  await assert.rejects(
    paper.open({ symbol: 'BTCUSDT', tf: '1h', side: 'long' }),
    /señal cambió/
  );
  assert.equal(paper.summary().openCount, 0);
  assert.equal(paper.summary().balance, 100);
});

test('auto trading is enabled by default and can be disabled explicitly', async t => {
  const { dir, paper } = setup();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await paper.onSignal({ symbol: 'BTCUSDT', tf: '1h', decision: 'COMPRAR' });
  assert.equal(paper.summary().openCount, 1);
  assert.equal(paper.summary().cfg.autoTrade, true);

  paper.configure({ autoTrade: '0' });
  assert.equal(paper.summary().cfg.autoTrade, false);
  assert.equal(await paper.onSignal({ symbol: 'ETHUSDT', tf: '1h', decision: 'COMPRAR' }), null);
  assert.equal(paper.summary().openCount, 1);
});

test('confirmed opposite signals close paper positions and notify only executed trades', async t => {
  const notifications = [];
  const { dir, paper, setDecision } = setup({ onTrade: async event => notifications.push(event) });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await paper.onSignal({ symbol: 'BTCUSDT', tf: '1h', decision: 'COMPRAR' });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].action, 'COMPRA');
  assert.equal(notifications[0].phase, 'apertura');

  setDecision('VENDER');
  const closed = await paper.onSignal({ symbol: 'BTCUSDT', tf: '1h', decision: 'VENDER' });
  assert.equal(closed.reason, 'señal opuesta confirmada');
  assert.equal(paper.summary().openCount, 0);
  assert.equal(notifications.length, 2);
  assert.equal(notifications[1].action, 'VENTA');
  assert.equal(notifications[1].phase, 'cierre');
  assert.equal(notifications[1].kind, 'paper-execution');
});

test('migrates the previous automatic-trading default once without overriding later opt-out', async t => {
  const { dir } = setup();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'paper_portfolio.json');
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    cfg: { initialBalance: 100, riskPct: 1, feePct: 0.1, slippagePct: 0.05, autoTrade: false },
    balance: 100,
    open: [],
    trades: [],
    nextId: 1,
    createdAt: 1,
    updatedAt: 1
  }));
  const paper = createPaper({
    dir,
    analyze: async () => ({ price: 100, decision: 'COMPRAR', stop: 95, target: 110 }),
    market: () => 'S'
  });

  assert.equal(paper.summary().cfg.autoTrade, true);
  paper.configure({ autoTrade: false });
  const restarted = createPaper({
    dir,
    analyze: async () => ({ price: 100, decision: 'COMPRAR', stop: 95, target: 110 }),
    market: () => 'S'
  });
  assert.equal(restarted.summary().cfg.autoTrade, false);
});
