#!/usr/bin/env node
'use strict';
/* Uso: coloca este archivo y glubi_capital.js junto a glubi_server.js e index.html, y ejecuta:  node parchear.js
   Hace copias .bak, aplica los cambios solo si cada punto de anclaje se encuentra exactamente una vez, y
   revisa la sintaxis; si algo falla, restaura todo. */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const dir = process.cwd();
if (fs.existsSync(path.join(dir, 'core', 'server.js'))) {
  console.log('GLUBI ya usa la estructura modular; no hace falta aplicar el parche heredado.');
  process.exit(0);
}
const src = fs.readFileSync(__filename, 'utf8');
const S0 = '/*' + '@@DATA', S1 = '@@ENDDATA' + '*/';
const data = src.slice(src.indexOf(S0) + S0.length, src.lastIndexOf(S1));
const edits = []; let file = null, cur = null, mode = null;
for (const raw of data.split('\n')) {
  const line = raw.replace(/\r$/, '');
  if (line.startsWith('@@FILE ')) file = line.slice(7).trim();
  else if (line === '@@FIND') { cur = { file, find: [], repl: [] }; mode = 'find'; edits.push(cur); }
  else if (line === '@@WITH') mode = 'repl';
  else if (line === '@@END') mode = null;
  else if (mode) cur[mode].push(line);
}
const files = [...new Set(edits.map(e => e.file))], text = {}, crlf = {}, problems = [];
if (!fs.existsSync(path.join(dir, 'glubi_capital.js'))) problems.push('Falta glubi_capital.js en esta carpeta.');
for (const f of files) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) { problems.push('No encuentro ' + f + ' en ' + dir); continue; }
  let s = fs.readFileSync(p, 'utf8'); crlf[f] = s.includes('\r\n'); if (crlf[f]) s = s.replace(/\r\n/g, '\n');
  if (/glubi_capital|initCap\(/.test(s)) { console.log(f + ': ya estaba parchado, lo omito.'); continue; }
  text[f] = s;
}
edits.forEach((e, i) => {
  if (text[e.file] == null) return;
  const find = e.find.join('\n'), n = text[e.file].split(find).length - 1;
  if (n !== 1) problems.push(`${e.file}, cambio ${i + 1}: el ancla aparece ${n} veces (debe ser 1): ${find.slice(0, 70)}...`);
});
if (problems.length) { console.log('No se modificó nada:\n- ' + problems.join('\n- ')); process.exit(1); }
const done = Object.keys(text);
for (const f of done) fs.copyFileSync(path.join(dir, f), path.join(dir, f + '.bak'));
try {
  for (const e of edits) if (text[e.file] != null) text[e.file] = text[e.file].replace(e.find.join('\n'), () => e.repl.join('\n'));
  for (const f of done) fs.writeFileSync(path.join(dir, f), crlf[f] ? text[f].replace(/\n/g, '\r\n') : text[f]);
  for (const f of ['glubi_server.js', 'glubi_capital.js']) if (fs.existsSync(path.join(dir, f))) execFileSync(process.execPath, ['--check', path.join(dir, f)], { stdio: 'pipe' });
  console.log('Listo. Cambios aplicados a: ' + done.join(', ') + '. Copias en *.bak. Reinicia con: node glubi_server.js');
} catch (err) {
  for (const f of done) fs.copyFileSync(path.join(dir, f + '.bak'), path.join(dir, f));
  console.log('Falló y se restauraron los originales: ' + (err.stderr ? err.stderr.toString() : err.message)); process.exit(1);
}
/*@@DATA
@@FILE glubi_server.js
@@FIND
const SYM = /^[A-Z0-9]{2,20}USDT$/,
@@WITH
const SCAN_N = +process.env.SCAN_N || 150;
const SYM = /^[A-Z0-9_]{2,28}USDT$/,
@@END
@@FIND
const X = { klines: async (sym, tf, n = 500) => (await get(`${BASE}/klines?symbol=${sym}&interval=${tf}&limit=${n}`)).map(k => [Math.floor(+k[0] / 1000), +k[1], +k[2], +k[3], +k[4], +k[5]]) };
@@WITH
let KLH = null;
const X = { klines: async (sym, tf, n = 500) => {
  const alt = KLH ? await KLH(sym, tf, n) : null; if (alt) return alt;  // futuros o Alpha; si no, spot
  return (await get(`${BASE}/klines?symbol=${sym}&interval=${tf}&limit=${n}`)).map(k => [Math.floor(+k[0] / 1000), +k[1], +k[2], +k[3], +k[4], +k[5]]);
} };
@@END
@@FIND
const pnl = ((p.side === 'short' ? p.entry / px : px / p.entry) - 1) * 100,
@@WITH
const pnl = (p.side === 'short' ? 1 - px / p.entry : px / p.entry - 1) * 100,
@@END
@@FIND
MEM.trades.unshift({ symbol: sym, side: p.side || 'long', tf: p.tf, entry: p.entry, exit: px, pnl, time: now });
@@WITH
MEM.trades.unshift({ symbol: sym, side: p.side || 'long', tf: p.tf, entry: p.entry, exit: px, pnl, time: now }); CAP.onClose(sym, p, px, pnl, now);
@@END
@@FIND
g.done = out; const st =
@@WITH
g.done = out; CAP.onSignal(g, out); const st =
@@END
@@FIND
entry: a.price, stop: a.stop, target: a.target, x: a.rows.slice(0, 11).map(r => r.pts), done: null }
@@WITH
entry: a.price, stop: a.stop, target: a.target, rr: a.rr, ctx: CAP.snap(a), x: a.rows.slice(0, 11).map(r => r.pts), done: null }
@@END
@@FIND
const tick = await get(`${BASE}/ticker/24hr`, 120);
@@WITH
const tick = await CAP.tickers();
@@END
@@FIND
.sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 40);
@@WITH
.sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, SCAN_N);
@@END
@@FIND
p: a.prob.p, held: s in POS,
@@WITH
p: a.prob.p, ws: CAP.spot(s), held: s in POS,
@@END
@@FIND
a.pos = p ? { ...p, pnl: ((p.side === 'short' ? p.entry / a.price : a.price / p.entry) - 1) * 100 } : null;
@@WITH
a.pos = p ? { ...p, pnl: (p.side === 'short' ? 1 - a.price / p.entry : a.price / p.entry - 1) * 100 } : null;
      a.cap = CAP.advice(a);
@@END
@@FIND
alerted: null, x: a.rows.slice(0, 11).map(r => r.pts) };
@@WITH
alerted: null, x: a.rows.slice(0, 11).map(r => r.pts), ...CAP.onOpen(a, short) };
@@END
@@FIND
if (P === '/api/events') return send(res, 200, { events: EVENTS });
@@WITH
if (P.startsWith('/api/capital')) return CAP.route(P, q, post, res, send);
    if (P === '/api/events') return send(res, 200, { events: EVENTS });
@@END
@@FIND
const names = (await get(`${BASE}/ticker/price`, 300)).map(x => x.symbol).filter(s => s.endsWith('USDT') && s.slice(0, -4).includes(term));
@@WITH
const names = await CAP.search(term);
@@END
@@FIND
try { await get(`${BASE}/ticker/price?symbol=${sym}`, 5); } catch (e) { return send(res, 404, { error: `${sym} no existe en Binance` }); }
@@WITH
if (!(await CAP.search(sym.slice(0, -4))).includes(sym)) return send(res, 404, { error: `${sym} no existe en Binance (futuros, spot ni Alpha)` });
@@END
@@FIND
module.exports = { backtest,
@@WITH
const CAP = require('./glubi_capital.js')({ get, BASE, MEM, POS, readJ, writeJ, sum, analyzeC, SYM, dir: __dirname });
KLH = CAP.klines;
module.exports = { backtest,
@@END
@@FILE index.html
@@FIND
<div class="panel" id="open" style="display:none"></div>
@@WITH
<div class="panel" id="open" style="display:none"></div>
<div class="panel" id="capbox"></div>
@@END
@@FIND
const pnl=(sh?p.entry/px-1:px/p.entry-1)*100;
@@WITH
const pnl=(sh?1-px/p.entry:px/p.entry-1)*100;
@@END
@@FIND
curPos=a.pos;drawPos(a);drawSell(a);drawProb(a);
@@WITH
curPos=a.pos;drawPos(a);drawSell(a);drawProb(a);lastA=a;drawCapAdv(a);
@@END
@@FIND
try{err('');await loadSummary();await loadAnalysis()}catch(e){err(e)}}
@@WITH
try{err('');await loadSummary();await loadAnalysis();loadCap()}catch(e){err(e)}}
@@END
@@FIND
drawTfs();initChart();refresh();
@@WITH
drawTfs();initChart();initCap();refresh();
@@END
@@FIND
lastCoins=j.coins.map(c=>c.symbol);
@@WITH
lastCoins=j.coins.filter(c=>c.ws!==false).map(c=>c.symbol);
@@END
@@FIND
las 40 monedas USDT con más volumen de Binance
@@WITH
las monedas USDT con más volumen de Binance (futuros, spot y Alpha)
@@END
@@FIND
try{const t0=localStorage.getItem('gtf');
@@WITH
let CAPD=null,lastA=null,cfgDone=false;
const usd=n=>n==null?'-':(n<0?'-':'')+'$'+Math.abs(n).toLocaleString('en-US',{maximumFractionDigits:2});
const pcn=n=>n==null?'-':sg(+n.toFixed(2))+'%';
const cc=n=>n>0?'up':n<0?'dn':'';
const IS='font:inherit;background:#0b1220;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:5px 8px;width:150px';
function initCap(){
 $('capbox').innerHTML='<h3>Mi capital, PNL y metas (futuros)</h3><div id="capdyn"></div><div id="capadv"></div><div id="caplrn"></div>'+
 '<details id="capcfg" style="margin-top:12px"><summary class="mut" style="cursor:pointer">Configurar capital, riesgo y meta</summary><div class="chips" style="margin-top:10px">'+
 [['cf_cap','Capital inicial (USDT)'],['cf_lev','Apalancamiento máx.'],['cf_risk','Riesgo base por operación (%)'],['cf_rmax','Riesgo máximo (%)'],['cf_dloss','Pérdida diaria máx. (%)'],['cf_goal','Meta de capital (USDT)'],['cf_days','Días para la meta']].map(([i,l])=>`<label class="chip"><small>${l}</small><input id="${i}" type="number" step="any" style="${IS}"></label>`).join('')+
 `<label class="chip"><small>Bloqueo estricto</small><select id="cf_strict" style="${IS}"><option value="1">Sí</option><option value="0">No</option></select></label></div>`+
 `<p style="margin:10px 0 0"><button class="btn" id="csave">Guardar configuración</button> &nbsp; <input id="cf_flow" type="number" step="any" placeholder="Depósito (+) o retiro (-)" style="${IS}"> <button class="btn" id="cflow">Registrar movimiento</button></p></details>`}
document.addEventListener('click',async e=>{
 if(e.target.id==='csave'){const qs=new URLSearchParams();
  [['capital','cf_cap'],['lev','cf_lev'],['risk','cf_risk'],['riskMax','cf_rmax'],['dloss','cf_dloss'],['goal','cf_goal'],['days','cf_days'],['strict','cf_strict']].forEach(([k,i])=>{const el=$(i);if(el&&!el.disabled&&el.value.trim()!=='')qs.set(k,el.value.trim())});
  try{err('');await post('/api/capital/config?'+qs.toString());cfgDone=false;await loadCap();refresh()}catch(x){err(x)}}
 else if(e.target.id==='cflow'){const v=$('cf_flow').value.trim();if(!v)return;
  try{err('');await post('/api/capital/flow?amount='+encodeURIComponent(v));$('cf_flow').value='';cfgDone=false;await loadCap()}catch(x){err(x)}}
});
async function loadCap(){try{CAPD=await api('/api/capital');fillCfg(CAPD);drawCap(CAPD);if(lastA)drawCapAdv(lastA)}catch(e){}}
function fillCfg(j){if(cfgDone)return;cfgDone=true;const c=j.cfg,s=(i,v)=>{if(v!=null&&$(i))$(i).value=v};
 s('cf_cap',j.deposited||'');s('cf_lev',c.lev);s('cf_risk',c.risk);s('cf_rmax',c.riskMax);s('cf_dloss',c.dloss);s('cf_goal',c.goal?c.goal.target:'');s('cf_days',c.goal?c.goal.days:'');
 $('cf_strict').value=c.strict?'1':'0';$('cf_cap').disabled=!!j.deposited;if(!j.deposited)$('capcfg').open=true}
function drawCap(j){
 if(!j.deposited){$('capdyn').innerHTML='<p class="mut" style="margin:0">Escribe tu capital inicial abajo para activar el gestor: Glubi calculará el tamaño de cada operación según tu riesgo, llevará tu PNL y ROI y aprenderá de tus errores.</p>';$('caplrn').innerHTML='';return}
 const chip=(l,v,c)=>`<div class="chip"><small>${l}</small><b class="${c||''}" style="font-size:18px">${v}</b></div>`;
 const g=j.goal,bar=g?`<div style="margin:12px 0 4px"><div class="mut">Meta: ${usd(g.target)} en ${g.daysLeft} días (${g.progress.toFixed(0)}% del camino). Necesitas ${pcn(g.needDaily)} diario compuesto${g.hard?' — <b class="dn">poco realista: forzar el riesgo para alcanzarlo es la forma más rápida de perder el capital</b>':''}.</div><div style="height:8px;background:#0b1220;border-radius:6px;overflow:hidden;margin-top:6px"><div style="height:100%;width:${Math.max(0,Math.min(100,g.progress))}%;background:var(--acc)"></div></div></div>`:'';
 $('capdyn').innerHTML=`<div class="chips">${chip('Capital actual',usd(j.equity))}${chip('Aportado',usd(j.deposited))}${chip('PNL realizado',usd(j.realized),cc(j.realized))}${chip('PNL flotante',usd(j.unrealized),cc(j.unrealized))}${chip('ROI',pcn(j.roi),cc(j.roi))}${chip('PNL de hoy',usd(j.today)+(j.todayHit?' (límite)':''),cc(j.today))}${chip('Acierto',j.wr==null?'-':(j.wr*100).toFixed(0)+'% ('+j.n+')')}${chip('Profit factor',j.pf==null?'-':j.pf.toFixed(2))}${chip('Expectativa',j.expR==null?'-':sg(+j.expR.toFixed(2))+'R',cc(j.expR))}${chip('Drawdown máx.',j.maxDD.toFixed(1)+'%','dn')}</div>${bar}`;
 const tr=j.tags.map(t=>`<tr><td>${esc(t.tag)}</td><td>${t.n}</td><td>${(t.wr*100).toFixed(0)}%</td><td class="${cc(t.avgR)}">${sg(+t.avgR.toFixed(2))}R</td><td style="color:${t.status==='ok'?'var(--mut)':t.status==='bloqueada'?'var(--no)':'var(--wait)'}">${esc(t.status)}</td></tr>`).join('')||'<tr><td class="mut" colspan="5">Aún no hay suficientes casos (se llena con tus operaciones y las señales resueltas).</td></tr>';
 const er=j.errors.map(x=>`<li>${new Date(x.t*1000).toLocaleDateString()} ${esc(x.sym.replace('USDT',''))} ${x.side==='short'?'corto':'largo'}: <span class="dn">${usd(x.pnl)}</span>${x.R==null?'':' ('+x.R.toFixed(2)+'R)'}. ${esc(x.lesson)}</li>`).join('')||'<li class="mut">Sin pérdidas registradas todavía.</li>';
 const s=j.sim?`<p class="mut" style="margin:10px 0 0">Simulación: siguiendo las ${j.sim.n} señales de COMPRAR ya resueltas con ${j.sim.risk}% de riesgo y comisiones, acierto ${(j.sim.wr*100).toFixed(0)}%, expectativa ${sg(+j.sim.expR.toFixed(2))}R, profit factor ${j.sim.pf==null?'-':j.sim.pf.toFixed(2)}, resultado ${pcn(j.sim.ret)} y drawdown máx. ${j.sim.dd.toFixed(1)}%. Es historia, no promesa.</p>`:'';
 $('caplrn').innerHTML=`<div class="grid" style="margin-top:14px"><div><h3 style="font-size:14px" class="mut">Aprendizaje de errores: qué condiciones te funcionan</h3><table><thead><tr><th>Condición</th><th>Casos</th><th>Acierto</th><th>R medio</th><th>Regla</th></tr></thead><tbody>${tr}</tbody></table></div><div><h3 style="font-size:14px" class="mut">Últimas pérdidas y lección</h3><ul>${er}</ul></div></div>${s}`}
function drawCapAdv(a){const b=$('capadv');if(!b)return;const c=a.cap;if(!c||!c.on){b.innerHTML='';return}
 const blk=(t,s)=>`<div class="panel" style="margin:0;flex:1;min-width:260px"><b>${t}</b><div class="mut">${esc(s.why)}</div>${s.riskUsd>0?`<div>Riesgo ${s.risk.toFixed(2)}% = <b>${usd(s.riskUsd)}</b> | nocional <b>${usd(s.notional)}</b> | margen ${usd(s.margin)} con <b>${s.lev}x</b>${s.liq?' | liquidación aprox. '+fmt(s.liq):''}</div><div class="mut">Objetivo ≈ <span class="up">${usd(s.gainUsd)}</span> | stop ≈ <span class="dn">-${usd(s.riskUsd)}</span></div>`:'<div class="dn"><b>No operar</b></div>'}${s.fut&&s.riskUsd>0&&s.notional<5?'<div style="color:var(--wait)">Menor al nocional mínimo de futuros (5 USDT).</div>':''}<ul style="margin-top:6px">${s.reasons.map(x=>`<li class="mut">${esc(x)}</li>`).join('')}</ul></div>`;
 b.innerHTML=`<h3 style="margin-top:14px">Tamaño sugerido para ${esc(a.symbol.replace('USDT',''))} ${esc(a.tf)}${c.label?' ('+esc(c.label)+')':''}</h3><div style="display:flex;gap:12px;flex-wrap:wrap">${blk('Largo',c.long)}${blk('Corto',c.short)}</div>`}
try{const t0=localStorage.getItem('gtf');
@@END
@@ENDDATA*/