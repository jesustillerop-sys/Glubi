const TFS=['5m','15m','30m','1h','4h','1d'];let tf='1h',sel=null,chart,cs,e50,e200,tls,lines=[];
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>n==null?'-':(Math.abs(n)>=100?n.toLocaleString('en-US',{maximumFractionDigits:2}):Math.abs(n)>=1?n.toFixed(4):n.toFixed(6));
const NAME={COMPRAR:'COMPRAR',ESPERAR:'ESPERAR',VENDER:'VENDER',CERRAR:'CERRAR CORTO',MANTENER:'MANTENER',PREPARAR:'PREPARACIÓN',CONFIRMADA:'CONFIRMADA',CANCELADA:'CANCELADA'};
const col=d=>d==='COMPRAR'||d==='CONFIRMADA'?'var(--ok)':d==='VENDER'||d==='CERRAR'||d==='CANCELADA'?'var(--no)':'var(--wait)';
const sg=n=>(n>0?'+':'')+n;
const post=(p)=>api(p,{method:'POST',headers:{'X-Glubi':'1'}});
async function api(p,o){const r=await fetch(p,o);const j=await r.json();if(j.error)throw new Error(j.error);return j}
const err=e=>{$('msg').textContent=e?e.message||e:''};
function applyTheme(){
 const dark=document.documentElement.dataset.theme==='dark',style=getComputedStyle(document.documentElement);
 const bg=style.getPropertyValue('--surface').trim(),ink=style.getPropertyValue('--ink').trim(),grid=style.getPropertyValue('--line').trim();
 ['theme-toggle','theme-toggle-mobile'].forEach(id=>{const b=$(id);if(b){b.textContent=dark?'☾':'☼';b.title=dark?'Cambiar a tema claro':'Cambiar a tema oscuro';b.setAttribute('aria-label',b.title)}});
 if(chart)chart.applyOptions({layout:{background:{color:bg},textColor:ink},grid:{vertLines:{color:grid},horzLines:{color:grid}},rightPriceScale:{borderColor:grid},timeScale:{borderColor:grid}});
 if(PAPERD)drawDashboard(PAPERD);
}
function setTheme(){
 const next=document.documentElement.dataset.theme==='dark'?'light':'dark';
 document.documentElement.dataset.theme=next;
 try{localStorage.setItem('glubi-theme',next)}catch(e){err('No se pudo guardar la preferencia del tema.')}
 applyTheme();
}
function initChart(){
 const style=getComputedStyle(document.documentElement),bg=style.getPropertyValue('--surface').trim(),ink=style.getPropertyValue('--ink').trim(),grid=style.getPropertyValue('--line').trim();
 chart=LightweightCharts.createChart($('chart'),{height:390,layout:{background:{color:bg},textColor:ink},grid:{vertLines:{color:grid},horzLines:{color:grid}},rightPriceScale:{borderColor:grid},timeScale:{borderColor:grid,timeVisible:true}});
 cs=chart.addCandlestickSeries({upColor:'#34d399',downColor:'#f87171',borderVisible:false,wickUpColor:'#34d399',wickDownColor:'#f87171'});
 e50=chart.addLineSeries({color:'#38bdf8',lineWidth:2,priceLineVisible:false,lastValueVisible:false});
 e200=chart.addLineSeries({color:'#a78bfa',lineWidth:2,priceLineVisible:false,lastValueVisible:false});
 tls=chart.addLineSeries({color:'#fbbf24',lineWidth:1,lineStyle:2,priceLineVisible:false,lastValueVisible:false});
 const fit=()=>chart.applyOptions({width:$('chart').clientWidth});fit();addEventListener('resize',fit);
}
function drawTfs(){$('tfs').innerHTML=TFS.map(t=>`<button class="${t===tf?'on':''}" data-t="${t}">${t}</button>`).join(' ')}
async function loadSummary(){
 const j=await api('/api/summary?tf='+tf);
 if(!sel||!j.coins.some(c=>c.symbol===sel))sel=j.coins.length?j.coins[0].symbol:null;
 $('cards').innerHTML=j.coins.map(c=>`<button class="card${c.symbol===sel?' on':''}" data-s="${esc(c.symbol)}"><i class="dot" style="background:${c.error?'#9aa':col(c.decision)}"></i><b>${esc(c.symbol.replace('USDT',''))}</b><span data-p="${esc(c.symbol)}">${c.error?'sin datos':fmt(c.price)}</span><small>${c.error?'':NAME[c.decision]+' '+sg(c.score)+(c.p!=null?' | P '+(c.p*100).toFixed(0)+'%':'')+(c.held?' (en cartera)':'')}</small></button>`).join('');
 j.coins.forEach(c=>{if(c.price)price[c.symbol]=c.price});lastCoins=j.coins.filter(c=>c.ws!==false).map(c=>c.symbol);posList=j.coins.filter(c=>c.pos);live();paint();
}
async function loadAnalysis(){
 if(!sel){$('verdict').innerHTML='<p>Agrega una moneda con el buscador.</p>';return}
 const a=await api(`/api/analysis?symbol=${encodeURIComponent(sel)}&tf=${tf}`);
 cs.setData(a.candles);e50.setData(a.ema50);e200.setData(a.ema200);tls.setData(a.tl?[{time:a.tl.t1,value:a.tl.p1},{time:a.tl.t2,value:a.tl.p2}]:[]);
 lines.forEach(l=>cs.removePriceLine(l));lines=[];
 const pl=(p,c,t,s)=>lines.push(cs.createPriceLine({price:p,color:c,lineWidth:1,lineStyle:s,axisLabelVisible:true,title:t}));
 a.res.forEach(r=>pl(r[0],'#f87171','Resistencia ('+r[1]+')',2));
 a.sup.forEach(r=>pl(r[0],'#34d399','Soporte ('+r[1]+')',2));
 a.fib.levels.forEach(f=>{if([0.382,0.5,0.618,0.786].includes(f.r))pl(f.price,'#fbbf24','Fib '+f.r,1)});
 pl(a.pivot.P,'#94a3b8','Pivote',3);
 if(a.pos){pl(a.pos.entry,'#38bdf8','Tu entrada',0);pl(a.pos.stop,'#f87171','Tu stop',0);pl(a.pos.target,'#34d399','Tu objetivo',0)}
 if(viewKey!==sel+'|'+tf){chart.timeScale().fitContent();viewKey=sel+'|'+tf}
 const c=col(a.decision);
 $('verdict').innerHTML=`<div class="dropw"><div class="drop" style="background:${c}"></div></div>
 <div><div class="mut">${esc(a.symbol)} en ${esc(a.tf)} a <b id="lp">${fmt(price[a.symbol]||a.price)}</b>${a.ctx?' | temporalidad superior: '+esc(a.ctx):''}</div><h2 style="color:${c}">${NAME[a.decision]}</h2><p>${esc(a.reason)}</p><p style="font-size:13px">Confluencia: ${a.conf.items.map(x=>`<span style="color:${x.d>0?'var(--ok)':x.d<0?'var(--no)':'var(--mut)'}">${x.d>0?'▲':x.d<0?'▼':'●'} ${esc(x.n)}</span>`).join(' &nbsp; ')} &nbsp;|&nbsp; ADX ${a.adx.toFixed(0)}${a.adx<20?' (lateral)':''} &nbsp;|&nbsp; ${esc(a.trend)}</p></div>
 <div class="plan"><div><small>Entrada</small><b>${fmt(a.entry)}</b></div><div><small>Stop</small><b class="dn">${fmt(a.stop)}</b></div><div><small>Objetivo</small><b class="up">${fmt(a.target)}</b></div><div><small>R/R</small><b>${a.rr.toFixed(2)}</b></div></div>
 <button class="btn" id="rm">Quitar moneda</button>`;curPos=a.pos;drawPos(a);drawSell(a);drawProb(a);lastA=a;drawCapAdv(a);
 $('calc').innerHTML=a.rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(r.detail)}</td><td class="pt ${r.pts>0?'up':r.pts<0?'dn':''}">${sg(r.pts)}</td></tr>`).join('')+`<tr><td><b>Total</b></td><td class="mut">Comprar: +5, 3 de 5 señales alcistas, ADX 20 o más, R/R 1.5 o más y sin ir contra la temporalidad superior. Vender: -4 o menos con 3 de 5 bajistas.</td><td class="pt">${sg(a.score)}</td></tr>`;
 const li=(arr,cls)=>arr.length?arr.map(r=>`<li class="${cls}">${fmt(r[0])} <span class="mut">(${r[1]} ${r[1]==1?'toque':'toques'})</span></li>`).join(''):'<li class="mut">sin niveles cercanos</li>';
 const n=a.next,nt=n?`Posible ${n.type==='H'?'máximo':'mínimo'} en unas ${n.bars} velas (${new Date(n.time*1000).toLocaleString()}), cerca de ${fmt(n.price)}. Basado en un promedio de ${n.avg} velas entre giros; es una estimación.`:'No hay giros suficientes para estimarlo.';
 $('levels').innerHTML=`<h3>Resistencias</h3><ul>${li(a.res,'dn')}</ul><h3 style="margin-top:12px">Soportes</h3><ul>${li(a.sup,'up')}</ul>
 <h3 style="margin-top:12px">Próximo punto de inflexión</h3><p style="margin:0">${nt}</p>
 <h3 style="margin-top:12px">Fibonacci (${a.fib.up?'pierna alcista':'pierna bajista'})</h3><ul>${a.fib.levels.map(f=>`<li>${f.r}: ${fmt(f.price)}</li>`).join('')}${a.fib.ext.map(f=>`<li class="mut">Extensión ${f.r}: ${fmt(f.price)}</li>`).join('')}</ul>
 <h3 style="margin-top:12px">Pivote clásico (vela anterior)</h3><p style="margin:0">S1 ${fmt(a.pivot.S1)} | P ${fmt(a.pivot.P)} | R1 ${fmt(a.pivot.R1)}</p>${nnText(a.nn)}`;loadMtf();
}
async function refresh(){try{localStorage.setItem('gtf',tf);if(sel)localStorage.setItem('gsel',sel)}catch(e){}
 if(scanTf!==tf){scanTf=tf;loadScan()}
 try{err('');await loadSummary();await loadAnalysis();loadCap();await loadPaper()}catch(e){err(e)}}
document.addEventListener('click',async e=>{
 const t=e.target.closest('[data-t]'),s=e.target.closest('[data-s]'),ad=e.target.closest('[data-add]');
 const ev=e.target.closest('[data-ev]');
 if(ev){const p=ev.dataset.ev.split('|');sel=p[0];tf=p[1];drawTfs();refresh()}
 else if(t){tf=t.dataset.t;drawTfs();refresh()}
 else if(s){sel=s.dataset.s;refresh()}
 else if(ad)addCoin(ad.dataset.add);
 else if(e.target.closest('[data-paper-close]')){const b=e.target.closest('[data-paper-close]');try{err('');await post('/api/paper/close?id='+encodeURIComponent(b.dataset.paperClose));await refresh()}catch(x){err(x)}}
 else if(e.target.id==='paper-long'||e.target.id==='paper-short'){if(!sel)return;try{err('');await post('/api/paper/open?symbol='+encodeURIComponent(sel)+'&tf='+encodeURIComponent(tf)+'&side='+(e.target.id==='paper-long'?'long':'short'));await refresh()}catch(x){err(x)}}
 else if(e.target.id==='paper-save'){const q=new URLSearchParams();[['initialBalance','paper_capital'],['riskPct','paper_risk'],['feePct','paper_fee'],['slippagePct','paper_slippage']].forEach(([k,id])=>q.set(k,$(id).value));q.set('autoTrade',$('paper_auto').checked?'1':'0');try{err('');await post('/api/paper/config?'+q.toString());await loadPaper()}catch(x){err(x)}}
 else if(e.target.id==='buy'){try{await post('/api/buy?symbol='+sel+'&tf='+tf);refresh()}catch(x){err(x)}}
 else if(e.target.id==='short'){try{await post('/api/buy?symbol='+sel+'&tf='+tf+'&side=short');refresh()}catch(x){err(x)}}
 else if(e.target.id==='sellb'){try{await post('/api/sell?symbol='+sel);refresh()}catch(x){err(x)}}
 else if(e.target.id==='recalc'){const b=e.target;b.disabled=true;b.textContent='Recalculando...';try{await post('/api/recalc?symbol='+(sel||'')+'&tf='+tf);scanTf='';await refresh();loadEvents();loadMem()}catch(x){err(x)}b.disabled=false;b.textContent='Recalcular'}
 else if(e.target.id==='learn'){try{await post('/api/learn');loadMem()}catch(x){err(x)}}
 else if(e.target.id==='bell'){alerts=true;try{Notification.requestPermission()}catch(x){}beep();$('bell').textContent='Alertas activas'}
 else if(e.target.id==='rm'&&sel){await post('/api/remove?symbol='+sel);sel=null;refresh()}
 if(!e.target.closest('.search'))$('res').style.display='none';
});
['theme-toggle','theme-toggle-mobile'].forEach(id=>$(id).addEventListener('click',setTheme));
document.querySelectorAll('.nav-link').forEach(link=>link.addEventListener('click',()=>{
 document.querySelectorAll('.nav-link').forEach(item=>item.classList.remove('active'));
 link.classList.add('active');
}));
async function addCoin(s){
 try{err('');const j=await post('/api/add?symbol='+encodeURIComponent(s));sel=j.symbol;$('q').value='';$('res').style.display='none';refresh()}catch(e){err(e)}
}
let tm;$('q').addEventListener('input',()=>{clearTimeout(tm);tm=setTimeout(async()=>{
 const v=$('q').value.trim();if(v.length<2){$('res').style.display='none';return}
 try{const j=await api('/api/search?q='+encodeURIComponent(v));
 $('res').innerHTML=j.results.length?j.results.map(s=>`<button data-add="${esc(s)}">${esc(s.replace('USDT',''))}<span class="mut"> /USDT</span></button>`).join(''):'<button disabled>Sin resultados</button>';
 $('res').style.display='block'}catch(e){err(e)}},250)});
$('q').addEventListener('keydown',e=>{if(e.key==='Enter'&&$('q').value.trim())addCoin($('q').value.trim().toUpperCase())});
const price={};let lastCoins=[],ws=null,wsKey='',alerts=false,lastEv=Math.floor(Date.now()/1000);
let curPos=null;
function drawProb(a){const p=a.prob,b=a.buy,ok=b.ok>=4?'var(--ok)':b.ok===3?'var(--wait)':'var(--mut)';
 const head=p.p==null?'<b>Aún sin datos propios.</b> Glubi está aprendiendo del historial de esta moneda y período; puede tardar unos minutos.':`<span style="font-size:26px;font-weight:800;color:${p.ev>0?'var(--ok)':'var(--no)'}">${(p.p*100).toFixed(0)}%</span> de probabilidad de que el precio llegue al objetivo antes que al stop`;
 const det=p.p==null?'':`<div class="mut">Necesaria para no perder con este R/R (${a.rr.toFixed(1)}): ${(p.be*100).toFixed(0)}% | Valor esperado: <b class="${p.ev>0?'up':'dn'}">${sg(+p.ev.toFixed(2))}R</b> por cada 1R arriesgado | Aprendido de ${p.n} casos (acierto medio ${(p.win*100).toFixed(0)}%). ${p.valAcc==null?'Aún faltan casos para validarlo.':`Validación: ${(p.valAcc*100).toFixed(0)}% contra ${(p.valBase*100).toFixed(0)}% de base (${p.valN} casos): ${p.useful?'aporta información':'sin ventaja demostrada'}.`}</div>`;
 $('probbox').innerHTML=`<h3>Probabilidad y dónde comprar</h3><div class="grid"><div>${head}${det}</div><div><b style="color:${ok};font-size:18px">${esc(b.label)}</b><div class="mut">Zona de compra: ${fmt(b.low)} a ${fmt(b.high)}</div><ul style="list-style:none;padding:0;margin:6px 0 0">${b.checks.map(x=>`<li>${x.ok?'<b class="up">sí</b>':'<span class="mut">no</span>'} ${esc(x.t)}</li>`).join('')}</ul></div></div><p class="mut" style="margin:8px 0 0">Es una estimación basada en casos pasados, no una promesa. Se recalibra sola con cada resultado.</p>`}
const nnText=n=>n?`<h3 style="margin-top:12px">Red neuronal (próximas ${n.H} velas)</h3><p style="margin:0">Probabilidad de subida: <b>${(n.p*100).toFixed(0)}%</b>. Validación fuera de muestra: ${(n.acc*100).toFixed(0)}% de acierto contra ${(n.base*100).toFixed(0)}% de base (${n.valN} casos). <b style="color:${n.qualified?'var(--ok)':'var(--wait)'}">${n.qualified?'Ventaja demostrada: suma al puntaje.':'Sin ventaja demostrada: no suma al puntaje.'}</b></p>`:'';
const tcol=l=>l==='ALCISTA'?'var(--ok)':l==='BAJISTA'?'var(--no)':'var(--mut)';
async function loadMtf(){try{
 if(!sel)return;const j=await api('/api/mtf?symbol='+encodeURIComponent(sel)),R=j.rows,by=l=>R.filter(r=>r.label===l).map(r=>r.tf);
 const al=by('ALCISTA'),ba=by('BAJISTA'),ot=R.filter(r=>r.label!=='ALCISTA'&&r.label!=='BAJISTA').map(r=>r.tf);
 const msg=al.length===R.length?'La tendencia ALCISTA se mantiene en los 6 períodos.':ba.length===R.length?'La tendencia BAJISTA se mantiene en los 6 períodos.':`No hay una tendencia común a los 6 períodos. Alcista en: ${al.join(', ')||'ninguno'}. Bajista en: ${ba.join(', ')||'ninguno'}. Lateral o mixta en: ${ot.join(', ')||'ninguno'}.`;
 $('mtf').innerHTML=`<h3>Tendencia en todos los períodos (${esc(sel.replace('USDT',''))})</h3><div class="chips">${R.map(r=>`<div class="chip" style="border-color:${r.label==='ALCISTA'||r.label==='BAJISTA'?tcol(r.label):'var(--line)'}"><b>${esc(r.tf)}</b><span style="color:${tcol(r.label)};font-weight:700">${esc(r.label)}</span><small>ADX ${r.adx.toFixed(0)} | ${sg(r.score)} | ${esc(r.decision)}</small></div>`).join('')}</div><p class="mut" style="margin:10px 0 0">${msg} Para entrar, usa el período superior como guía y el inferior para el momento exacto.</p>`}catch(e){}}
function learnBox(L){
 const lt=Object.entries(L.byTf).map(([t,m])=>`<tr><td>${esc(t)}</td><td>${m.n}</td><td>${(m.win*100).toFixed(0)}%</td><td>${m.valAcc==null?'-':(m.valAcc*100).toFixed(0)+'% / '+(m.valBase*100).toFixed(0)+'%'}</td><td style="color:${m.useful?'var(--ok)':'var(--mut)'}">${m.useful?'aporta':'sin ventaja'}</td></tr>`).join('')||'<tr><td class="mut" colspan="5">Aprendiendo del historial...</td></tr>';
 const mt=L.methods.map(m=>`<tr><td>${esc(m.name)}</td><td>${m.nPos?(m.wPos/m.nPos*100).toFixed(0)+'% ('+m.nPos+')':'-'}</td><td>${m.nNeg?(m.wNeg/m.nNeg*100).toFixed(0)+'% ('+m.nNeg+')':'-'}</td></tr>`).join('');
 const T=L.trades;
 return `<h3 style="margin-top:16px">Retroalimentación: probabilidad aprendida</h3><p class="mut" style="margin:0 0 8px">${L.samples} casos resueltos (historial, señales en vivo y tus operaciones cerradas). Historial analizado: ${L.bt.done} de ${L.bt.total} pares. ${T.n?`Tus operaciones: ${T.n}, ganadas ${T.wins}, promedio ${sg(+T.avg.toFixed(2))}%.`:'Aún no cierras operaciones desde el panel.'} <button class="btn" id="learn">Aprender del historial de nuevo</button></p><div class="grid"><div><table><thead><tr><th>Período</th><th>Casos</th><th>Acierto medio</th><th>Validación / base</th><th>Estado</th></tr></thead><tbody>${lt}</tbody></table></div><div><table><thead><tr><th>Método</th><th>Acierta si favorece</th><th>Acierta si está en contra</th></tr></thead><tbody>${mt}</tbody></table></div></div>`}
async function loadMem(){try{
 const j=await api('/api/memory'),st=Object.entries(j.stats).map(([t,s])=>`<li>${esc(t)}: ${s.acierto} aciertos, ${s.fallo} fallos, ${s.expirada} sin resolver</li>`).join('')||'<li class="mut">Aún no hay señales de compra resueltas. Se irán midiendo solas.</li>';
 const md=j.models.sort((a,b)=>b.acc-a.acc).slice(0,10).map(m=>`<tr><td>${esc(m.key.replace('USDT','').replace('|',' '))}</td><td>${(m.acc*100).toFixed(0)}% / ${(m.base*100).toFixed(0)}%</td><td>${m.valN}</td><td style="color:${m.qualified?'var(--ok)':'var(--mut)'}">${m.qualified?'con ventaja':'sin ventaja'}</td></tr>`).join('');
 const tr=j.trends.map(x=>`<li>${new Date(x.time*1000).toLocaleString()} ${esc(x.symbol.replace('USDT',''))} ${esc(x.tf)}: ${esc(x.from)} a <b style="color:${tcol(x.to)}">${esc(x.to)}</b> (${fmt(x.price)})</li>`).join('')||'<li class="mut">Todavía no hay cambios de tendencia registrados.</li>';
 $('mem').innerHTML=`<h3>Memoria y aprendizaje (se guarda en memory.json)</h3><div class="grid"><div><h3 style="font-size:14px" class="mut">Red neuronal por moneda y período: acierto contra base de referencia</h3><table><thead><tr><th>Modelo</th><th>Acierto / base</th><th>Casos</th><th>Estado</th></tr></thead><tbody>${md||'<tr><td class="mut" colspan="4">Entrenando...</td></tr>'}</tbody></table></div><div><h3 style="font-size:14px" class="mut">Cambios de tendencia recordados</h3><ul>${tr}</ul><h3 style="font-size:14px;margin-top:12px" class="mut">Señales de COMPRAR medidas en vivo</h3><ul>${st}</ul></div></div>${learnBox(j.learn)}<p class="mut" style="margin:10px 0 0">La red aprende de velas pasadas y solo cuenta cuando supera la base fuera de muestra. Con mercados ruidosos, lo normal es que no la supere.</p>`}catch(e){}}
function drawSell(a){const s=a.sell,c=s.ok>=3?'var(--no)':s.ok===2?'var(--wait)':'var(--mut)';
 $('sellbox').innerHTML=`<h3>Mejor momento de venta</h3><div style="display:flex;gap:22px;flex-wrap:wrap;align-items:center"><div><b style="font-size:20px;color:${c}">${esc(s.label)}</b><div class="mut">Zona de venta: ${fmt(s.low)} a ${fmt(s.high)}</div></div><ul style="list-style:none;padding:0;margin:0">${s.checks.map(x=>`<li>${x.ok?'<b class="up">sí</b>':'<span class="mut">no</span>'} ${esc(x.t)}</li>`).join('')}</ul></div>${s.when?`<p class="mut" style="margin:8px 0 0">${esc(s.when)}</p>`:''}`}
function drawPos(a){
 const b=$('posbox'),n=esc(a.symbol.replace('USDT',''));
 if(!a.pos){b.innerHTML=`<h3>Tu posición en ${n}</h3><p class="mut" style="margin:0 0 10px">Sin posición registrada. Si compras o vendes en corto, regístralo aquí: Glubi te da seguimiento en vivo, calcula tu stop dinámico y te avisa cuándo cerrar. Glubi no ejecuta órdenes.</p><button class="btn" id="buy">Marcar compra (largo) a ${fmt(price[a.symbol]||a.price)}</button> <button class="btn" id="short">Marcar venta en corto</button>`;return}
 const p=a.pos;
 b.innerHTML=`<h3>Tu posición ${p.side==='short'?'en corto':'larga'} en ${n}</h3><div class="plan" style="margin:0"><div><small>Entrada</small><b>${fmt(p.entry)}</b></div><div><small>Ganancia o pérdida</small><b id="pnl"></b></div><div><small>Stop dinámico (solo sube)</small><b class="dn">${fmt(p.stop)}</b></div><div><small>Objetivo</small><b class="up">${fmt(p.target)}</b></div><div><small>Estado</small><b id="pst"></b></div></div><p class="mut" style="margin:10px 0">El stop acompaña al precio a 2.5 ATR de distancia y solo se mueve a tu favor.</p><button class="btn" id="sellb">Cerrar posición</button>`;updPos()}
function posState(p,px){const sh=p.side==='short',w=sh?'CERRAR':'VENDER';
 const pnl=(sh?1-px/p.entry:px/p.entry-1)*100;let t='MANTENER',c='var(--ok)';
 if(sh?px>=p.stop:px<=p.stop){t=w+': stop tocado';c='var(--no)'}
 else if(sh?px<=p.target:px>=p.target){t=w+': objetivo alcanzado';c='var(--no)'}
 else if(p.alerted){t=w+': '+p.alerted;c='var(--no)'}
 return{pnl,t,c}}
function updPos(){drawOpen();const p=curPos,e=$('pnl');if(!p||!e)return;const px=price[sel]||0;if(!px)return;const r=posState(p,px);
 e.textContent=sg(+r.pnl.toFixed(2))+'%';e.className=r.pnl>=0?'up':'dn';const st=$('pst');st.textContent=r.t;st.style.color=r.c}
let posList=[],viewKey='',scanTm=null,scanTf='';
function drawOpen(){const b=$('open');if(!posList.length){b.style.display='none';return}b.style.display='';
 b.innerHTML='<h3>Mis posiciones abiertas</h3><table><thead><tr><th>Moneda</th><th>Lado</th><th>Entrada</th><th>Precio</th><th>G/P</th><th>Stop</th><th>Objetivo</th><th>Estado</th></tr></thead><tbody>'+posList.map(c=>{const p=c.pos,px=price[c.symbol]||c.price,r=posState(p,px);return `<tr data-s="${esc(c.symbol)}" style="cursor:pointer"><td><b>${esc(c.symbol.replace('USDT',''))}</b> ${esc(p.tf)}</td><td>${p.side==='short'?'Corto':'Largo'}</td><td>${fmt(p.entry)}</td><td>${fmt(px)}</td><td class="${r.pnl>=0?'up':'dn'}"><b>${sg(+r.pnl.toFixed(2))}%</b></td><td class="dn">${fmt(p.stop)}</td><td class="up">${fmt(p.target)}</td><td style="color:${r.c}"><b>${esc(r.t)}</b></td></tr>`}).join('')+'</tbody></table>'}
async function loadScan(){
 try{const j=await api('/api/scan?tf='+tf),rows=j.rows||[];
  const bull=[...rows].sort((a,b)=>b.score-a.score||b.rr-a.rr).slice(0,8),bear=[...rows].sort((a,b)=>a.score-b.score||a.rr-b.rr).slice(0,8);
  const ok=rows.filter(r=>r.decision==='COMPRAR').sort((a,b)=>b.score-a.score||b.rr-a.rr).slice(0,3),near=rows.filter(r=>r.decision==='ESPERAR'&&r.score>=3).sort((a,b)=>b.score-a.score||b.rr-a.rr).slice(0,3);
  const cd=(r,t)=>`<div class="panel" style="margin:0;flex:1;min-width:220px"><b>${esc(r.symbol.replace('USDT',''))}</b> <span class="mut">${t}</span><div>Precio ${fmt(r.price)} | puntaje ${sg(r.score)} | R/R ${r.rr.toFixed(1)}</div><div class="mut">Stop <span class="dn">${fmt(r.stop)}</span> | Objetivo <span class="up">${fmt(r.target)}</span></div><button class="btn" style="margin-top:8px" data-add="${esc(r.symbol)}">Agregar y vigilar</button></div>`;
  $('sugg').innerHTML=`<h3>Sugerencias de monedas (${esc(j.tf||tf)})</h3>`+(j.busy&&!rows.length?'<p class="mut" style="margin:0">Analizando el mercado...</p>':`<div style="display:flex;gap:12px;flex-wrap:wrap">${ok.map(r=>cd(r,'cumple las reglas de compra')).join('')}${near.map(r=>cd(r,'en observación')).join('')}</div>${ok.length||near.length?'':'<p class="mut" style="margin:0">Ninguna moneda cumple las reglas ahora. Esperar también es una decisión.</p>'}<p class="mut" style="margin:10px 0 0">Son candidatas, no recomendaciones. Al agregarla, el semáforo completo la confirma o la descarta (incluye la tendencia diaria).</p>`);
  const tb=arr=>`<table><thead><tr><th>Moneda</th><th>Precio</th><th>24h</th><th>Tendencia</th><th>Puntaje</th><th>R/R</th><th></th></tr></thead><tbody>${arr.map(r=>`<tr><td><b>${esc(r.symbol.replace('USDT',''))}</b></td><td>${fmt(r.price)}</td><td class="${r.chg>=0?'up':'dn'}">${sg(+r.chg.toFixed(1))}%</td><td>${esc(r.trend)}</td><td class="pt ${r.score>0?'up':r.score<0?'dn':''}">${sg(r.score)}</td><td>${r.rr.toFixed(1)}</td><td><button class="btn" data-add="${esc(r.symbol)}">Agregar</button></td></tr>`).join('')}</tbody></table>`;
  $('scan').innerHTML=`<h3>Investigación de mercado (${esc(j.tf||tf)})</h3><p class="mut" style="margin:0 0 10px">Glubi analiza las monedas USDT con más volumen de Binance (futuros, spot y Alpha) con los mismos cálculos del semáforo y las ordena. ${j.busy?'Analizando '+j.done+' de '+(j.total||40)+'...':'Se actualiza cada 5 minutos.'} No garantiza resultados.</p><div class="grid"><div><h3 class="up">Más alcistas (candidatas a comprar)</h3>${tb(bull)}</div><div><h3 class="dn">Más bajistas (evitar o vigilar para corto)</h3>${tb(bear)}</div></div>`;
  clearTimeout(scanTm);scanTm=setTimeout(loadScan,j.busy?3000:60000)
 }catch(e){clearTimeout(scanTm);scanTm=setTimeout(loadScan,15000)}}
function beep(){try{const c=new AudioContext(),o=c.createOscillator();o.connect(c.destination);o.frequency.value=880;o.start();setTimeout(()=>{o.stop();c.close()},250)}catch(e){}}
function paint(){document.querySelectorAll('[data-p]').forEach(e=>{const p=price[e.dataset.p];if(p)e.textContent=fmt(p)});const lp=$('lp');if(lp&&price[sel])lp.textContent=fmt(price[sel]);updPos()}
function live(){
 const key=tf+'|'+lastCoins.join();if(key===wsKey||!lastCoins.length)return;wsKey=key;
 if(ws){ws.onclose=null;ws.close()}
 ws=new WebSocket('wss://data-stream.binance.vision/stream?streams='+lastCoins.map(c=>c.toLowerCase()+'@kline_'+tf).join('/'));
 ws.onopen=()=>{$('live').textContent='● en vivo';$('live').style.color='var(--ok)'};
 ws.onmessage=m=>{const d=JSON.parse(m.data).data;if(!d||!d.k)return;const k=d.k,s=d.s;price[s]=+k.c;paint();
  if(s===sel&&cs){try{cs.update({time:Math.floor(k.t/1000),open:+k.o,high:+k.h,low:+k.l,close:+k.c})}catch(x){}}
  if(k.x&&s===sel)loadAnalysis().catch(err)};
 ws.onclose=()=>{$('live').textContent='reconectando...';$('live').style.color='var(--wait)';wsKey='';setTimeout(live,3000)};
}
async function loadEvents(){try{
 const j=await api('/api/events');
 $('events').innerHTML='<h3>Entradas posibles (en vivo)</h3>'+(j.events.length?`<table><thead><tr><th>Hora</th><th>Moneda</th><th>Cambio</th><th>Precio</th><th>Stop</th><th>Objetivo</th><th>R/R</th></tr></thead><tbody>${j.events.slice(0,12).map(x=>`<tr data-ev="${esc(x.symbol)}|${esc(x.tf)}" style="cursor:pointer"><td>${new Date(x.time*1000).toLocaleTimeString()}</td><td><b>${esc(x.symbol.replace('USDT',''))}</b> ${esc(x.tf)}</td><td style="color:${col(x.to)}"><b>${x.from?NAME[x.from]+' a ':''}${NAME[x.to]}</b>${x.reason?'<br><span class="mut">'+esc(x.reason)+'</span>':''}</td><td>${fmt(x.price)}</td><td class="dn">${fmt(x.stop)}</td><td class="up">${fmt(x.target)}</td><td>${x.rr.toFixed(1)}</td></tr>`).join('')}</tbody></table>`:'<p class="mut" style="margin:0">Glubi vigila 15m, 1h y 4h cada 20 segundos. Cuando una moneda cambie de decisión aparecerá aquí.</p>');
 const fresh=j.events.filter(x=>(x.to==='COMPRAR'||x.to==='VENDER'||x.to==='CERRAR'||x.to==='PREPARAR'||x.to==='CONFIRMADA'||x.to==='CANCELADA')&&x.time>lastEv);
 if(fresh.length){lastEv=Math.max(...fresh.map(x=>x.time));if(alerts){beep();fresh.forEach(x=>{try{new Notification('Glubi: '+x.symbol+' '+x.tf+' -> '+NAME[x.to],{body:(x.reason||'')+' Precio '+fmt(x.price)+' | stop '+fmt(x.stop)+' | objetivo '+fmt(x.target)})}catch(e){}})}}
}catch(e){}}
let CAPD=null,lastA=null,cfgDone=false;
let PAPERD=null;
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
async function loadPaper(){try{PAPERD=await api('/api/paper');drawPaper(PAPERD);drawDashboard(PAPERD)}catch(e){err(e)}}
function drawDashboard(j){
 const stats=[
  ['Capital virtual',usd(j.equity),`${j.openCount} operación${j.openCount===1?'':'es'} abierta${j.openCount===1?'':'s'}`,cc(j.equity-j.cfg.initialBalance)],
  ['PNL realizado',usd(j.realizedPnl),`${j.tradeCount} operaciones cerradas`,cc(j.realizedPnl)],
  ['Rentabilidad',pcn(j.roi),`Capital inicial ${usd(j.cfg.initialBalance)}`,cc(j.roi)],
  ['Operaciones',j.openCount+j.tradeCount,`${j.openCount} abiertas · ${j.tradeCount} cerradas`,'']
 ];
 $('dashboard-stats').innerHTML=stats.map(([label,value,detail,cls])=>`<div class="metric-card"><small>${label}</small><strong class="${cls}">${value}</strong><div class="metric-foot">${detail}</div></div>`).join('');
 const points=Array.isArray(j.equityCurve)?j.equityCurve.filter(point=>Number.isFinite(point.time)&&Number.isFinite(point.value)):[];
 $('equity-chart').innerHTML=GlubiCharts.equityCurve(points,usd);
 $('activity-chart').innerHTML=GlubiCharts.activityBars(points,usd);
 const total=j.wins+j.losses,winAngle=total?j.wins/total*360:0,donut=total?`conic-gradient(var(--ok) 0deg ${winAngle}deg,var(--no) ${winAngle}deg 360deg)`:'conic-gradient(var(--wash) 0deg 360deg)';
 const winRate=total?(j.wins/total*100).toFixed(0):'0';
 $('win-loss').innerHTML=`<div class="win-donut" style="background:${donut}"><strong>${total?winRate+'%':'—'}</strong></div><div class="win-legend"><div><i class="legend-dot" style="background:var(--ok)"></i>${j.wins} ganadas</div><div><i class="legend-dot" style="background:var(--no)"></i>${j.losses} perdidas</div><div>${total} cerradas</div><div class="win-rate-track" role="progressbar" aria-label="Porcentaje de operaciones ganadoras" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${winRate}"><span style="width:${winRate}%"></span></div></div>`;
 const auto=j.cfg.autoTrade?'Auto paper activado':'Auto paper desactivado',decision=lastA?`Análisis ${esc(lastA.symbol)}: ${NAME[lastA.decision]}`:'Esperando análisis';
 $('system-status').innerHTML=`<div><i class="legend-dot" style="background:var(--ok)"></i>${auto}</div><div><i class="legend-dot" style="background:var(--acc)"></i>${decision}</div><div><i class="legend-dot" style="background:var(--wait)"></i>Costes incluidos: comisión y deslizamiento</div>`;
}
function drawPaper(j){
 const b=$('paperbox');if(!b)return;
 const chip=(label,value,cls='')=>`<div class="chip"><small>${label}</small><b class="${cls}" style="font-size:18px">${value}</b></div>`;
 const open=j.openPositions.map(p=>`<tr><td><b>${esc(p.symbol)}</b> ${esc(p.tf)}</td><td>${p.side==='short'?'Corto':'Largo'}</td><td>${fmt(p.entryPrice)}</td><td>${fmt(p.markPrice)}</td><td class="${cc(p.unrealizedPnl)}">${usd(p.unrealizedPnl)}</td><td>${fmt(p.stop)}</td><td>${fmt(p.target)}</td><td><button class="btn" data-paper-close="${p.id}">Cerrar simulación</button></td></tr>`).join('');
 const trades=j.trades.map(t=>`<tr><td>${new Date(t.closedAt*1000).toLocaleString()}</td><td>${esc(t.symbol)} ${esc(t.tf)}</td><td>${t.side==='short'?'Corto':'Largo'}</td><td>${esc(t.reason)}</td><td class="${cc(t.pnl)}"><b>${usd(t.pnl)}</b></td></tr>`).join('');
 const canReset=!j.openCount&&!j.tradeCount;
 const longDisabled=!sel||j.openPositions.some(p=>p.symbol===sel)||!lastA||lastA.decision!=='COMPRAR';
 const shortDisabled=!sel||j.openPositions.some(p=>p.symbol===sel)||!lastA||lastA.decision!=='VENDER'||!lastA.paperCanShort;
 b.innerHTML=`<h3>GLUBI Paper Trading <span class="mut">· solo simulación, sin órdenes a Binance</span></h3>
 <div class="chips">${chip('Capital virtual',usd(j.equity),cc(j.equity-j.cfg.initialBalance))}${chip('Saldo disponible',usd(j.balance))}${chip('PNL realizado',usd(j.realizedPnl),cc(j.realizedPnl))}${chip('PNL flotante',usd(j.unrealizedPnl),cc(j.unrealizedPnl))}${chip('ROI',pcn(j.roi),cc(j.roi))}${chip('Operaciones cerradas',j.tradeCount)}${chip('Acierto',j.winRate==null?'-':(j.winRate*100).toFixed(0)+'%')}${chip('Profit factor',j.profitFactor==null?'-':j.profitFactor.toFixed(2))}${chip('Stop adaptativo',j.stopLearning.atrMultiplier.toFixed(2)+'× ATR')}${chip('Stops aprendidos',j.stopLearning.stopSamples)}</div>
 <p class="mut">El trailing stop solo avanza a favor y nunca supera el riesgo del stop inicial. Tras 5 cierres por stop ajusta el múltiplo ATR según los últimos resultados (método heurístico, entre 1.5× y 4×).</p>
 <details style="margin-top:12px"><summary class="mut" style="cursor:pointer">Configurar capital y costes de simulación</summary><div class="chips" style="margin-top:10px">
 <label class="chip"><small>Capital inicial (USDT)</small><input id="paper_capital" type="number" min="1" step="any" value="${j.cfg.initialBalance}" ${canReset?'':'disabled'} style="${IS}"></label>
 <label class="chip"><small>Riesgo por operación (%)</small><input id="paper_risk" type="number" min="0.1" max="5" step="0.1" value="${j.cfg.riskPct}" style="${IS}"></label>
 <label class="chip"><small>Comisión por lado (%)</small><input id="paper_fee" type="number" min="0" max="1" step="0.01" value="${j.cfg.feePct}" style="${IS}"></label>
 <label class="chip"><small>Deslizamiento por lado (%)</small><input id="paper_slippage" type="number" min="0" max="1" step="0.01" value="${j.cfg.slippagePct}" style="${IS}"></label>
 <label class="chip"><small>Operar señales confirmadas</small><input id="paper_auto" type="checkbox" ${j.cfg.autoTrade?'checked':''}></label></div><p><button class="btn" id="paper-save">Guardar configuración</button><span class="mut"> El saldo inicial se bloquea después de abrir la primera operación.</span></p></details>
 <p>Activo seleccionado: <b>${esc(sel||'ninguno')}</b> ${lastA?`· Precio ${fmt(lastA.price)} · Stop ${fmt(lastA.stop)} · Objetivo ${fmt(lastA.target)}`:''}</p>
 <p><button class="btn" id="paper-long" ${longDisabled?'disabled':''}>Simular compra (largo)</button> <button class="btn" id="paper-short" ${shortDisabled?'disabled':''}>Simular venta (corto)</button> <span class="mut">Solo se abre si el análisis vuelve a confirmar la señal. Cierre por stop/objetivo, comisión y deslizamiento incluidos. Cortos solo en futuros; simulación 1x, sin funding.</span></p>
 <h3 style="margin-top:14px">Operaciones simuladas abiertas</h3>${open?`<table><thead><tr><th>Activo</th><th>Lado</th><th>Entrada</th><th>Precio</th><th>PNL flotante</th><th>Stop</th><th>Objetivo</th><th></th></tr></thead><tbody>${open}</tbody></table>`:'<p class="mut">No hay operaciones abiertas.</p>'}
 <h3 style="margin-top:14px">Historial reciente</h3>${trades?`<table><thead><tr><th>Cierre</th><th>Activo</th><th>Lado</th><th>Motivo</th><th>PNL neto</th></tr></thead><tbody>${trades}</tbody></table>`:'<p class="mut">Todavía no hay operaciones simuladas cerradas.</p>'}`;
}
function fillCfg(j){if(cfgDone)return;cfgDone=true;const c=j.cfg,s=(i,v)=>{if(v!=null&&$(i))$(i).value=v};
 s('cf_cap',j.deposited||'');s('cf_lev',c.lev);s('cf_risk',c.risk);s('cf_rmax',c.riskMax);s('cf_dloss',c.dloss);s('cf_goal',c.goal?c.goal.target:'');s('cf_days',c.goal?c.goal.days:'');
 $('cf_strict').value=c.strict?'1':'0';$('cf_cap').disabled=!!j.deposited;if(!j.deposited)$('capcfg').open=true}
function drawCap(j){
 if(!j.deposited){$('capdyn').innerHTML='<p class="mut" style="margin:0">Escribe tu capital inicial abajo para activar el gestor: Glubi calculará el tamaño de cada operación según tu riesgo, llevará tu PNL y ROI y aprenderá de tus errores.</p>';$('caplrn').innerHTML='';return}
 const chip=(l,v,c)=>`<div class="chip"><small>${l}</small><b class="${c||''}" style="font-size:18px">${v}</b></div>`;
 const g=j.goal,bar=g?`<div style="margin:12px 0 4px"><div class="mut">Meta: ${usd(g.target)} en ${g.daysLeft} días (${g.progress.toFixed(0)}% del camino). Necesitas ${pcn(g.needDaily)} diario compuesto${g.hard?' — <b class="dn">poco realista: forzar el riesgo para alcanzarlo es la forma más rápida de perder el capital</b>':''}.</div><div style="height:8px;background:#0b1220;border-radius:6px;overflow:hidden;margin-top:6px"><div style="height:100%;width:${Math.max(0,Math.min(100,g.progress))}%;background:var(--acc)"></div></div></div>`:'';
 $('capdyn').innerHTML=`<div class="chips">${chip('Capital actual',usd(j.equity))}${chip('Aportado',usd(j.deposited))}${chip('PNL realizado',usd(j.realized),cc(j.realized))}${chip('PNL flotante',usd(j.unrealized),cc(j.unrealized))}${chip('ROI',pcn(j.roi),cc(j.roi))}${chip('PNL de hoy',usd(j.today)+(j.todayHit?' (límite)':''),cc(j.today))}${chip('Acierto',j.wr==null?'-':(j.wr*100).toFixed(0)+'% ('+j.n+')')}${chip('Profit factor',j.pf==null?'-':j.pf.toFixed(2))}${chip('Expectativa',j.expR==null?'-':sg(+j.expR.toFixed(2))+'R',cc(j.expR))}${chip('Trailing ATR',j.stopLearning.atrMultiplier.toFixed(2)+'×')}${chip('Stops aprendidos',j.stopLearning.stopSamples)}${chip('Drawdown máx.',j.maxDD.toFixed(1)+'%','dn')}</div><p class="mut">El multiplicador solo se ajusta tras 5 cierres por stop; es un heurístico acotado, no una garantía de rentabilidad.</p>${bar}`;
 const tr=j.tags.map(t=>`<tr><td>${esc(t.tag)}</td><td>${t.n}</td><td>${(t.wr*100).toFixed(0)}%</td><td class="${cc(t.avgR)}">${sg(+t.avgR.toFixed(2))}R</td><td style="color:${t.status==='ok'?'var(--mut)':t.status==='bloqueada'?'var(--no)':'var(--wait)'}">${esc(t.status)}</td></tr>`).join('')||'<tr><td class="mut" colspan="5">Aún no hay suficientes casos (se llena con tus operaciones y las señales resueltas).</td></tr>';
 const er=j.errors.map(x=>`<li>${new Date(x.t*1000).toLocaleDateString()} ${esc(x.sym.replace('USDT',''))} ${x.side==='short'?'corto':'largo'}: <span class="dn">${usd(x.pnl)}</span>${x.R==null?'':' ('+x.R.toFixed(2)+'R)'}. ${esc(x.lesson)}</li>`).join('')||'<li class="mut">Sin pérdidas registradas todavía.</li>';
 const s=j.sim?`<p class="mut" style="margin:10px 0 0">Simulación: siguiendo las ${j.sim.n} señales de COMPRAR ya resueltas con ${j.sim.risk}% de riesgo y comisiones, acierto ${(j.sim.wr*100).toFixed(0)}%, expectativa ${sg(+j.sim.expR.toFixed(2))}R, profit factor ${j.sim.pf==null?'-':j.sim.pf.toFixed(2)}, resultado ${pcn(j.sim.ret)} y drawdown máx. ${j.sim.dd.toFixed(1)}%. Es historia, no promesa.</p>`:'';
 $('caplrn').innerHTML=`<div class="grid" style="margin-top:14px"><div><h3 style="font-size:14px" class="mut">Aprendizaje de errores: qué condiciones te funcionan</h3><table><thead><tr><th>Condición</th><th>Casos</th><th>Acierto</th><th>R medio</th><th>Regla</th></tr></thead><tbody>${tr}</tbody></table></div><div><h3 style="font-size:14px" class="mut">Últimas pérdidas y lección</h3><ul>${er}</ul></div></div>${s}`}
function drawCapAdv(a){const b=$('capadv');if(!b)return;const c=a.cap;if(!c||!c.on){b.innerHTML='';return}
 const blk=(t,s)=>`<div class="panel" style="margin:0;flex:1;min-width:260px"><b>${t}</b><div class="mut">${esc(s.why)}</div>${s.riskUsd>0?`<div>Riesgo ${s.risk.toFixed(2)}% = <b>${usd(s.riskUsd)}</b> | nocional <b>${usd(s.notional)}</b> | margen ${usd(s.margin)} con <b>${s.lev}x</b>${s.liq?' | liquidación aprox. '+fmt(s.liq):''}</div><div class="mut">Objetivo ≈ <span class="up">${usd(s.gainUsd)}</span> | stop ≈ <span class="dn">-${usd(s.riskUsd)}</span></div>`:'<div class="dn"><b>No operar</b></div>'}${s.fut&&s.riskUsd>0&&s.notional<5?'<div style="color:var(--wait)">Menor al nocional mínimo de futuros (5 USDT).</div>':''}<ul style="margin-top:6px">${s.reasons.map(x=>`<li class="mut">${esc(x)}</li>`).join('')}</ul></div>`;
 b.innerHTML=`<h3 style="margin-top:14px">Tamaño sugerido para ${esc(a.symbol.replace('USDT',''))} ${esc(a.tf)}${c.label?' ('+esc(c.label)+')':''}</h3><div style="display:flex;gap:12px;flex-wrap:wrap">${blk('Largo',c.long)}${blk('Corto',c.short)}</div>`}
try{const t0=localStorage.getItem('gtf');if(TFS.includes(t0))tf=t0;sel=localStorage.getItem('gsel')||null;document.documentElement.dataset.theme=localStorage.getItem('glubi-theme')==='dark'?'dark':'light'}catch(e){}
drawTfs();initChart();applyTheme();initCap();refresh();setInterval(refresh,10000);loadEvents();setInterval(loadEvents,10000);loadMem();setInterval(loadMem,30000);