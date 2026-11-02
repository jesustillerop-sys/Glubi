'use strict';
/* glubi_capital.js: capital, PNL/ROI, metas, aprendizaje de errores y universo completo (futuros, spot y Alpha).
   Se carga desde glubi_server.js (lo instala parchear.js). Guarda todo en account.json.
   Herramienta de análisis, no es consejo financiero. */
const path = require('path');
const createSpotExchange = require('../exchanges/binance_spot.js');
const createUsdMExchange = require('../exchanges/binance_usdm.js');
const createAlphaExchange = require('../exchanges/binance_alpha.js');
const adaptiveRisk = require('./adaptive_risk.js');
module.exports = function (D) {
  const { get, BASE, MEM, POS, readJ, writeJ, sum, analyzeC, SYM } = D;
  const spotExchange = createSpotExchange({ get, base: BASE });
  const usdMExchange = createUsdMExchange({ get });
  const alphaExchange = createAlphaExchange({ get });
  const FILE = path.join(D.dir, 'account.json');
  const DEF = { lev: 5, risk: 1, riskMax: 2, dloss: 3, fee: 0.05, maxMargin: 60, strict: true, goal: null };
  const A = Object.assign({ cfg: {}, ledger: [], tags: {}, errors: [] }, readJ(FILE, {}));
  A.cfg = Object.assign({}, DEF, A.cfg);
  A.stopLearning = adaptiveRisk.normalizeLearning(A.stopLearning);
  const save = () => writeJ(FILE, A);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const num = (v, a, b, d) => { const x = parseFloat(v); return Number.isFinite(x) ? clamp(x, a, b) : d; };

  // ---------- universo: futuros perpetuos + spot + Alpha ----------
  const U = { t: 0, p: null, fut: new Set(), spot: new Set(), alpha: new Map() };
  function loadU() {
    if (U.p && Date.now() - U.t < 30 * 60e3) return U.p;
    U.t = Date.now();
    U.p = (async () => {
      const [sp, fu, al] = await Promise.allSettled([spotExchange.symbols(), usdMExchange.exchangeInfo(), alphaExchange.tokens()]);
      if (sp.status === 'fulfilled') U.spot = new Set(sp.value.map(x => x.symbol).filter(s => s.endsWith('USDT') && SYM.test(s)));
      if (fu.status === 'fulfilled') U.fut = new Set((fu.value.symbols || []).filter(s => s.contractType === 'PERPETUAL' && s.status === 'TRADING' && s.quoteAsset === 'USDT').map(s => s.symbol).filter(s => SYM.test(s)));
      if (al.status === 'fulfilled') U.alpha = alphaExchange.list(al.value, SYM, U.spot, U.fut);
      if (!U.spot.size && !U.fut.size && !U.alpha.size) throw new Error('No pude cargar la lista de monedas de Binance');
      return true;
    })();
    U.p.catch(() => { U.t = 0; });
    return U.p;
  }
  const market = s => U.fut.has(s) ? 'F' : U.spot.has(s) ? 'S' : U.alpha.has(s) ? 'A' : 'S';
  const spot = s => U.spot.has(s) || !(U.fut.has(s) || U.alpha.has(s));  // ¿sirve el websocket spot?
  async function universe() { await loadU(); return [...new Set([...U.fut, ...U.spot, ...U.alpha.keys()])]; }
  async function search(term) {
    await loadU(); const t = String(term || '').toUpperCase();
    return (await universe()).filter(s => s.slice(0, -4).includes(t) || ((U.alpha.get(s) || {}).name || '').includes(t)).slice(0, 40);
  }
  async function klines(sym, tf, n) {  // null = usar spot (comportamiento original)
    try { await loadU(); } catch (e) { return null; }
    const m = market(sym);
    if (m === 'F') { try { return await usdMExchange.klines(sym, tf, Math.min(n, 1500)); } catch (e) { return null; } }
    if (m === 'A') {
      return alphaExchange.klines(sym, tf, Math.min(n, 1000));
    }
    return null;
  }
  async function tickers() {  // futuros primero; luego spot y Alpha para lo que no tiene futuros
    try { await loadU(); } catch (e) { /* sigue */ }
    const [f, s] = await Promise.allSettled([usdMExchange.tickers(), spotExchange.tickers()]);
    const out = [], seen = new Set();
    for (const x of [...(f.status === 'fulfilled' ? f.value : []), ...(s.status === 'fulfilled' ? s.value : [])]) if (!seen.has(x.symbol)) { seen.add(x.symbol); out.push(x); }
    for (const [id, t] of U.alpha) if (!seen.has(id)) out.push({ symbol: id, quoteVolume: t.vol, priceChangePercent: t.chg });
    if (!out.length) throw new Error('Sin datos de mercado');
    return out;
  }

  // ---------- cuenta: capital, PNL, ROI ----------
  const trades = () => A.ledger.filter(e => e.type === 'trade');
  const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() / 1000; };
  const deposited = () => sum(A.ledger.filter(e => e.type === 'dep' && e.amt > 0).map(e => e.amt));
  const netDep = () => sum(A.ledger.filter(e => e.type === 'dep').map(e => e.amt));
  const realized = () => netDep() + sum(trades().map(e => e.pnl));
  let UNR = 0;
  const eq = () => realized() + Math.min(0, UNR);  // para dimensionar: cuenta las pérdidas flotantes, no las ganancias
  const ratioOf = (p, px) => p.side === 'short' ? 1 - px / p.entry : px / p.entry - 1;  // movimiento del precio a favor (+) o en contra (-)
  const netUsd = (p, px) => Math.max(p.notional * (ratioOf(p, px) - 2 * (p.fee || 0)), -(p.margin || Infinity));
  function curve() {
    let e = 0, peak = 0, dd = 0, now = 0;
    for (const x of A.ledger) { e += x.type === 'dep' ? x.amt : x.pnl; peak = Math.max(peak, e); now = peak > 0 ? (peak - e) / peak * 100 : 0; dd = Math.max(dd, now); }
    return { dd, now };
  }
  function dailyHit() {
    const pnl = sum(trades().filter(e => e.t >= dayStart()).map(e => e.pnl));
    return { pnl, hit: A.cfg.dloss > 0 && pnl < 0 && pnl <= -(A.cfg.dloss / 100) * Math.max(realized() - pnl, 1) };
  }

  // ---------- aprendizaje de errores: etiquetas de proceso con resultado en R ----------
  function tagsFor(a, side) {
    const L = side !== 'short', t = [], rows = a.rows || [];
    if (a.adx < 20) t.push('ADX bajo (lateral)');
    if (L ? /BAJISTA/.test(a.ctx || '') : /ALCISTA/.test(a.ctx || '')) t.push('Contra temporalidad superior');
    if (L ? a.rsi >= 70 : a.rsi <= 30) t.push('RSI extremo a favor (persigue el precio)');
    const rr = L ? a.rr : (a.price - a.target_s) / Math.max(a.stop_s - a.price, 1e-12);
    if (rr < 1.5) t.push('R/R menor a 1.5');
    if ((L ? a.conf.bull : a.conf.bear) < 3) t.push('Sin confluencia (menos de 3 de 5)');
    if (L ? a.score <= 0 : a.score >= 0) t.push('Contra el puntaje');
    if (rows[5] && (L ? rows[5].pts < 0 : rows[5].pts > 0)) t.push('MACD en contra');
    if (rows[6] && (L ? rows[6].pts < 0 : rows[6].pts > 0)) t.push('Volumen en contra');
    if (a.atr / a.price > 0.03) t.push('Volatilidad alta (ATR mayor a 3%)');
    t.push('Período ' + a.tf);
    const m = market(a.symbol); if (m === 'A') t.push('Mercado Alpha'); else if (m === 'S') t.push('Sin futuros (spot)');
    return t;
  }
  const snap = a => { try { return tagsFor(a, 'long'); } catch (e) { return []; } };
  const bump = (tag, R, win) => { const s = A.tags[tag] || (A.tags[tag] = { n: 0, w: 0, sumR: 0 }); s.n++; s.w += win ? 1 : 0; s.sumR += R; };
  const tagState = s => { const wr = s.w / s.n, avg = s.sumR / s.n; return s.n >= 8 && wr < 0.30 && avg < 0 ? 'bloqueada' : s.n >= 5 && wr < 0.40 && avg < 0 ? 'riesgo a la mitad' : 'ok'; };
  function gateFor(a, side) {
    const tags = tagsFor(a, side), warn = [], g = { tags, warn, block: false, mult: 1 };
    for (const t of tags) {
      const s = A.tags[t]; if (!s) continue; const st = tagState(s), txt = `${t}: ${s.w}/${s.n} ganadas, ${(s.sumR / s.n).toFixed(2)}R promedio`;
      if (st === 'bloqueada') { g.block = true; warn.push(txt + ' → bloqueada'); } else if (st === 'riesgo a la mitad') { g.mult *= 0.5; warn.push(txt + ' → riesgo a la mitad'); }
    }
    const T = trades(), c = curve();
    if (T.length >= 3 && T.slice(-3).every(x => x.pnl < 0)) { g.mult *= 0.5; warn.push('3 pérdidas seguidas → riesgo a la mitad'); }
    if (c.now > 20) { g.mult *= 0.25; warn.push(`Drawdown actual ${c.now.toFixed(0)}% → riesgo al 25%`); } else if (c.now > 10) { g.mult *= 0.5; warn.push(`Drawdown actual ${c.now.toFixed(0)}% → riesgo a la mitad`); }
    const d = dailyHit(); if (d.hit) { g.block = true; warn.push('Límite de pérdida diaria alcanzado: hoy no se abren más operaciones'); }
    const m = market(a.symbol);
    if (side === 'short' && m !== 'F') { g.block = true; warn.push('Esta moneda no tiene futuros: no se puede abrir corto'); }
    if (m === 'A') warn.push('Alpha: solo spot, sin apalancamiento y con poca liquidez');
    return g;
  }

  // ---------- tamaño de la operación: riesgo fijo por stop, Kelly fraccionado, margen y liquidación ----------
  function size(a, side) {
    const c = A.cfg, L = side !== 'short', entry = a.price, stop = L ? a.stop : a.stop_s, target = L ? a.target : a.target_s;
    const sd = Math.abs(entry - stop) / entry, rr = Math.abs(target - entry) / Math.max(Math.abs(entry - stop), 1e-12);
    const g = gateFor(a, side), mk = market(a.symbol), fut = mk === 'F', fee = (fut ? c.fee : 0.1) / 100, E = eq(), base = c.risk / 100;
    let r = base * 0.5, why = L ? 'Sin ventaja estadística validada: riesgo reducido' : 'Corto: aún sin modelo validado, riesgo reducido';
    const pr = a.prob || {};
    if (L && pr.p != null) {
      if (pr.ev <= 0) { r = 0; why = 'Valor esperado no positivo (EV ' + pr.ev.toFixed(2) + 'R): no operar'; }
      else if (pr.useful) { const k = (pr.p * rr - (1 - pr.p)) / rr; r = clamp(0.25 * k, base * 0.5, c.riskMax / 100); why = `Cuarto de Kelly con ventaja validada (P ${(pr.p * 100).toFixed(0)}%, EV ${pr.ev.toFixed(2)}R)`; }
    }
    if (rr < 1) { r = 0; why = 'R/R menor a 1: no operar'; }
    r *= g.mult;
    if (g.block) { if (c.strict) { r = 0; why = 'Bloqueada por reglas de protección'; } else r = Math.min(r, base * 0.25); }
    if (E <= 0) { r = 0; why = 'Sin capital disponible'; }
    let riskUsd = E * r, notional = riskUsd / (sd + 2 * fee), note = '';
    const Lmax = Math.max(1, Math.floor(1 / (sd * 1.5 + 0.005))), lev = fut ? Math.min(c.lev, Lmax) : 1;  // la liquidación debe quedar más lejos que el stop
    if (fut && lev < c.lev) note = `Apalancamiento limitado a ${lev}x para que la liquidación quede más lejos que el stop`;
    let margin = notional / lev; const room = E * c.maxMargin / 100 - sum(Object.values(POS).map(p => p.margin || 0));
    if (margin > room) { const k = Math.max(room, 0) / margin; notional *= k; margin *= k; riskUsd *= k; note = 'Limitado por el margen máximo permitido'; }
    const liq = fut ? (L ? entry * (1 - 1 / lev + 0.005) : entry * (1 + 1 / lev - 0.005)) : null;
    const reasons = [...(r === 0 ? [why] : []), ...g.warn]; if (note) reasons.push(note);
    return { side, risk: riskUsd / Math.max(E, 1e-12) * 100, riskUsd, notional, margin, lev, liq, sd, fee, rr, mk, fut, why, reasons, tags: g.tags, block: g.block,
      gainUsd: notional * (Math.abs(target - entry) / entry - 2 * fee) };
  }
  function advice(a) {
    try {
      if (netDep() <= 0) return { on: false };
      const al = U.alpha.get(a.symbol);
      return { on: true, eq: eq(), label: al ? a.symbol.replace('USDT', '') + ' = ' + al.name : null, long: size(a, 'long'), short: size(a, 'short') };
    } catch (e) { return { on: false }; }
  }
  function onOpen(a, short) {  // devuelve los campos de dinero que se guardan en la posición
    if (netDep() <= 0) return {};
    const s = size(a, short ? 'short' : 'long');
    if (A.cfg.strict && (s.block || s.riskUsd <= 0)) throw new Error('Bloqueado por el gestor de capital: ' + (s.reasons.join(' | ') || s.why));
    return {
      notional: s.notional,
      margin: s.margin,
      lev: s.lev,
      riskUsd: s.riskUsd,
      sd: s.sd,
      fee: s.fee,
      mk: s.mk,
      tags: s.tags,
      trailAtrMultiplier: A.stopLearning.atrMultiplier
    };
  }
  function onClose(sym, p, px, pct, now) {  // al cerrar: asienta el PNL real y aprende de la operación
    if (!p.notional) return;
    const ratio = ratioOf(p, px), pnl = netUsd(p, px), R = p.sd ? ratio / p.sd : null, win = pnl > 0, short = p.side === 'short';
    const why = (short ? px >= p.stop : px <= p.stop) ? 'stop' : (short ? px <= p.target : px >= p.target) ? 'objetivo' : 'manual';
    adaptiveRisk.recordStopOutcome(A.stopLearning, { reason: why, rMultiple: R, closedAt: now });
    A.ledger.push({ type: 'trade', t: now, sym, side: p.side || 'long', tf: p.tf, entry: p.entry, exit: px, notional: p.notional, margin: p.margin, lev: p.lev, pnl, fee: p.notional * (p.fee || 0) * 2, R, pct: ratio * 100, risk: p.riskUsd, tags: p.tags || [], why });
    if (A.ledger.length > 5000) A.ledger.splice(0, A.ledger.length - 5000);
    if (R != null) for (const t of p.tags || []) bump(t, R, win);
    if (!win) {
      const flaws = (p.tags || []).filter(t => !/^Período |^Mercado /.test(t)), bad = flaws.filter(t => A.tags[t] && tagState(A.tags[t]) !== 'ok');
      const lesson = (flaws.length ? 'Entraste con: ' + flaws.join(', ') + '.' : 'Entrada sin fallas de proceso detectadas: pérdida dentro del plan.') + (why === 'manual' ? ' Cerraste a mano antes del stop.' : '') + (bad.length ? ' Patrón repetido: ' + bad.join(', ') + '.' : '');
      A.errors.unshift({ t: now, sym, side: p.side || 'long', pnl, R, why, tags: flaws, lesson }); A.errors.length = Math.min(A.errors.length, 50);
    }
    save();
  }
  function onSignal(g, out) {  // cada señal de COMPRAR resuelta también enseña a las etiquetas
    if (!g.ctx || out === 'expirada' || !(g.rr > 0)) return;
    for (const t of g.ctx) bump(t, out === 'acierto' ? g.rr : -1, out === 'acierto');
    save();
  }

  // ---------- resumen: metas, estadísticas y simulación ----------
  function sim() {  // qué habría pasado siguiendo todas las señales de COMPRAR resueltas, con comisiones
    const S = (MEM.signals || []).filter(g => (g.done === 'acierto' || g.done === 'fallo') && g.rr > 0 && g.entry && g.stop).sort((x, y) => x.time - y.time);
    if (!S.length) return null;
    const risk = A.cfg.risk / 100, fee = A.cfg.fee / 100; let e = 100, peak = 100, dd = 0, w = 0, gw = 0, gl = 0, sr = 0;
    for (const g of S) {
      const sd = Math.abs(g.entry - g.stop) / g.entry || 0.01, R = (g.done === 'acierto' ? g.rr : -1) - 2 * fee / sd;
      if (R > 0) gw += R; else gl -= R;
      if (g.done === 'acierto') w++; sr += R; e *= 1 + risk * R; peak = Math.max(peak, e); dd = Math.max(dd, (peak - e) / peak * 100);
    }
    return { n: S.length, wr: w / S.length, expR: sr / S.length, pf: gl ? gw / gl : null, ret: e - 100, dd, risk: A.cfg.risk };
  }
  async function summary() {
    let unr = 0;
    await Promise.all(Object.entries(POS).map(async ([s, p]) => {
      if (!p.notional) return;
      try { const a = await analyzeC(s, p.tf); unr += netUsd(p, a.price); } catch (e) { /* sin precio */ }
    }));
    UNR = unr;
    const T = trades(), dep = deposited(), pnl = sum(T.map(t => t.pnl)), equity = realized() + unr, wins = T.filter(t => t.pnl > 0), loss = T.filter(t => t.pnl <= 0);
    const gw = sum(wins.map(t => t.pnl)), gl = -sum(loss.map(t => t.pnl)), Rs = T.filter(t => t.R != null), c = curve(), d = dailyHit();
    let goal = null; const G = A.cfg.goal;
    if (G && G.target > 0) {
      const daysLeft = Math.max(1, Math.ceil((G.t0 + G.days * 86400 - Date.now() / 1000) / 86400)), need = equity > 0 ? (Math.pow(G.target / equity, 1 / daysLeft) - 1) * 100 : null;
      goal = { target: G.target, days: G.days, daysLeft, start: G.start, progress: G.target > G.start ? (equity - G.start) / (G.target - G.start) * 100 : 0, needDaily: need, hard: need != null && need > 2 };
    }
    const tags = Object.entries(A.tags).filter(([, s]) => s.n >= 2).map(([tag, s]) => ({ tag, n: s.n, wr: s.w / s.n, avgR: s.sumR / s.n, status: tagState(s) })).sort((x, y) => x.avgR - y.avgR).slice(0, 12);
    return { cfg: A.cfg, deposited: dep, net: netDep(), equity, realized: pnl, unrealized: unr, roi: dep > 0 ? (pnl + unr) / dep * 100 : null, today: d.pnl, todayHit: d.hit,
      n: T.length, wr: T.length ? wins.length / T.length : null, pf: gl ? gw / gl : null, expR: Rs.length ? sum(Rs.map(t => t.R)) / Rs.length : null, maxDD: c.dd, ddNow: c.now,
      goal, tags, errors: A.errors.slice(0, 5), sim: sim(),
      stopLearning: adaptiveRisk.summary(A.stopLearning) };
  }

  // ---------- rutas /api/capital ----------
  async function route(P, q, post, res, send) {
    if (P === '/api/capital' && !post) return send(res, 200, await summary());
    if (P === '/api/capital/config' && post) {
      const c = A.cfg, cap = parseFloat(q.capital);
      if (Number.isFinite(cap) && cap > 0) {
        if (netDep() > 0 || A.ledger.some(e => e.type === 'dep')) { if (Math.abs(cap - deposited()) > 1e-9) return send(res, 400, { error: 'El capital inicial ya está registrado: usa "Registrar movimiento" para depositar o retirar' }); }
        else A.ledger.push({ type: 'dep', t: Math.floor(Date.now() / 1000), amt: cap });
      }
      c.lev = num(q.lev, 1, 125, c.lev); c.risk = num(q.risk, 0.1, 5, c.risk); c.riskMax = Math.max(num(q.riskMax, 0.1, 5, c.riskMax), c.risk);
      c.dloss = num(q.dloss, 0, 50, c.dloss); c.fee = num(q.fee, 0, 1, c.fee); c.maxMargin = num(q.maxMargin, 5, 100, c.maxMargin);
      if (q.strict != null && q.strict !== '') c.strict = q.strict !== '0';
      if (q.goal != null && q.goal !== '') {
        const g = parseFloat(q.goal), days = Math.max(1, Math.round(parseFloat(q.days) || (c.goal && c.goal.days) || 30));
        c.goal = g > 0 ? { target: g, days, t0: Math.floor(Date.now() / 1000), start: Math.max(realized(), 0) } : null;
      }
      save(); return send(res, 200, { ok: true });
    }
    if (P === '/api/capital/flow' && post) {
      const amt = parseFloat(q.amount);
      if (!Number.isFinite(amt) || amt === 0) return send(res, 400, { error: 'Monto inválido' });
      if (amt < 0 && -amt > realized()) return send(res, 400, { error: 'No puedes retirar más que tu capital realizado' });
      A.ledger.push({ type: 'dep', t: Math.floor(Date.now() / 1000), amt }); save(); return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'No encontrado' });
  }

  return {
    klines, universe, search, tickers, market, spot, advice, onOpen, onClose, onSignal, snap, route, summary,
    stopMultiplier: () => A.stopLearning.atrMultiplier,
    _A: A
  };
};