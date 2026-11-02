#!/usr/bin/env node
'use strict';
/* Glubi Web en Node.js 18+. Uso: node glubi_server.js y abre http://localhost:8765.
   Alertas opcionales a Telegram: TELEGRAM_TOKEN y TELEGRAM_CHAT_ID.
   Herramienta de análisis, no es consejo financiero. */
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.GLUBI_DATA_DIR || ROOT);
const createDatabaseStore = require('../database/store.js');
const database = createDatabaseStore({ dir: DATA_DIR });
const PORT = +process.env.PORT || 8765, HOST = process.env.HOST || '127.0.0.1', BASE = 'https://data-api.binance.vision/api/v3';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const WL_FILE = path.join(DATA_DIR, 'watchlist.json'), POS_FILE = path.join(DATA_DIR, 'positions.json');
const DEFAULT = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'], STEP = { '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
const SCAN_N = +process.env.SCAN_N || 150;
const SYM = /^[A-Z0-9_]{2,28}USDT$/, MON_TFS = Object.keys(STEP), MEM_FILE = path.join(DATA_DIR, 'memory.json');
const signalScheduler = require('../alerts/scheduler.js')({ windowSeconds: 30 });
const notifyTelegram = require('../alerts/telegram.js')();
const createTrainer = require('../ai/trainer.js');
const { applyValidatedModel } = require('../ai/decision.js');
const { resolveSignal } = require('./signals.js');
const indicators = require('./indicators.js');
const { sum, max, min, sign: sg, format: fm } = indicators;
const STABLES = new Set(['USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'EUR', 'USD1', 'BUSD', 'AEUR', 'XUSD', 'USDE']);
const DASHBOARD_ASSETS = {
  '/dashboard/styles.css': ['styles.css', 'text/css'],
  '/dashboard/dashboard.js': ['dashboard.js', 'text/javascript'],
  '/dashboard/charts.js': ['charts.js', 'text/javascript']
};
const cache = new Map(), sleep = ms => new Promise(r => setTimeout(r, ms));
const readJ = (f, d) => database.readJSON(path.basename(f), d);
const writeJ = (f, v) => database.writeJSON(path.basename(f), v);
const POS = readJ(POS_FILE, {});
const loadWL = () => { const w = readJ(WL_FILE, null); return Array.isArray(w) ? w.filter(s => SYM.test(s)) : [...DEFAULT]; };

function get(url, ttl = 8) {  // cachea la promesa: las peticiones simultáneas iguales se comparten
  const now = Date.now() / 1000, c = cache.get(url);
  if (c && now - c[0] < ttl) return c[1];
  const p = fetch(url, { headers: { 'User-Agent': 'glubi' }, signal: AbortSignal.timeout(15000) })
    .then(r => { if (!r.ok) throw new Error('Binance respondió ' + r.status); return r.json(); });
  cache.set(url, [now, p]); p.catch(() => cache.delete(url));
  return p;
}
let KLH = null;
const X = { klines: async (sym, tf, n = 500) => {
  const alt = KLH ? await KLH(sym, tf, n) : null; if (alt) return alt;  // futuros o Alpha; si no, spot
  return (await get(`${BASE}/klines?symbol=${sym}&interval=${tf}&limit=${n}`)).map(k => [Math.floor(+k[0] / 1000), +k[1], +k[2], +k[3], +k[4], +k[5]]);
} };

// ---------- red neuronal (MLP 10-8-1, JS puro) y memoria en JSON ----------
const MEM = Object.assign({ models: {}, trends: [], signals: [], stats: {}, last: {}, samples: [], prob: {}, bt: {}, trades: [] }, readJ(MEM_FILE, {}));
let dirty = false; const markDirty = () => { dirty = true; };
const saveMem = () => {
  if (!dirty) return;
  try {
    writeJ(MEM_FILE, MEM);
    dirty = false;
  } catch (error) {
    console.error('No se pudo guardar la memoria de GLUBI:', error.message);
  }
};
const TF_TRAINER = createTrainer({ dir: DATA_DIR });
const FORCE = new Set();

// ---------- análisis por confluencia ----------
const HTF = { '5m': '4h', '15m': '4h', '30m': '4h', '1h': '4h', '4h': '1d' }, AC = new Map();
function analyzeC(sym, tf, nK = 500, ctx = true) {  // comparte el cálculo entre panel, vigilante y escáner durante 4 s
  const key = `${sym}|${tf}|${nK}|${ctx}`, c = AC.get(key), now = Date.now();
  if (c && now - c[0] < 4000) return c[1];
  const p = analyze(sym, tf, nK, ctx); AC.set(key, [now, p]); p.catch(() => AC.delete(key)); return p;
}
async function analyze(sym, tf, nK = 500, ctx = true) {
  const k = await X.klines(sym, tf, nK);
  let htfA = null; if (ctx && HTF[tf]) { try { htfA = await analyzeC(sym, HTF[tf], 300, false); } catch (e) { htfA = null; } }
  const a = core(k, sym, tf, { htfA });
  if (ctx && nK >= 500) {
    const key = sym + '|' + tf;
    const nn = await TF_TRAINER.predict({
      key,
      data: a.modelData,
      length: a.candles.length,
      force: FORCE.delete(key)
    });
    if (nn) {
      a.nn = { p: nn.probability, acc: nn.accuracy, base: nn.baseline, valN: nn.validationCount, qualified: nn.qualified, H: nn.horizon, time: nn.trainedAt };
      applyValidatedModel(a, nn);
    }
  }
  delete a.modelData;
  a.prob = probFor(tf, a); return a;
}
const createCoreAnalysis = require('./analysis.js');
const core = createCoreAnalysis({ step: STEP, htf: HTF, indicators, resolveSignal });

// ---------- probabilidad aprendida, backtest y retroalimentación ----------
const METHODS = ['Medias EMA', 'Cruce EMA', 'Estructura', 'Línea de tendencia', 'ADX', 'MACD', 'Volumen', 'Ángulo', 'RSI', 'Fibonacci', 'Riesgo/beneficio'];
function probFor(tf, a) {  // P(el objetivo llega antes que el stop) según la regresión logística aprendida por período
  const M = MEM.prob[tf], be = 1 / (1 + a.rr); if (!M) return { p: null, n: 0, be, ev: null };
  const x = a.rows.slice(0, 11).map(r => r.pts), p = 1 / (1 + Math.exp(-(M.b + sum(M.w.map((w, k) => w * x[k])))));
  return { p, n: M.n, win: M.win, be, ev: p * a.rr - (1 - p), valAcc: M.valAcc, valBase: M.valBase, valN: M.valN, useful: M.useful };
}
function fitProb(tf) {
  const S = MEM.samples.filter(q => q.tf === tf && (q.y === 0 || q.y === 1)).sort((a, b) => a.t - b.t);
  if (S.length < 20) { delete MEM.prob[tf]; return; }
  const fit = D => {
    const n = D.length, w = Array(11).fill(0), wins = sum(D.map(q => q.y)); let b = Math.log((wins + 1) / (n - wins + 1));
    for (let it = 0; it < 300; it++) {
      const gw = Array(11).fill(0); let gb = 0;
      for (const q of D) { const e = 1 / (1 + Math.exp(-(b + sum(w.map((u, k) => u * q.x[k]))))) - q.y; gb += e; for (let k = 0; k < 11; k++) gw[k] += e * q.x[k]; }
      b -= 0.1 * gb / n; for (let k = 0; k < 11; k++) w[k] -= 0.1 * (gw[k] / n + 0.05 * w[k]);
    }
    return { w, b };
  };
  let valAcc = null, valBase = null, valN = 0;
  if (S.length >= 60) {  // validación cronológica: entrena con lo antiguo, evalúa con lo reciente
    const cut = Math.floor(S.length * 0.7), m = fit(S.slice(0, cut)), V = S.slice(cut); valN = V.length;
    valAcc = V.filter(q => (1 / (1 + Math.exp(-(m.b + sum(m.w.map((u, k) => u * q.x[k]))))) >= 0.5 ? 1 : 0) === q.y).length / valN;
    const u = sum(V.map(q => q.y)) / valN; valBase = Math.max(u, 1 - u);
  }
  MEM.prob[tf] = { ...fit(S), n: S.length, win: sum(S.map(q => q.y)) / S.length, valAcc, valBase, valN, useful: valN >= 30 && valAcc > valBase + 0.02, time: Date.now() }; markDirty();
}
function backtest(k, sym, tf) {  // recorre el historial vela a vela con solo datos pasados; el stop gana si ambos se tocan en la misma vela
  const out = [], N = k.length; let busy = -1;
  for (let i = 150; i < N - 1; i++) {
    if (i <= busy) continue;
    let a; try { a = core(k.slice(Math.max(0, i - 499), i + 1), sym, tf, {}); } catch (e) { continue; }
    if (a.decision !== 'COMPRAR') continue;
    let y = null, R = 0, j = i + 1;
    for (; j <= Math.min(i + 60, N - 1); j++) { if (k[j][3] <= a.stop) { y = 0; R = -1; break; } if (k[j][2] >= a.target) { y = 1; R = a.rr; break; } }
    if (y === null && i + 60 > N - 1) continue;  // operación aún sin resolver
    busy = j; out.push({ tf, t: k[i][0], x: a.rows.slice(0, 11).map(r => r.pts), y, R: y === null ? (k[Math.min(i + 60, N - 1)][4] - a.price) / (a.price - a.stop) : R, k: `bt:${sym}|${tf}`, src: 'historial' });
  }
  return out;
}
async function learnStep(budget = 3) {  // aprende del historial de cada par moneda/período (24 h de vigencia), unos pocos por ciclo
  for (const s of loadWL()) for (const tf of MON_TFS) {
    if (budget <= 0) return;
    const key = s + '|' + tf; if (MEM.bt[key] && Date.now() - MEM.bt[key] < 24 * 3600e3) continue;
    let k; try { k = await X.klines(s, tf, 1000); } catch (e) { continue; }
    MEM.samples = MEM.samples.filter(q => q.k !== 'bt:' + key).concat(backtest(k, s, tf)).slice(-5000);
    MEM.bt[key] = Date.now(); fitProb(tf); budget--; await sleep(0);
  }
}
async function closePos(sym) {  // al cerrar tu operación, el resultado real alimenta el modelo
  const p = POS[sym]; delete POS[sym]; if (!p) return;
  let px = p.entry; try { px = (await analyzeC(sym, p.tf)).price; } catch (e) { /* usa la entrada */ }
  const pnl = (p.side === 'short' ? 1 - px / p.entry : px / p.entry - 1) * 100, now = Math.floor(Date.now() / 1000);
  MEM.trades.unshift({ symbol: sym, side: p.side || 'long', tf: p.tf, entry: p.entry, exit: px, pnl, time: now }); CAP.onClose(sym, p, px, pnl, now); MEM.trades.length = Math.min(MEM.trades.length, 200);
  if (p.x) { MEM.samples.push({ tf: p.tf, t: now, x: p.x.map(u => u * (p.side === 'short' ? -1 : 1)), y: pnl > 0 ? 1 : 0, R: null, k: 'usr', src: 'usuario' }); fitProb(p.tf); }
  markDirty();
}
function learnInfo() {
  const S = MEM.samples.filter(q => q.y === 0 || q.y === 1), T = MEM.trades;
  return { samples: S.length, bt: { done: Object.keys(MEM.bt).length, total: loadWL().length * MON_TFS.length },
    byTf: Object.fromEntries(Object.entries(MEM.prob).map(([t, m]) => [t, { n: m.n, win: m.win, valAcc: m.valAcc, valBase: m.valBase, valN: m.valN, useful: m.useful }])),
    methods: METHODS.map((name, k) => { const P = S.filter(q => q.x[k] > 0), N = S.filter(q => q.x[k] < 0); return { name, nPos: P.length, wPos: sum(P.map(q => q.y)), nNeg: N.length, wNeg: sum(N.map(q => q.y)) }; }),
    trades: { n: T.length, wins: T.filter(q => q.pnl > 0).length, avg: T.length ? sum(T.map(q => q.pnl)) / T.length : 0 } };
}

// ---------- monitoreo en vivo y posiciones ----------
const STATE = {}, SEEN = {}, EVENTS = [], TS = {};
function trendMemory(s, tf, a) {  // recuerda cada cambio de tendencia confirmado (2 lecturas seguidas)
  const key = s + '|' + tf, lab = a.trend, o = TS[key]; TS[key] = [lab, o && o[0] === lab ? o[1] + 1 : 1];
  if (TS[key][1] < 2 || MEM.last[key] === lab) return;
  const prev = MEM.last[key]; MEM.last[key] = lab;
  if (prev) { MEM.trends.unshift({ time: Math.floor(Date.now() / 1000), symbol: s, tf, from: prev, to: lab, price: a.price }); MEM.trends.length = Math.min(MEM.trends.length, 100); }
  markDirty();
}
async function resolveSignals() {  // mide en vivo qué pasó con cada señal de COMPRAR: objetivo, stop o expiró (60 velas)
  for (const g of MEM.signals) {
    if (g.done) continue;
    let k; try { k = await X.klines(g.symbol, g.tf, 500); } catch (e) { continue; }
    const after = k.filter(x => x[0] > g.time); let out = null;
    for (const x of after) { if (x[3] <= g.stop) { out = 'fallo'; break; } if (x[2] >= g.target) { out = 'acierto'; break; } }
    if (!out && after.length >= 60) out = 'expirada';
    if (out) { if (g.x && out !== 'expirada') { MEM.samples.push({ tf: g.tf, t: g.time, x: g.x, y: out === 'acierto' ? 1 : 0, R: null, k: 'sig', src: 'vivo' }); fitProb(g.tf); } g.done = out; CAP.onSignal(g, out); const st = MEM.stats[g.tf] || (MEM.stats[g.tf] = { acierto: 0, fallo: 0, expirada: 0 }); st[out]++; markDirty(); }
  }
}
function addEvent(s, tf, prev, d, a, reason, stop, target) {
  const ev = { time: Math.floor(Date.now() / 1000), symbol: s, tf, from: prev ?? null, to: d, price: a.price, stop: stop ?? a.stop, target: target ?? a.target, rr: a.rr, score: a.score, reason };
  EVENTS.unshift(ev); EVENTS.length = Math.min(EVENTS.length, 60);
}
async function checkPositions() {
  await Promise.all(Object.entries(POS).map(async ([s, p]) => {
    let a; try { a = await analyzeC(s, p.tf); } catch (e) { return; }
    const px = a.price, short = p.side === 'short';
    if (!Number.isFinite(px) || px <= 0) return;
    if (!Number.isFinite(p.initialStop)) p.initialStop = p.stop;
    if (!Number.isFinite(p.peak)) p.peak = px;
    if (!Number.isFinite(p.trailAtrMultiplier)) p.trailAtrMultiplier = CAP.stopMultiplier();
    const trailing = adaptiveRisk.trailStop({
      side: short ? 'short' : 'long',
      initialStop: p.initialStop,
      currentStop: p.stop,
      peakPrice: p.peak,
      price: px,
      atr: a.atr,
      multiplier: p.trailAtrMultiplier
    });
    p.peak = trailing.peakPrice;
    p.stop = trailing.stop;
    const hitStop = short ? px >= p.stop : px <= p.stop;
    const hitTgt = short ? px <= p.target : px >= p.target;
    const flip = short ? a.decision === 'COMPRAR' : a.decision === 'VENDER';
    const word = short ? 'CERRAR' : 'VENDER';
    const flipMsg = short ? 'Las señales se volvieron alcistas.' : 'Las señales se volvieron bajistas.';
    const reason = hitStop ? 'Stop dinámico tocado: protege lo ganado o limita la pérdida.' : hitTgt ? 'Objetivo alcanzado: considera tomar ganancias.' : flip ? flipMsg : null;
    if (reason && p.alerted !== reason) { p.alerted = reason; addEvent(s, p.tf, 'MANTENER', word, a, reason, p.stop, p.target); }
  }));
  writeJ(POS_FILE, POS);
}
async function monitorOnce() {
  const jobs = []; for (const s of loadWL()) for (const tf of MON_TFS) jobs.push([s, tf]);
  const res = await Promise.all(jobs.map(async ([s, tf]) => { try { return [s, tf, await analyzeC(s, tf)]; } catch (e) { return null; } }));
  for (const r of res) {
    if (!r) continue;
    const [s, tf, a] = r, key = s + '|' + tf, d = a.decision, c = SEEN[key], cnt = c && c[0] === d ? c[1] + 1 : 1;
    trendMemory(s, tf, a);
    SEEN[key] = [d, cnt];
    for (const scheduled of signalScheduler.observe({ symbol: s, tf, decision: d, stepSeconds: STEP[tf], nowSeconds: Math.floor(Date.now() / 1000), confirmed: cnt >= 2 })) {
      const description = scheduled.type === 'PREPARAR'
        ? `Preparación: posible señal ${scheduled.decision} antes del cierre de vela. Espera la confirmación; no es una orden.`
        : scheduled.type === 'CONFIRMADA'
          ? `La señal ${scheduled.previousDecision} sigue válida después del cierre de vela.`
          : `La señal ${scheduled.previousDecision} cambió a ${scheduled.decision}; operación cancelada.`;
      addEvent(s, tf, scheduled.previousDecision || null, scheduled.type, a, description);
      if (scheduled.type === 'CONFIRMADA') await PAPER.onSignal({ symbol: s, tf, decision: scheduled.decision });
    }
    if (cnt < 2) continue;  // la decisión debe repetirse 2 veces (evita parpadeo de la vela en curso)
    const prev = STATE[key];
    if (d !== prev) {
      STATE[key] = d;
      if (d === 'COMPRAR') { MEM.signals.push({ symbol: s, tf, time: Math.floor(Date.now() / 1000), entry: a.price, stop: a.stop, target: a.target, rr: a.rr, ctx: CAP.snap(a), x: a.rows.slice(0, 11).map(r => r.pts), done: null }); if (MEM.signals.length > 300) MEM.signals.shift(); markDirty(); }
      if (d === 'COMPRAR' || d === 'VENDER' || prev === 'COMPRAR') addEvent(s, tf, prev, d, a, a.reason);
    }
  }
  await checkPositions();
  await PAPER.monitor();
  await resolveSignals();
  await learnStep();
}

// ---------- investigación de mercado ----------
const SCAN = { time: 0, tf: null, busy: false, done: 0, total: 0, rows: [] };
async function runScan(tf) {
  try {
    const tick = await CAP.tickers();
    const top = tick.filter(x => x.symbol.endsWith('USDT') && SYM.test(x.symbol) && !STABLES.has(x.symbol.slice(0, -4)) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(x.symbol))
      .sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, SCAN_N);
    SCAN.total = top.length;
    for (let i = 0; i < top.length; i += 8) {
      await Promise.all(top.slice(i, i + 8).map(async x => {
        try {
          const a = await analyzeC(x.symbol, tf, 300, false);
          SCAN.rows.push({ symbol: x.symbol, price: a.price, chg: +x.priceChangePercent, score: a.score, rr: a.rr, decision: a.decision, trend: a.trend, stop: a.stop, target: a.target, p: a.prob.p });
        } catch (e) { /* se omite */ }
        SCAN.done++;
      }));
    }
  } catch (e) { /* se omite */ } finally { SCAN.busy = false; SCAN.time = Date.now() / 1000; }
}

// ---------- servidor ----------
const send = (res, code, body, type = 'application/json') => {
  let b = Buffer.from(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); const hd = { 'Content-Type': type + '; charset=utf-8' };
  if (b.length > 1024 && /\bgzip\b/.test(res.req?.headers['accept-encoding'] || '')) { b = zlib.gzipSync(b, { level: 3 }); hd['Content-Encoding'] = 'gzip'; }
  res.writeHead(code, hd); res.end(b);
};
async function handle(req, res) {
  const u = new URL(req.url, 'http://localhost'), q = Object.fromEntries(u.searchParams), post = req.method === 'POST', P = u.pathname;
  const tf = Object.hasOwn(STEP, q.tf) ? q.tf : '1h';
  let sym = (q.symbol || '').toUpperCase();
  try {
    if (P === '/healthz' && req.method === 'GET') return send(res, 200, { ok: true });
    if (APP_PASSWORD) {
      const expected = Buffer.from(`glubi:${APP_PASSWORD}`);
      const authorization = req.headers.authorization || '';
      const encoded = authorization.startsWith('Basic ') ? authorization.slice(6) : '';
      const supplied = Buffer.from(Buffer.from(encoded, 'base64').toString('utf8'));
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="GLUBI", charset="UTF-8"');
        return send(res, 401, { error: 'Autenticación requerida' });
      }
    }
    if (P === '/' || P === '/index.html') return send(res, 200, fs.readFileSync(path.join(ROOT, 'dashboard', 'index.html')), 'text/html');
    if (DASHBOARD_ASSETS[P]) {
      const [file, type] = DASHBOARD_ASSETS[P];
      return send(res, 200, fs.readFileSync(path.join(ROOT, 'dashboard', file)), type);
    }
    if (post && req.headers['x-glubi'] !== '1') return send(res, 403, { error: 'Solicitud no permitida' });
    const wl = loadWL();
    if (P === '/api/summary') {
      const coins = await Promise.all(wl.map(async s => {
        try { const a = await analyzeC(s, tf); return { symbol: a.symbol, price: a.price, decision: a.decision, score: a.score, rr: a.rr, p: a.prob.p, ws: CAP.spot(s), held: s in POS, pos: POS[s] || null }; }
        catch (e) { return { symbol: s, error: e.message }; }
      }));
      return send(res, 200, { coins });
    }
    if (P === '/api/analysis') {
      if (!SYM.test(sym)) return send(res, 400, { error: 'Símbolo inválido' });
      const a = await analyzeC(sym, tf), p = POS[sym];
      a.pos = p ? { ...p, pnl: (p.side === 'short' ? 1 - a.price / p.entry : a.price / p.entry - 1) * 100 } : null;
      a.cap = CAP.advice(a);
      a.paperCanShort = CAP.market(sym) === 'F';
      return send(res, 200, a);
    }
    if (P === '/api/paper' && !post) return send(res, 200, await PAPER.summary());
    if (P === '/api/paper/config' && post) return send(res, 200, PAPER.configure(q));
    if (P === '/api/paper/open' && post) {
      if (!SYM.test(sym)) return send(res, 400, { error: 'Símbolo inválido' });
      const position = await PAPER.open({ symbol: sym, tf, side: q.side });
      return send(res, 200, { ok: true, position });
    }
    if (P === '/api/paper/close' && post) {
      const id = Number(q.id);
      if (!Number.isInteger(id) || id < 1) return send(res, 400, { error: 'Identificador de operación inválido' });
      return send(res, 200, { ok: true, trade: await PAPER.close(id) });
    }
    if ((P === '/api/buy' || P === '/api/sell') && post) {
      if (!SYM.test(sym)) return send(res, 400, { error: 'Símbolo inválido' });
      if (P === '/api/buy') {
        const a = await analyzeC(sym, tf), short = q.side === 'short';
        const stop = short ? a.stop_s : a.stop;
        POS[sym] = { side: short ? 'short' : 'long', entry: a.price, time: Math.floor(Date.now() / 1000), tf, peak: a.price, initialStop: stop, stop, target: short ? a.target_s : a.target, alerted: null, x: a.rows.slice(0, 11).map(r => r.pts), ...CAP.onOpen(a, short) };
        if (!wl.includes(sym)) { wl.push(sym); writeJ(WL_FILE, wl); }  // la moneda con posición abierta siempre queda en la lista
      } else await closePos(sym);
      writeJ(POS_FILE, POS);
      return send(res, 200, { ok: true });
    }
    if (P === '/api/scan') {
      if (!SCAN.busy && (SCAN.tf !== tf || Date.now() / 1000 - SCAN.time > 300)) { Object.assign(SCAN, { busy: true, tf, done: 0, total: 0, rows: [] }); runScan(tf); }
      return send(res, 200, SCAN);
    }
    if (P === '/api/mtf') {
      if (!SYM.test(sym)) return send(res, 400, { error: 'Símbolo inválido' });
      const rows = await Promise.all(Object.keys(STEP).map(async t => { try { const a = await analyzeC(sym, t, 500, false); return { tf: t, label: a.trend, dir: a.tdir, adx: a.adx, score: a.score, decision: a.decision }; } catch (e) { return { tf: t, label: 'sin datos', dir: 0, adx: 0, score: 0, decision: 'ESPERAR' }; } }));
      return send(res, 200, { rows });
    }
    if (P === '/api/recalc' && post) {  // limpia cachés, vuelve a entrenar la red de la moneda actual y reinicia el escáner
      cache.clear(); AC.clear(); SCAN.time = 0; SCAN.tf = null; if (SYM.test(sym)) for (const key of Object.keys(MEM.bt)) if (key.startsWith(sym + '|')) delete MEM.bt[key]; if (SYM.test(sym)) { FORCE.add(sym + '|' + tf); TF_TRAINER.invalidate(sym + '|' + tf); }
      return send(res, 200, { ok: true });
    }
    if (P === '/api/memory') return send(res, 200, {
      models: [
        ...TF_TRAINER.summary().map(model => ({ ...model, algo: 'TensorFlow.js' })),
        ...Object.entries(MEM.models).map(([key, model]) => ({
          key, acc: model.acc, base: model.base, valN: model.valN,
          qualified: model.qualified, time: model.time, algo: 'MLP legado (histórico)'
        }))
      ],
      trends: MEM.trends.slice(0, 15), stats: MEM.stats, learn: learnInfo()
    });
    if (P === '/api/learn' && post) { MEM.bt = {}; TF_TRAINER.invalidate(); return send(res, 200, { ok: true }); }
    if (P.startsWith('/api/capital')) return CAP.route(P, q, post, res, send);
    if (P === '/api/events') return send(res, 200, { events: EVENTS });
    if (P === '/api/search') {
      const term = (q.q || '').toUpperCase().trim();
      if (term.length < 2) return send(res, 200, { results: [] });
      const names = await CAP.search(term);
      names.sort((a, b) => (a.startsWith(term) ? 0 : 1) - (b.startsWith(term) ? 0 : 1) || a.length - b.length);
      return send(res, 200, { results: names.slice(0, 8) });
    }
    if (P === '/api/add' && post) {
      if (!sym.endsWith('USDT')) sym += 'USDT';
      if (!SYM.test(sym)) return send(res, 400, { error: 'Símbolo inválido' });
      if (!(await CAP.search(sym.slice(0, -4))).includes(sym)) return send(res, 404, { error: `${sym} no existe en Binance (futuros, spot ni Alpha)` });
      if (!wl.includes(sym)) { wl.push(sym); writeJ(WL_FILE, wl); }
      return send(res, 200, { symbol: sym });
    }
    if (P === '/api/remove' && post) {
      if (sym in POS) return send(res, 400, { error: 'Cierra la posición abierta antes de quitar la moneda' });
      writeJ(WL_FILE, wl.filter(s => s !== sym));
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'No encontrado' });
  } catch (e) { return send(res, 500, { error: e.message }); }
}

const CAP = require('../trading/risk_manager.js')({ get, BASE, MEM, POS, readJ, writeJ, sum, analyzeC, SYM, dir: DATA_DIR });
KLH = CAP.klines;
const adaptiveRisk = require('../trading/adaptive_risk.js');
const PAPER = require('../trading/paper_engine.js')({
  dir: DATA_DIR,
  analyze: analyzeC,
  market: CAP.market,
  database,
  onTrade: event => notifyTelegram(event, fm)
});
module.exports = { backtest, learnStep, fitProb, closePos, learnInfo, core, handle, MEM, analyzeC, resolveSignals, X, analyze, monitorOnce, runScan, SCAN, POS, EVENTS, checkPositions };
async function start() {
  if (process.env.NODE_ENV === 'production' && !APP_PASSWORD) {
    throw new Error('APP_PASSWORD es obligatorio cuando NODE_ENV=production.');
  }
  loadWL();
  if (!notifyTelegram.isConfigured()) {
    console.warn('Telegram no está configurado. Copia .env.example a .env y agrega TELEGRAM_TOKEN y TELEGRAM_CHAT_ID.');
  }
  const backup = database.backup();
  if (backup) console.log(`Backup SQLite creado: ${backup}`);
  setInterval(saveMem, 15000); process.on('SIGINT', () => { saveMem(); database.close(); process.exit(0); });
  (async () => { for (;;) { try { await monitorOnce(); } catch (e) { /* sigue */ } await sleep(20000); } })();
  const srv = http.createServer(handle);
  srv.on('error', e => {
    if (e.code === 'EADDRINUSE') console.log(`El puerto ${PORT} ya está en uso (probablemente Glubi en Python u otra ventana de Node).\nCierra esa ventana o usa otro puerto:  set PORT=8766 && node glubi_server.js`);
    else console.log(e.message);
    process.exit(1);
  });
  srv.listen(PORT, HOST, () => {
    const address = HOST === '0.0.0.0' ? `http://<IP-de-tu-PC>:${PORT}` : `http://${HOST}:${PORT}`;
    console.log(`Glubi web (Node): ${address}   (Ctrl+C para salir)`);
  });
}
module.exports.start = start;