'use strict';

module.exports = function createCoreAnalysis({ step: STEP, htf: HTF, indicators, resolveSignal }) {
  const { sum, max, min, format: fm, ema, rsi: rsiS, atr, adx: adxS, macd: macdS, swings, clusters, trendline } = indicators;

return function core(k, sym, tf, o) {
  if (k.length < 60) throw new Error('Muy pocas velas para analizar esta moneda');
  const t = k.map(x => x[0]), h = k.map(x => x[2]), l = k.map(x => x[3]), c = k.map(x => x[4]), v = k.map(x => x[5] || 0);
  const n = c.length, price = c[n - 1], a = atr(h, l, c), E50 = ema(c, 50), E200 = ema(c, 200), rs = rsiS(c), r = rs[n - 1];
  const { adx: ADX, plusDi: pdi, minusDi: mdi } = adxS(h, l, c);
  const { line: MC, signal: MS, histogram: hist } = macdS(c);
  const adx = ADX[n - 1], rows = [];
  const add = (name, detail, pts) => rows.push({ name, detail, pts });
  const off = Math.max(0, n - 300), sw = swings(h.slice(off), l.slice(off), off), [res, sup] = clusters(sw, a, price);
  const alt = [];
  for (const q of [...sw].sort((x, y) => x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : 1))) {
    const last = alt[alt.length - 1];
    if (last && last[2] === q[2]) { if ((q[2] === 'H' && q[1] > last[1]) || (q[2] === 'L' && q[1] < last[1])) alt[alt.length - 1] = q; }
    else alt.push(q);
  }
  // 1) medias móviles
  const s = (price > E50[n - 1]) + (E50[n - 1] > E200[n - 1]) + (price > E200[n - 1]);
  add('Promedios EMA 50 y 200', `Precio ${price > E50[n - 1] ? '>' : '<'} EMA50 (${fm(E50[n - 1])}); EMA50 ${E50[n - 1] > E200[n - 1] ? '>' : '<'} EMA200 (${fm(E200[n - 1])})`, { 3: 2, 2: 1, 1: -1, 0: -2 }[s]);
  // 2) cruce dorado / de la muerte
  let cross = 0, ago = 0;
  for (let i = n - 1; i >= Math.max(1, n - 30); i--) { const d1 = E50[i] - E200[i], d0 = E50[i - 1] - E200[i - 1]; if (d0 <= 0 && d1 > 0) { cross = 1; ago = n - 1 - i; break; } if (d0 >= 0 && d1 < 0) { cross = -1; ago = n - 1 - i; break; } }
  add('Cruce de EMA 50/200', cross ? `Cruce ${cross > 0 ? 'dorado (EMA50 sube sobre EMA200)' : 'de la muerte (EMA50 cae bajo EMA200)'} hace ${ago} velas` : 'Sin cruce en las últimas 30 velas', cross);
  // 3) estructura de máximos y mínimos
  const hs = alt.filter(x => x[2] === 'H'), ls = alt.filter(x => x[2] === 'L'); let struc = 0, sdet = 'estructura mixta (sin HH/HL ni LH/LL claros)';
  if (hs.length >= 2 && ls.length >= 2) {
    const hh = hs.at(-1)[1] > hs.at(-2)[1], hl = ls.at(-1)[1] > ls.at(-2)[1];
    if (hh && hl) { struc = 2; sdet = 'máximos y mínimos cada vez más altos (HH/HL)'; } else if (!hh && !hl) { struc = -2; sdet = 'máximos y mínimos cada vez más bajos (LH/LL)'; }
  }
  add('Estructura del precio', sdet, struc);
  // 4) línea de tendencia con 3 toques
  const tlL = trendline(sw, 'L', a, n, t), tlH = trendline(sw, 'H', a, n, t), tl = tlL || tlH; let tp = 0, td = 'Sin línea de tendencia válida con 3 toques';
  if (tlL) { tp = price > tlL.now ? 1 : -1; td = `Línea alcista de 3 toques en ${fm(tlL.now)}: ${tp > 0 ? 'el precio la respeta' : 'el precio la rompió'}`; }
  else if (tlH) { tp = price < tlH.now ? -1 : 1; td = `Línea bajista de 3 toques en ${fm(tlH.now)}: ${tp < 0 ? 'sigue vigente' : 'rota al alza'}`; }
  add('Línea de tendencia', td, tp);
  // 5) ADX y +DI/-DI
  add('ADX (fuerza de la tendencia)', `ADX ${adx.toFixed(0)}, +DI ${pdi[n - 1].toFixed(0)} / -DI ${mdi[n - 1].toFixed(0)}: ${adx >= 25 ? 'tendencia sólida' : adx >= 20 ? 'tendencia en formación' : 'mercado lateral, los sistemas de tendencia fallan'}`, adx >= 25 ? (pdi[n - 1] > mdi[n - 1] ? 1 : -1) : 0);
  // 6) MACD con histograma
  const mu = MC[n - 1] > MS[n - 1] && hist[n - 1] > hist[n - 2], md = MC[n - 1] < MS[n - 1] && hist[n - 1] < hist[n - 2];
  add('MACD (impulso)', `MACD ${MC[n - 1] > MS[n - 1] ? 'sobre' : 'bajo'} su señal; histograma ${hist[n - 1] > hist[n - 2] ? 'creciendo' : 'decreciendo'}`, mu ? 1 : md ? -1 : 0);
  // 7) volumen (última vela cerrada contra el promedio de 20)
  let vm = 0; for (let j = n - 22; j < n - 2; j++) vm += v[j]; vm /= 20;
  const vr = vm ? v[n - 2] / vm : 1, upm = c[n - 2] > c[n - 5];
  add('Volumen', `${vr.toFixed(1)}x el promedio con el precio ${upm ? 'subiendo' : 'bajando'}${upm && vr < 0.7 ? ': sube sin respaldo' : ''}`, upm && vr >= 1 ? 1 : upm && vr < 0.7 ? -1 : !upm && vr >= 1.2 ? -1 : 0);
  const fam = [['Estructura', rows[2].pts], ['Medias', rows[0].pts], ['ADX', rows[4].pts], ['MACD', rows[5].pts], ['Volumen', rows[6].pts]];
  const conf = { bull: fam.filter(x => x[1] > 0).length, bear: fam.filter(x => x[1] < 0).length, items: fam.map(x => ({ n: x[0], d: Math.sign(x[1]) })) };
  const tdir = adx < 20 ? 0 : conf.bull >= 3 && conf.bull > conf.bear ? 1 : conf.bear >= 3 && conf.bear > conf.bull ? -1 : 0;
  const trend = adx < 20 ? 'LATERAL' : tdir === 1 ? 'ALCISTA' : tdir === -1 ? 'BAJISTA' : 'MIXTO';
  // 8) trigonometría: ángulo de la pendiente (30 velas, en ATR por vela)
  const m = 30, ys = c.slice(-m), xm = (m - 1) / 2, ym = sum(ys) / m; let num = 0, den = 0; ys.forEach((y, i) => { num += (i - xm) * (y - ym); den += (i - xm) ** 2; });
  const ang = Math.atan(num / den / a) * 180 / Math.PI;
  add('Ángulo de tendencia (arctan)', `${ang.toFixed(1)}° sobre las últimas 30 velas; ±10° marca tendencia`, ang >= 10 ? 1 : ang <= -10 ? -1 : 0);
  add('RSI 14', r.toFixed(0) + (r <= 30 ? ' (sobreventa)' : r >= 70 ? ' (sobrecompra)' : ' (neutral)'), r <= 30 ? 1 : r >= 70 ? -1 : 0);
  // 10) Fibonacci sobre la pierna de las últimas 100 velas
  const sh = h.slice(-100), sl = l.slice(-100), H = max(sh), L = min(sl), up = sl.indexOf(L) < sh.indexOf(H), rng = Math.max(H - L, 1e-12);
  const pr = up ? (H - price) / rng : (price - L) / rng, at = q => up ? H - q * rng : L + q * rng, ext = q => up ? L + q * rng : H - q * rng;
  let base, zona;
  if (pr < 0.5) [base, zona] = [1, 'cerca del extremo de la pierna (retroceso leve)'];
  else if (pr <= 0.786) [base, zona] = [2, 'zona de retroceso profundo 0.5 a 0.786'];
  else [base, zona] = [-1, 'superó 0.786: la pierna se debilita'];
  add('Fibonacci', `Pierna ${up ? 'alcista' : 'bajista'} ${fm(L)} a ${fm(H)}; retroceso ${pr.toFixed(2)}: ${zona}`, up ? base : -base);
  // 11) riesgo / beneficio
  const tgt = res.length ? res[0][0] : price + 2 * a; let stop = sup.length ? sup[0][0] - 0.3 * a : price - 1.5 * a;
  stop = Math.max(Math.min(stop, price - 0.8 * a), price - 3 * a);
  const rr = (tgt - price) / (price - stop), stopS = Math.min(Math.max(res.length ? res[0][0] + 0.3 * a : price + 1.5 * a, price + 0.8 * a), price + 3 * a), tgtS = sup.length ? sup[0][0] : price - 2 * a;
  add('Riesgo / beneficio', `Objetivo ${fm(tgt)}, stop ${fm(stop)}, R/R ${rr.toFixed(2)}`, rr >= 2 ? 1 : rr < 1 ? -1 : 0);
  // 12) red neuronal: solo suma al puntaje si demostró ventaja fuera de muestra
  const nn = null;
  // próximo punto de inflexión
  let nxt = null;
  if (alt.length >= 4) {
    const gaps = alt.slice(1).map((x, i) => x[0] - alt[i][0]).slice(-6), avg = sum(gaps) / gaps.length, lastQ = alt[alt.length - 1];
    const left = Math.max(1, Math.round(lastQ[0] + avg - (n - 1))), kind = lastQ[2] === 'H' ? 'L' : 'H';
    nxt = { type: kind, bars: left, time: t[n - 1] + left * STEP[tf], price: kind === 'L' ? (sup.length ? sup[0][0] : at(0.618)) : (res.length ? res[0][0] : ext(1.272)), avg: Math.round(avg * 10) / 10 };
  }
  // temporalidad superior (de arriba hacia abajo): no comprar contra ella
  const htfA = o.htfA || null;
  const htfBear = !!htfA && htfA.tdir === -1, score = rows.reduce((z, x) => z + x.pts, 0);
  const signal = resolveSignal({
    score, rr, adx, confluence: conf, againstHigherTimeframe: htfBear,
    higherTimeframe: htfA ? `${HTF[tf]}: ${htfA.trend}` : null
  });
  const dec = signal.decision, why = signal.reason;
  // mejor momento de venta
  const r1 = res.length ? res[0][0] : tgt;
  const checks = [{ t: 'El precio está en la zona de resistencia o sobre el objetivo', ok: price >= r1 - 0.3 * a }, { t: 'RSI alto (65 o más)', ok: r >= 65 },
    { t: 'Momentum en contra (puntaje -1 o menos)', ok: score <= -1 }, { t: 'Giro a la baja cercano (máximo estimado en 3 velas o menos)', ok: !!(nxt && nxt.type === 'H' && nxt.bars <= 3) }];
  const nok = checks.filter(x => x.ok).length;
  const sell = { low: r1 - 0.3 * a, high: r1, checks, ok: nok, label: nok >= 3 ? 'Buen momento para vender' : nok === 2 ? 'Cerca del mejor momento' : 'Todavía no',
    when: nxt && nxt.type === 'H' ? `Máximo estimado en unas ${nxt.bars} velas, cerca de ${fm(nxt.price)}.` : '' };
  const fl = Math.min(at(0.5), at(0.618)), fh = Math.max(at(0.5), at(0.618)), s1 = sup.length ? sup[0][0] : null;
  const bz = up ? [fl, fh] : s1 ? [s1, s1 + 0.5 * a] : [price - a, price];
  const bchk = [{ t: 'El precio está dentro o cerca de la zona de compra', ok: price <= bz[1] + 0.3 * a && price >= bz[0] - 0.5 * a }, { t: 'Tendencia alcista con ADX de 20 o más', ok: tdir === 1 },
    { t: 'Impulso girando al alza (MACD)', ok: rows[5].pts > 0 }, { t: 'El volumen acompaña', ok: rows[6].pts > 0 }, { t: 'La temporalidad superior no es bajista', ok: !htfBear }];
  const bok = bchk.filter(x => x.ok).length;
  const buy = { low: bz[0], high: bz[1], checks: bchk, ok: bok, label: bok >= 4 ? 'Buen momento para comprar' : bok === 3 ? 'Cerca del mejor momento' : 'Todavía no' };
  const pv = (h[n - 2] + l[n - 2] + c[n - 2]) / 3;
  return { symbol: sym, tf, price, decision: dec, reason: why, score, rr, entry: price, stop, target: tgt, stop_s: stopS, target_s: tgtS, trend, tdir, conf, adx, sell, buy, rsi: r, atr: a, angle: ang,
    ctx: htfA ? `${HTF[tf]}: ${htfA.trend}` : null, nn, tl: tl ? { t1: tl.t1, p1: tl.p1, t2: tl.t2, p2: tl.p2 } : null, rows, res, sup, next: nxt,
    modelData: { close: c, volume: v, ema50: E50, ema200: E200, rsi: rs, adx: ADX, plusDi: pdi, minusDi: mdi, macdHistogram: hist },
    fib: { up, high: H, low: L, levels: [0.236, 0.382, 0.5, 0.618, 0.786].map(q => ({ r: q, price: at(q) })), ext: [1.272, 1.618].map(q => ({ r: q, price: ext(q) })) },
    pivot: { P: pv, R1: 2 * pv - l[n - 2], S1: 2 * pv - h[n - 2] },
    candles: k.map(x => ({ time: x[0], open: x[1], high: x[2], low: x[3], close: x[4] })),
    ema50: t.slice(49).map((tt, i) => ({ time: tt, value: E50[i + 49] })), ema200: t.slice(199).map((tt, i) => ({ time: tt, value: E200[i + 199] })) };
}
};
