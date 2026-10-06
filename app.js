/* ═══════════════════════════════════════════════
   app.js — Mi App v2 (interfaz). Script clásico: usa los globales de core.js y quick.js.
   Bloques: 1 estado/almacenamiento/sync · 2 pantallas · 3 formularios · 4 registro rápido/voz · 5 ajustes/respaldo · 6 arranque
═══════════════════════════════════════════════ */
'use strict';

const APP_VERSION = '2.0.0';
const K_DB = 'miapp_db_v2', K_CFG = 'miapp_cfg';
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES_L = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

/* ── utilidades DOM ── */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const ESC_MAP = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC_MAP[c]);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const titleCase = s => String(s || '').trim().toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const plural = (n, s, p) => n + ' ' + (n === 1 ? s : (p || s + 's'));
const ymAdd = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const ymLabel = ym => { const [y, m] = ym.split('-'); return MESES_L[+m - 1] + ' ' + y; };
const daysIn = i => daysBetween(i.buyDate, today());
const fdE = d => esc(fd(d));

/* ═════════ 1. ESTADO, ALMACENAMIENTO Y SINCRONIZACIÓN ═════════ */
let DB = null;          // base en memoria (fuente de verdad local)
let CFG = null;         // {url, key, onboarded, last}
const UI = {
  view: 'inicio', stSeg: 'stock', stQ: '', mvMonth: '', mvF: 'todos', masSeg: 'analisis', anMonth: '',
  sync: 'off', syncMsg: '', rev: 0, onb: '', chart: null, pendAll: false, pendOpen: Object.create(null)
};

function loadJSON(k){
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }
  catch(e){ return null; }
}
function saveJSON(k, v){
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch(e){ toast('No pude guardar en el celular (¿memoria llena?)', {err: true}); return false; }
}
const saveDB = () => saveJSON(K_DB, DB);
const saveCfg = () => saveJSON(K_CFG, CFG);
const hasCloud = () => !!(CFG && CFG.url && CFG.key);

/* Guarda o reemplaza un registro. u siempre crece (el merge depende de esto). */
function put(col, obj){
  const o = Object.assign({}, obj);
  if(!o.id) o.id = uid();
  const arr = DB[col] || (DB[col] = []);
  const i = arr.findIndex(x => x.id === o.id);
  const prev = i >= 0 ? arr[i] : null;
  o.u = Math.max(Date.now(), prev ? (+prev.u || 0) + 1 : 0);
  if(i >= 0) arr[i] = o; else arr.push(o);
  UI.rev++;
  return o;
}
/* Borrado lógico: nunca se borra físicamente. */
function remove(col, id){
  const x = (DB[col] || []).find(r => r.id === id);
  if(!x || x.del) return null;
  return put(col, Object.assign({}, x, {del: 1}));
}
/* Revive un registro borrado (para "Deshacer"). */
function restore(col, rec){
  const o = Object.assign({}, rec); delete o.del; delete o.u;
  return put(col, o);
}
const get = (col, id) => L(DB, col).find(x => x.id === id) || null;

/* Un cambio = guardar local + pintar + programar sync + aviso. */
function commit(msg, opts){
  saveDB();
  render();
  scheduleSync();
  if(msg) toast(msg, opts);
}

/* ── Sync con la nube (Apps Script) ── */
let syncing = false, syncAgain = false, syncTimer = 0;
const SYNC_TXT = {off: 'Sin nube', nosig: 'Sin señal', busy: 'Sincronizando…', ok: 'Al día', err: 'Error'};

function setSync(st, msg){
  UI.sync = st; UI.syncMsg = msg || '';
  const b = $('#syncBtn');
  if(b){ b.className = 'sync s-' + st; b.textContent = SYNC_TXT[st]; b.title = msg || SYNC_TXT[st]; }
  const t = $('#cfgState');
  if(t){ t.className = 'tag ' + ({ok: 't-g', err: 't-r', busy: 't-b', nosig: 't-y'}[st] || 't-n'); t.textContent = SYNC_TXT[st]; }
  if(UI.view === 'mas' && UI.masSeg === 'ajustes') renderCfgInfo();
}

function scheduleSync(ms){
  clearTimeout(syncTimer);
  if(!hasCloud()) return;
  syncTimer = setTimeout(() => { sync(); }, ms == null ? 1500 : ms);
}

function cloudURL(params){
  const u = new URL(CFG.url);
  Object.keys(params || {}).forEach(k => u.searchParams.set(k, params[k]));
  return u.toString();
}

/* fetch con límite de tiempo; lee texto y lo convierte a JSON con mensajes claros */
async function cloudFetch(url, init){
  let ctl = null, timer = 0;
  if(typeof AbortController !== 'undefined'){ ctl = new AbortController(); timer = setTimeout(() => ctl.abort(), 45000); }
  try {
    const res = await fetch(url, Object.assign({redirect: 'follow'}, init || {}, ctl ? {signal: ctl.signal} : {}));
    const txt = await res.text();
    let j = null;
    try { j = JSON.parse(txt); } catch(e){ j = null; }
    if(!j){
      if(!res.ok) throw new Error('La nube respondió con error ' + res.status + '.');
      throw new Error('La nube respondió algo raro. Revisa que la URL termine en /exec y que la implementación sea “Cualquier persona”.');
    }
    if(!j.ok) throw new Error(j.error || 'La nube devolvió un error.');
    return j;
  } catch(e){
    if(e && e.name === 'AbortError') throw new Error('La nube tardó demasiado. Intenta otra vez.');
    if(e instanceof TypeError || (e && /fetch|network/i.test(e.message))) throw new Error(navigator.onLine === false ? 'Sin señal.' : 'No pude conectar con la nube. Revisa la URL.');
    throw e;
  } finally { clearTimeout(timer); }
}

async function sync(manual){
  if(!hasCloud()){ setSync('off'); return false; }
  if(navigator.onLine === false){ setSync('nosig', 'Sin señal: se sincroniza cuando vuelva'); if(manual) toast('Sin señal. Se sincroniza solo cuando vuelva 📶'); return false; }
  if(syncing){ syncAgain = true; return false; }
  syncing = true; clearTimeout(syncTimer);
  const rev0 = UI.rev;
  setSync('busy');
  let ok = false;
  try {
    const j = await cloudFetch(CFG.url, {method: 'POST', body: JSON.stringify({action: 'sync', key: CFG.key, db: DB})});
    if(!j.db || typeof j.db !== 'object') throw new Error('La nube no devolvió los datos.');
    DB = mergeDB(DB, j.db);
    saveDB();
    CFG.last = Date.now(); saveCfg();
    ok = true;
    setSync('ok', 'Última sync: ' + horaTxt(CFG.last));
    afterSync();
    render();
    if(manual) toast('☁️ Al día');
  } catch(e){
    const msg = String(e && e.message || e);
    setSync(navigator.onLine === false ? 'nosig' : 'err', msg);
    if(manual) toast(msg, {err: true});
  } finally {
    syncing = false;
    if(syncAgain || UI.rev !== rev0){ syncAgain = false; scheduleSync(ok ? 400 : 15000); }
  }
  return ok;
}

function horaTxt(ms){
  if(!ms) return 'nunca';
  const d = new Date(ms), t = ymd(d);
  const hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0');
  const h12 = (hh % 12) || 12, ap = hh < 12 ? 'a. m.' : 'p. m.';
  return (t === today() ? 'hoy' : fd(t)) + ' ' + h12 + ':' + mm + ' ' + ap;
}

/* ── Toast ── */
let toastTimer = 0;
function toast(msg, opts){
  opts = opts || {};
  const el = $('#toast');
  if(!el) return;
  el.textContent = '';
  const s = document.createElement('span'); s.textContent = msg; el.appendChild(s);
  if(opts.undo){
    const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Deshacer';
    b.addEventListener('click', () => { el.classList.remove('on'); opts.undo(); });
    el.appendChild(b);
  }
  el.classList.toggle('err', !!opts.err);
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), opts.ms || (opts.undo ? 5500 : opts.err ? 4500 : 2800));
}

/* ── Consultas comunes ── */
const pockets = () => L(DB, 'bolsillos');
const pn = id => { if(!id) return '—'; const p = (DB.bolsillos || []).find(b => b.id === id); return p ? p.nombre : id; };
const pocketOpts = () => pockets().map(p => [p.id, p.nombre]);
const otherPocket = id => { const ps = pockets(); const e = ps.find(p => p.id === 'efectivo'); if(e && e.id !== id) return e.id; const o = ps.find(p => p.id !== id); return o ? o.id : id; };
const stockItems = () => L(DB, 'items').filter(i => i.status !== 'sold');
const cajaTotal = () => { const b = balances(DB); return Object.keys(b).reduce((a, k) => a + b[k], 0); };
const pocketUsed = id => ['items','gastos','ingresos','cobros','abonos','transfers','ajustes'].some(c => L(DB, c).some(r =>
  r.buyPocket === id || (r.status === 'sold' && r.sellPocket === id) || r.bolsillo === id || r.from === id || r.to === id));
const hasData = () => pockets().some(b => +b.u > 1) ||
  ['items','gastos','ingresos','cobros','abonos','transfers','ajustes'].some(c => (DB[c] || []).length);

/* ═════════ 2. PANTALLAS ═════════ */
const VIEWS = ['inicio', 'stock', 'movs', 'cobros', 'mas'];

function setView(v){
  if(!VIEWS.includes(v)) v = 'inicio';
  UI.view = v;
  VIEWS.forEach(x => { const s = $('#v-' + x); if(s) s.classList.toggle('on', x === v); });
  $$('#tabs .tab').forEach(b => { const on = b.dataset.v === v; b.classList.toggle('on', on); if(on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  render();
  try { window.scrollTo(0, 0); } catch(e){}
}

function render(){
  renderHeader();
  try {
    if(UI.view === 'inicio') renderInicio();
    else if(UI.view === 'stock') renderStock();
    else if(UI.view === 'movs') renderMovs();
    else if(UI.view === 'cobros') renderCobros();
    else if(UI.view === 'mas') renderMas();
  } catch(e){
    console.error('render', e);
    toast('Algo falló al mostrar la pantalla: ' + (e && e.message || e), {err: true});
  }
}

function renderHeader(){
  const t = today(), d = new Date(t + 'T12:00:00');
  const hd = $('#hdrDate'); if(hd) hd.textContent = DIAS[d.getDay()] + ' ' + d.getDate() + ' ' + MESES[d.getMonth()].toLowerCase() + ' · caja ' + fmt(cajaTotal());
  const n = L(DB, 'pend').length, bd = $('#pendBadge');
  if(bd){ bd.hidden = !n; bd.textContent = n > 99 ? '99+' : String(n); }
}

const money = (m, amt) => m == null || m === 0
  ? `<span class="mut">${full(amt != null ? amt : m)}</span>`
  : m > 0 ? `<span class="pos">+${full(m)}</span>` : `<span class="neg">−${full(-m)}</span>`;

const emptyHTML = (ico, txt, ejemplos, btn) => `<div class="empty"><div class="e">${ico}</div><p>${txt}</p>${
  (ejemplos || []).map(e => `<code>${esc(e)}</code>`).join('')}${btn || ''}</div>`;

/* Todos los movimientos de plata en filas (Inicio y Movimientos) */
function movs(){
  const rows = [];
  const cob = {}; (DB.cobros || []).forEach(c => cob[c.id] = c);
  L(DB, 'items').forEach(i => {
    rows.push({col: 'items', id: i.id, kind: 'compra', ico: '🛒', t: i.desc, s: 'Compra', f: 'negocio', fecha: i.buyDate, u: i.u,
      m: i.buyPocket ? -(+i.buyPrice || 0) : 0, amt: +i.buyPrice || 0, pocket: i.buyPocket, extra: i.buyPocket ? '' : 'no salió de tus bolsillos'});
    if(i.status === 'sold'){
      const paid = i.sellPaid != null && i.sellPaid !== '' ? +i.sellPaid : +i.sellPrice || 0;
      rows.push({col: 'items', id: i.id, kind: 'venta', ico: '💰', t: i.desc, s: paid < (+i.sellPrice || 0) ? 'Venta a crédito' : 'Venta', f: 'negocio',
        fecha: i.sellDate, u: i.u, m: paid, amt: +i.sellPrice || 0, pocket: i.sellPocket});
    }
  });
  L(DB, 'gastos').forEach(g => rows.push({col: 'gastos', id: g.id, ico: g.tipo === 'negocio' ? '🏢' : '👤', t: g.desc || g.cat || 'Gasto',
    s: (g.tipo === 'negocio' ? 'Negocio' : 'Personal') + ' · ' + (g.cat || 'Otro'), f: g.tipo === 'negocio' ? 'negocio' : 'personal', fecha: g.fecha, u: g.u, m: -(+g.valor || 0), pocket: g.bolsillo}));
  L(DB, 'ingresos').forEach(g => rows.push({col: 'ingresos', id: g.id, ico: '➕', t: g.desc || 'Ingreso', s: 'Ingreso', f: 'personal', fecha: g.fecha, u: g.u, m: +g.valor || 0, pocket: g.bolsillo}));
  L(DB, 'abonos').forEach(a => { const c = cob[a.cobroId];
    rows.push({col: 'abonos', id: a.id, ico: '💸', t: 'Abono de ' + (c ? c.nombre : '¿?'), s: 'Abono', f: 'cobros', fecha: a.fecha, u: a.u, m: +a.monto || 0, pocket: a.bolsillo}); });
  L(DB, 'cobros').forEach(c => { if(c.bolsillo) rows.push({col: 'cobros', id: c.id, ico: '🤝', t: 'Préstamo a ' + c.nombre, s: 'Préstamo', f: 'cobros',
    fecha: c.fecha, u: c.u, m: -((+c.total || 0) - (+c.pagado || 0)), pocket: c.bolsillo}); });
  L(DB, 'transfers').forEach(t => rows.push({col: 'transfers', id: t.id, ico: '🔁', t: pn(t.from) + ' → ' + pn(t.to), s: 'Mover', f: 'bolsillos', fecha: t.fecha, u: t.u, m: null, amt: +t.monto || 0}));
  L(DB, 'ajustes').forEach(a => rows.push({col: 'ajustes', id: a.id, ico: '⚖️', t: a.nota || 'Ajuste de saldo', s: 'Ajuste', f: 'bolsillos', fecha: a.fecha, u: a.u, m: +a.delta || 0, pocket: a.bolsillo}));
  return rows.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || (+b.u || 0) - (+a.u || 0));
}

function rowHTML(r){
  const sub = [r.s, fd(r.fecha), r.pocket ? pn(r.pocket) : '', r.extra || ''].filter(Boolean).join(' · ');
  return `<button type="button" class="row" data-a="mov" data-col="${r.col}" data-id="${esc(r.id)}" data-kind="${r.kind || ''}">
    <span class="ico">${r.ico}</span>
    <span class="rmain"><span class="rt" style="display:block">${esc(r.t)}</span><span class="rs" style="display:block">${esc(sub)}</span></span>
    <span class="ramt">${money(r.m, r.amt)}${r.kind === 'venta' && r.m < r.amt ? `<small>de ${full(r.amt)}</small>` : ''}</span></button>`;
}

/* ── Inicio ── */
const QUICK_EX = ['almuerzo 18 mil', 'compré ps5 1.2M nequi', 'vendí ps5 1.5M efectivo', 'envío 12k nequi', 'juan me debe 200k', 'juan abonó 50k nequi', 'retiré 100k nequi', 'sueldo 1.3M nequi'];

function renderInicio(){
  const ex = $('#qEx');
  if(ex && !ex.childElementCount) ex.innerHTML = QUICK_EX.map(e => `<button type="button" class="chip" data-a="ex" data-t="${esc(e)}">${esc(e)}</button>`).join('');
  const t = today(), ym = t.slice(0, 7);
  const bal = balances(DB), st = monthStats(DB, ym), stock = stockItems(), cp = cobrosPend(DB);
  let h = '';

  /* (a) sin nube */
  if(!hasCloud()) h += `<div class="alert" style="--ac:var(--B)"><div class="alert-h"><div><div class="alert-t">☁️ Conecta tu nube</div>
    <div class="meta">Respaldo automático en tu Google Sheet y captura de Nequi.</div></div>
    <button type="button" class="btn b-b" data-a="goAjustes">Conectar</button></div></div>`;

  /* (b) por clasificar */
  const pend = L(DB, 'pend').sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || (+b.u || 0) - (+a.u || 0));
  if(pend.length){
    h += `<div class="sec-h" style="margin-top:4px"><span class="sec-t">📲 Por clasificar</span><span class="pend-n">${pend.length}</span></div>`;
    const max = UI.pendAll ? 40 : 3;
    h += pend.slice(0, max).map(pendCard).join('');
    if(pend.length > max) h += `<button type="button" class="btn b-gh full" style="margin:-2px 0 12px" data-a="pendAll">Ver ${UI.pendAll ? 'más' : 'los ' + pend.length} por clasificar ▾</button>`;
  }

  /* (c) cobros vencidos o de hoy */
  cp.filter(c => c.compromiso && c.compromiso <= t).sort((a, b) => a.compromiso.localeCompare(b.compromiso)).forEach(c => {
    const hoy = c.compromiso === t;
    h += `<div class="alert" style="--ac:${hoy ? 'var(--Y)' : 'var(--R)'}"><div class="alert-h"><div><div class="alert-t">🤝 ${esc(c.nombre)}</div>
      <div class="meta">${hoy ? 'Prometió pagarte <b class="yel">hoy</b>' : 'Debía pagarte el ' + fdE(c.compromiso) + ' · <b class="neg">vencido</b>'}</div></div>
      <div class="alert-m">${full(c.pend)}</div></div>
      <div class="pbtns"><button type="button" class="btn b-wa" data-a="wa" data-id="${esc(c.id)}">💬 WhatsApp</button>
      <button type="button" class="btn b-gh" data-a="abonar" data-id="${esc(c.id)}">+ Abono</button></div></div>`;
  });

  /* (d) productos quietos */
  const quietos = stock.filter(i => daysIn(i) >= 30).sort((a, b) => daysIn(b) - daysIn(a));
  if(quietos.length) h += `<button type="button" class="alert card" style="--ac:var(--O);display:block" data-a="goStock">
    <div class="alert-t">⏳ ${plural(quietos.length, 'producto lleva', 'productos llevan')} +30 días en stock</div>
    <div class="meta">${esc(quietos.slice(0, 3).map(i => i.desc + ' (' + daysIn(i) + ' d)').join(', '))}${quietos.length > 3 ? '…' : ''} · Bájales el precio o publícalos de nuevo.</div></button>`;

  /* tarjetas */
  const caja = Object.keys(bal).reduce((a, k) => a + bal[k], 0);
  const capital = sum(stock, 'buyPrice'), debe = sum(cp, 'pend');
  h += `<div class="kpis">
    <div class="card a-g"><div class="lbl">Caja hoy</div><div class="val">${fmt(caja)}</div><div class="sub">${full(caja)}</div></div>
    <div class="card a-b"><div class="lbl">Utilidad del mes</div><div class="val ${st.neta < 0 ? 'neg' : ''}">${fmt(st.neta)}</div>
      <div class="sub">${plural(st.nVentas, 'venta')} · margen ${Math.round(st.margen)}%</div></div>
    <button type="button" class="card a-y" data-a="goStock"><div class="lbl">En stock</div><div class="val">${fmt(capital)}</div><div class="sub">${plural(stock.length, 'producto')}</div></button>
    <button type="button" class="card a-p" data-a="goCobros"><div class="lbl">Te deben</div><div class="val">${fmt(debe)}</div><div class="sub">${full(debe)} · ${plural(cp.length, 'persona')}</div></button>
  </div>`;

  /* bolsillos */
  h += `<div class="pocks">${pockets().map(p => `<button type="button" class="pock" data-a="ajustar" data-id="${esc(p.id)}" title="Ajustar saldo">
    <small>${esc(p.nombre)}</small><b class="${(bal[p.id] || 0) < 0 ? 'neg' : ''}">${full(bal[p.id] || 0)}</b></button>`).join('')}
    <button type="button" class="pock" data-a="nuevoBolsillo"><small>Nuevo</small><b>＋</b></button></div>`;

  /* acciones rápidas */
  const A = [['compra', '🛒', 'Compré'], ['venta', '💰', 'Vendí'], ['gasto', '💸', 'Gasto'], ['ingreso', '➕', 'Ingreso'], ['cobro', '🤝', 'Me deben'], ['abono', '💵', 'Abono'], ['transfer', '🔁', 'Mover']];
  h += `<div class="acts">${A.map(([k, i, l]) => `<button type="button" class="act" data-a="form" data-k="${k}" data-testid="act-${k}"><span>${i}</span>${l}</button>`).join('')}
    <button type="button" class="act" data-a="voz"><span>🎤</span>Dictar</button></div>`;

  /* últimos movimientos */
  const ult = movs().slice(0, 6);
  h += `<div class="sec-h"><span class="sec-t">Últimos movimientos</span>${ult.length ? '<button type="button" class="link" data-a="goMovs">Ver todo →</button>' : ''}</div>`;
  h += ult.length ? `<div class="list">${ult.map(rowHTML).join('')}</div>`
    : emptyHTML('✍️', 'Aún no hay movimientos. Escribe arriba, por ejemplo:', ['almuerzo 18 mil', 'compré ps5 1.2M nequi', 'vendí tenis 250k efectivo']);
  $('#inicioBody').innerHTML = h;
}

/* Tarjeta de un movimiento capturado de Nequi */
const PEND_OUT = [['compra', '🛒 Compra'], ['gastoN', '🏢 Gasto negocio'], ['gastoP', '👤 Gasto personal'], ['transferOut', '🔁 Retiro/mover'], ['prestamo', '🤝 Préstamo']];
const PEND_IN = [['venta', '💰 Venta'], ['abono', '💸 Abono'], ['ingreso', '➕ Ingreso'], ['transferIn', '🔁 Mover']];

function ruleFor(p){
  const k = normKey(p.quien);
  if(!k) return null;                                   // §10.4: sin quien no hay regla
  const r = L(DB, 'reglas').find(x => x.id === k);
  if(!r) return null;
  if(r.kind === 'gasto' && p.dir === 'in') return null;
  if(r.kind === 'ingreso' && p.dir === 'out') return null;
  return r;
}
function ruleLabel(r){
  if(r.kind === 'gasto') return 'Gasto ' + (r.tipo === 'negocio' ? 'negocio' : 'personal') + ' · ' + (r.cat || 'Otro');
  if(r.kind === 'ingreso') return 'Ingreso · ' + (r.desc || 'Ingreso');
  return 'Mover · ' + pn(r.from) + ' → ' + pn(r.to);
}

function pendCard(p){
  const dir = p.dir, m = +p.monto || 0;
  const amt = dir === 'in' ? `<span class="pos">+${full(m)}</span>` : dir === 'out' ? `<span class="neg">−${full(m)}</span>` : `<span class="yel">${full(m)}</span>`;
  const btns = dir === 'in' ? PEND_IN : dir === 'out' ? PEND_OUT : PEND_OUT.concat(PEND_IN);
  const r = ruleFor(p), id = esc(p.id);
  return `<div class="alert" data-testid="pend" data-id="${id}" style="--ac:${dir === 'in' ? 'var(--G)' : dir === 'out' ? 'var(--R)' : 'var(--Y)'}">
    <div class="alert-h"><div style="min-width:0"><div class="alert-t">${esc(p.quien || 'Sin nombre')}</div>
      <div class="meta">${fdE(p.fecha)} · ${esc(pn(p.bolsillo || 'nequi'))}${dir === '?' ? ' · <span class="yel">¿entró o salió?</span>' : ''}</div></div>
      <div class="alert-m">${amt}</div></div>
    ${p.raw ? `<div class="raw">${esc(p.raw)}</div>` : ''}
    <div class="pbtns">
      ${r ? `<button type="button" class="btn rule wide" data-a="pendRule" data-id="${id}">↻ Igual que antes: ${esc(ruleLabel(r))}</button>` : ''}
      ${r && !UI.pendOpen[p.id] ? `<button type="button" class="btn b-gh" data-a="pendMore" data-id="${id}">Otro tipo…</button>`
        : btns.map(([k, l]) => `<button type="button" class="btn b-gh" data-a="pend" data-k="${k}" data-id="${id}">${l}</button>`).join('')}
      <button type="button" class="btn b-gh mut ${(r && !UI.pendOpen[p.id]) || btns.length % 2 ? '' : 'wide'}" data-a="pendIgnore" data-id="${id}">Ignorar</button>
    </div></div>`;
}

/* ── Stock ── */
function renderStock(){
  $$('#stSeg button').forEach(b => b.classList.toggle('on', b.dataset.seg === UI.stSeg));
  const q = normKey(UI.stQ), qs = q ? q.split(' ') : [];
  const match = i => !qs.length || qs.every(w => normKey([i.desc, i.cat, i.notes].join(' ')).includes(w));
  const all = L(DB, 'items'), t = today();
  let h = '';
  if(UI.stSeg === 'stock'){
    const st = all.filter(i => i.status !== 'sold');
    const list = st.filter(match).sort((a, b) => String(b.buyDate || '').localeCompare(String(a.buyDate || '')) || (+b.u || 0) - (+a.u || 0));
    const quietos = st.filter(i => daysBetween(i.buyDate, t) >= 30).length;
    h += `<div class="tot">
      <div class="card a-y"><div class="lbl">Capital</div><div class="val">${fmt(sum(st, 'buyPrice'))}</div></div>
      <div class="card a-b"><div class="lbl">Productos</div><div class="val">${st.length}</div></div>
      <div class="card a-o"><div class="lbl">Quietos</div><div class="val ${quietos ? 'yel' : ''}">${quietos}</div></div></div>`;
    if(!st.length) h += emptyHTML('📦', 'No tienes productos en stock. Registra una compra:', ['compré ps5 1.2M nequi', 'compré tenis jordan 180k efectivo'],
      `<div class="btns"><button type="button" class="btn b-g" data-a="form" data-k="compra">🛒 Registrar compra</button></div>`);
    else if(!list.length) h += emptyHTML('🔎', 'Nada coincide con “' + esc(UI.stQ) + '”.');
    h += list.map(i => {
      const d = daysBetween(i.buyDate, t), meta = +i.targetPrice || 0;
      const dc = d >= 60 ? 't-r' : d >= 30 ? 't-y' : 't-n';
      return `<div class="it" data-testid="item" data-id="${esc(i.id)}"><div class="it-h"><div style="min-width:0"><div class="it-n">${esc(i.desc)}</div>
        <div class="it-tags"><span class="tag t-b">${esc(i.cat || 'Otro')}</span><span class="tag ${dc}">${d} ${d === 1 ? 'día' : 'días'}</span>${i.cond ? `<span class="tag t-n">${esc(i.cond)}</span>` : ''}</div></div></div>
        <div class="kv"><div><small>Costo</small><b>${full(i.buyPrice)}</b></div><div><small>Meta</small><b>${meta ? full(meta) : '—'}</b></div>
        <div><small>Ganarías</small><b class="${meta ? (meta - i.buyPrice >= 0 ? 'pos' : 'neg') : 'mut'}">${meta ? full(meta - i.buyPrice) : '—'}</b></div></div>
        ${i.notes ? `<div class="meta" style="margin-top:6px">${esc(i.notes)}</div>` : ''}
        <div class="btns"><button type="button" class="btn b-g" data-a="vender" data-id="${esc(i.id)}">💰 Vender</button>
        <button type="button" class="btn b-gh" data-a="editItem" data-id="${esc(i.id)}">✏️ Editar</button></div></div>`;
    }).join('');
  } else {
    const sold = all.filter(i => i.status === 'sold');
    const list = sold.filter(match).sort((a, b) => String(b.sellDate || '').localeCompare(String(a.sellDate || '')) || (+b.u || 0) - (+a.u || 0));
    const gan = sum(sold, 'sellPrice') - sum(sold, 'buyPrice');
    h += `<div class="tot">
      <div class="card a-g"><div class="lbl">Vendidos</div><div class="val">${sold.length}</div></div>
      <div class="card a-b"><div class="lbl">Ventas</div><div class="val">${fmt(sum(sold, 'sellPrice'))}</div></div>
      <div class="card a-p"><div class="lbl">Ganancia</div><div class="val ${gan < 0 ? 'neg' : 'pos'}">${fmt(gan)}</div></div></div>`;
    if(!sold.length) h += emptyHTML('💰', 'Todavía no hay ventas. Cuando vendas, escribe en Inicio:', ['vendí ps5 1.5M efectivo', 'vendí tenis 250k fiado a juan']);
    else if(!list.length) h += emptyHTML('🔎', 'Nada coincide con “' + esc(UI.stQ) + '”.');
    h += list.slice(0, 150).map(i => {
      const g = (+i.sellPrice || 0) - (+i.buyPrice || 0), paid = i.sellPaid != null && i.sellPaid !== '' ? +i.sellPaid : +i.sellPrice;
      return `<div class="it" data-testid="item" data-id="${esc(i.id)}"><div class="it-h"><div style="min-width:0"><div class="it-n">${esc(i.desc)}</div>
        <div class="it-tags"><span class="tag t-b">${esc(i.cat || 'Otro')}</span><span class="tag t-g">vendido ${fdE(i.sellDate)}</span>
        <span class="tag t-n">${daysBetween(i.buyDate, i.sellDate)} d</span>${paid < i.sellPrice ? '<span class="tag t-y">a crédito</span>' : ''}</div></div>
        <button type="button" class="ibtn" data-a="editItem" data-id="${esc(i.id)}" aria-label="Editar">✏️</button></div>
        <div class="kv"><div><small>Costo</small><b>${full(i.buyPrice)}</b></div><div><small>Precio</small><b>${full(i.sellPrice)}</b></div>
        <div><small>Ganancia</small><b class="${g >= 0 ? 'pos' : 'neg'}">${full(g)}</b></div></div></div>`;
    }).join('');
    if(list.length > 150) h += `<p class="hint">Mostrando las 150 más recientes. Usa el buscador.</p>`;
  }
  $('#stockBody').innerHTML = h;
}

/* ── Movimientos ── */
function renderMovs(){
  const ym = UI.mvMonth;
  $('#mvMonth').textContent = ymLabel(ym);
  $('#mvNext').disabled = ym >= today().slice(0, 7);
  $$('#mvFil button').forEach(b => b.classList.toggle('on', b.dataset.f === UI.mvF));
  const all = movs().filter(r => String(r.fecha || '').slice(0, 7) === ym);
  const rows = UI.mvF === 'todos' ? all : all.filter(r => r.f === UI.mvF);
  const entro = rows.reduce((a, r) => a + (r.m > 0 ? r.m : 0), 0), salio = rows.reduce((a, r) => a + (r.m < 0 ? -r.m : 0), 0);
  let h = `<div class="tot">
    <div class="card a-g"><div class="lbl">Entró</div><div class="val pos">${fmt(entro)}</div></div>
    <div class="card a-r"><div class="lbl">Salió</div><div class="val neg">${fmt(salio)}</div></div>
    <div class="card a-b"><div class="lbl">Neto</div><div class="val ${entro - salio < 0 ? 'neg' : ''}">${fmt(entro - salio)}</div></div></div>`;
  if(!rows.length) h += emptyHTML('📋', all.length ? 'Nada con este filtro en ' + ymLabel(ym) + '.' : 'Sin movimientos en ' + ymLabel(ym) + '.');
  else h += `<div class="list">${rows.slice(0, 300).map(rowHTML).join('')}</div><p class="hint" style="text-align:center">Toca un producto para editarlo; cualquier otro movimiento, para eliminarlo.</p>`;
  $('#movsBody').innerHTML = h;
}

/* ── Cobros ── */
function renderCobros(){
  const t = today();
  const all = L(DB, 'cobros').map(c => { const pag = cobroPagado(DB, c); return Object.assign({}, c, {pag, pend: Math.max(0, (+c.total || 0) - pag)}); });
  const pend = all.filter(c => c.pend > 0).sort((a, b) => (a.compromiso || '9999').localeCompare(b.compromiso || '9999') || String(a.fecha || '').localeCompare(String(b.fecha || '')));
  const ok = all.filter(c => c.pend <= 0).sort((a, b) => (+b.u || 0) - (+a.u || 0));
  let h = `<div class="card a-p" style="margin-bottom:12px"><div class="lbl">Total por cobrar</div><div class="val">${full(sum(pend, 'pend'))}</div>
    <div class="sub">${plural(pend.length, 'persona')} te ${pend.length === 1 ? 'debe' : 'deben'}</div></div>`;
  if(!pend.length) h += emptyHTML('🤝', 'Nadie te debe. Cuando fíes o prestes, escribe en Inicio:', ['juan me debe 200k', 'le presté 100k a camilo nequi']);
  const card = (c, dim) => {
    const pct = c.total ? Math.min(100, Math.round(c.pag / c.total * 100)) : 0;
    let tag = '';
    if(!dim && c.compromiso) tag = c.compromiso < t ? '<span class="tag t-r">vencido</span>' : c.compromiso === t ? '<span class="tag t-y">hoy</span>' : `<span class="tag t-n">paga ${fdE(c.compromiso)}</span>`;
    return `<div class="it ${dim ? 'dim' : ''}" data-testid="cobro" data-id="${esc(c.id)}"><div class="it-h"><div style="min-width:0"><div class="it-n">${esc(c.nombre)}</div>
      <div class="it-tags">${tag}${c.bolsillo ? '<span class="tag t-b">préstamo</span>' : ''}${dim ? '<span class="tag t-g">saldado ✓</span>' : ''}${c.tel ? `<span class="tag t-n">${esc(c.tel)}</span>` : ''}</div></div>
      <div class="alert-m ${dim ? 'mut' : ''}">${full(c.pend)}</div></div>
      ${c.notas ? `<div class="meta" style="margin-top:6px">${esc(c.notas)}</div>` : ''}
      <div class="kv"><div><small>Total</small><b>${full(c.total)}</b></div><div><small>Abonado</small><b class="pos">${full(c.pag)}</b></div><div><small>Debe</small><b>${full(c.pend)}</b></div></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      ${dim ? `<div class="btns"><button type="button" class="btn b-gh" data-a="delCobro" data-id="${esc(c.id)}">🗑️ Eliminar</button></div>`
        : `<div class="btns"><button type="button" class="btn b-g" data-a="abonar" data-id="${esc(c.id)}">+ Abono</button>
        <button type="button" class="btn b-wa" data-a="wa" data-id="${esc(c.id)}">💬 WhatsApp</button>
        <button type="button" class="ibtn" data-a="editCobro" data-id="${esc(c.id)}" aria-label="Editar">✏️</button>
        <button type="button" class="ibtn" data-a="delCobro" data-id="${esc(c.id)}" aria-label="Eliminar">🗑️</button></div>`}</div>`;
  };
  h += pend.map(c => card(c, false)).join('');
  if(ok.length) h += `<div class="sec-h" style="margin-top:16px"><span class="sec-t">Saldados</span></div>` + ok.slice(0, 30).map(c => card(c, true)).join('');
  $('#cobrosBody').innerHTML = h;
}

/* ── Más: Análisis · Bolsillos · Ajustes ── */
function renderMas(){
  $$('#masSeg button').forEach(b => b.classList.toggle('on', b.dataset.seg === UI.masSeg));
  $$('#v-mas [data-mas]').forEach(d => { d.hidden = d.dataset.mas !== UI.masSeg; });
  if(UI.masSeg === 'analisis') renderAnalisis();
  else if(UI.masSeg === 'bolsillos') renderBolsillos();
  else renderAjustes();
}

function renderAnalisis(){
  const ym = UI.anMonth, s = monthStats(DB, ym);
  $('#anMonth').textContent = ymLabel(ym);
  $('#anNext').disabled = ym >= today().slice(0, 7);
  const k = (lbl, v, sub, ac, cls) => `<div class="card ${ac}"><div class="lbl">${lbl}</div><div class="val ${cls || ''}">${v}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  $('#anKpis').innerHTML = `<div class="kpis">
    ${k('Ventas', fmt(s.ventas), plural(s.nVentas, 'venta'), 'a-g')}
    ${k('Utilidad bruta', fmt(s.bruta), 'ventas − costo', 'a-t', s.bruta < 0 ? 'neg' : '')}
    ${k('Gastos negocio', fmt(s.gN), 'envíos, empaques…', 'a-o')}
    ${k('Utilidad neta', fmt(s.neta), 'margen ' + Math.round(s.margen) + '%', 'a-b', s.neta < 0 ? 'neg' : 'pos')}
    ${k('Gastos personales', fmt(s.gP), '', 'a-r')}
    ${k('Compras', fmt(s.compras), 'inventario nuevo', 'a-y')}
    ${k('Días para vender', s.diasProm == null ? '—' : s.diasProm + ' d', 'promedio', 'a-p')}
    ${k('Ingresos personales', fmt(s.ing), 'sueldo, regalos…', 'a-g')}</div>`;

  /* gráfico de 6 meses */
  const months = []; for(let i = 5; i >= 0; i--) months.push(ymAdd(ym, -i));
  const data = months.map(m => monthStats(DB, m));
  const box = $('#anChartBox'), alt = $('#anChartAlt');
  if(UI.chart){ try { UI.chart.destroy(); } catch(e){} UI.chart = null; }
  if(typeof Chart !== 'undefined'){
    box.hidden = false; alt.hidden = true;
    try {
      Chart.defaults.font.family = "Outfit, system-ui, sans-serif"; Chart.defaults.color = "#8b98a5";
      UI.chart = new Chart($('#anChart'), {
        data: {labels: months.map(monthLabel), datasets: [
          {type: 'bar', label: 'Ventas', data: data.map(d => d.ventas), backgroundColor: 'rgba(16,217,138,.55)', borderRadius: 4, order: 2},
          {type: 'bar', label: 'Gastos personales', data: data.map(d => d.gP), backgroundColor: 'rgba(255,140,66,.5)', borderRadius: 4, order: 3},
          {type: 'line', label: 'Utilidad neta', data: data.map(d => d.neta), borderColor: '#4da6ff', backgroundColor: '#4da6ff', tension: .3, pointRadius: 3, order: 1}
        ]},
        options: {responsive: true, maintainAspectRatio: false, animation: false,
          plugins: {legend: {labels: {color: '#8ba4be', boxWidth: 12, font: {family: 'Outfit', size: 12}}},
            tooltip: {callbacks: {label: c => c.dataset.label + ': ' + full(c.parsed.y)}}},
          scales: {x: {ticks: {color: '#5d7a96'}, grid: {display: false}},
            y: {ticks: {color: '#5d7a96', callback: v => fmt(v)}, grid: {color: 'rgba(30,45,61,.6)'}}}}
      });
    } catch(e){ box.hidden = true; alt.hidden = false; alt.textContent = 'No pude dibujar el gráfico.'; }
  } else {
    box.hidden = true; alt.hidden = false;
    const mx = Math.max(1, ...data.map(d => d.ventas));
    alt.innerHTML = '<p style="margin-bottom:6px">Ventas por mes (el gráfico completo necesita internet una vez):</p>' +
      data.map((d, i) => `<div class="hbar"><span>${monthLabel(months[i])}</span><span class="tr"><i style="width:${Math.round(d.ventas / mx * 100)}%;background:var(--G)"></i></span><b>${fmt(d.ventas)}</b></div>`).join('');
  }

  /* gastos por categoría, top productos, mejores categorías */
  let h = '';
  const cats = Object.keys(s.cats).map(c => [c, s.cats[c]]).sort((a, b) => b[1] - a[1]);
  const cmx = Math.max(1, ...cats.map(c => c[1]));
  h += `<div class="sec"><div class="sec-h"><span class="sec-t">Gastos por categoría</span><span class="mono mut">${fmt(s.gN + s.gP)}</span></div>${cats.length
    ? cats.map(([c, v]) => `<div class="hbar"><span>${esc(c)}</span><span class="tr"><i style="width:${Math.round(v / cmx * 100)}%;background:${c.startsWith('🏢') ? 'var(--B)' : 'var(--O)'}"></i></span><b>${fmt(v)}</b></div>`).join('')
    : '<p class="hint">Sin gastos este mes.</p>'}</div>`;
  const top = s.sold.map(i => ({i, g: (+i.sellPrice || 0) - (+i.buyPrice || 0)})).sort((a, b) => b.g - a.g).slice(0, 5);
  h += `<div class="sec"><div class="sec-h"><span class="sec-t">Top 5 productos del mes</span></div>${top.length
    ? top.map((x, n) => `<div class="kvline"><span>${n + 1}. ${esc(x.i.desc)}</span><b class="mono ${x.g >= 0 ? 'pos' : 'neg'}">${full(x.g)}</b></div>`).join('')
    : '<p class="hint">Sin ventas este mes.</p>'}</div>`;
  const byCat = {};
  L(DB, 'items').filter(i => i.status === 'sold').forEach(i => { const c = i.cat || 'Otro'; const o = byCat[c] || (byCat[c] = {n: 0, v: 0, g: 0}); o.n++; o.v += +i.sellPrice || 0; o.g += (+i.sellPrice || 0) - (+i.buyPrice || 0); });
  const best = Object.keys(byCat).map(c => Object.assign({c, m: byCat[c].v ? byCat[c].g / byCat[c].v * 100 : 0}, byCat[c])).sort((a, b) => b.m - a.m).slice(0, 5);
  h += `<div class="sec"><div class="sec-h"><span class="sec-t">Mejores categorías (histórico)</span></div>${best.length
    ? best.map(b => `<div class="kvline"><span>${esc(b.c)} <span class="mut" style="font-size:12px">· ${plural(b.n, 'venta')} · ${fmt(b.g)}</span></span><b class="mono ${b.m >= 0 ? 'pos' : 'neg'}">${Math.round(b.m)}%</b></div>`).join('')
    : '<p class="hint">Cuando vendas, aquí verás qué categoría te deja más margen.</p>'}</div>`;
  $('#anBody').innerHTML = h;
}

function renderBolsillos(){
  const bal = balances(DB), ps = pockets(), tot = ps.reduce((a, p) => a + (bal[p.id] || 0), 0);
  let h = `<div class="card a-g" style="margin-bottom:12px"><div class="lbl">Total en bolsillos</div><div class="val">${full(tot)}</div></div>`;
  h += ps.map(p => `<div class="it" data-testid="bolsillo" data-id="${esc(p.id)}"><div class="it-h"><div class="it-n">${esc(p.nombre)}</div>
    <div class="alert-m ${(bal[p.id] || 0) < 0 ? 'neg' : ''}">${full(bal[p.id] || 0)}</div></div>
    <div class="btns"><button type="button" class="btn b-gh" data-a="ajustar" data-id="${esc(p.id)}">⚖️ Ajustar saldo</button>
    <button type="button" class="ibtn" data-a="renombrar" data-id="${esc(p.id)}" aria-label="Renombrar">✏️</button>
    ${pocketUsed(p.id) ? '' : `<button type="button" class="ibtn" data-a="delBolsillo" data-id="${esc(p.id)}" aria-label="Eliminar">🗑️</button>`}</div></div>`).join('');
  h += `<div class="btns" style="margin-bottom:12px"><button type="button" class="btn b-g" data-a="nuevoBolsillo">+ Nuevo bolsillo</button>
    <button type="button" class="btn b-b" data-a="form" data-k="transfer">🔁 Mover entre bolsillos</button></div>
    <p class="hint">El saldo se calcula solo con lo que registras; si no cuadra con Nequi, usa <b>Ajustar</b>. Solo puedes eliminar un bolsillo sin movimientos.</p>`;
  $('#bolBody').innerHTML = h;
}

/* ═════════ 3. FORMULARIOS (motor genérico + tipos) ═════════ */
let F = null;   // formulario abierto: {kind, spec, d, v, fields, touched, fromQuick}
const num = x => Math.round(+x || 0);
const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const miles = n => String(Math.round(Math.abs(+n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const defPocket = () => { const ps = pockets(); return (ps.find(p => p.id === 'nequi') || ps[0] || {id: ''}).id; };
const POCKET_NONE = ['', 'No salió de mis bolsillos'];

function fieldHTML(f){
  const id = 'f-' + f.k, val = F.v[f.k];
  const common = `id="${id}" name="${f.k}" data-testid="${id}"`;
  let inp = '';
  const opts = f.opts || [];
  if(f.type === 'money'){
    inp = `<input class="in money" ${common} type="text" inputmode="decimal" autocomplete="off" placeholder="${esc(f.ph || '$ 0')}" value="${val === '' || val == null ? '' : miles(val)}">
      <span class="eq" data-eq="${f.k}"></span>`;
  } else if(f.type === 'date'){
    inp = `<input class="in" ${common} type="date" value="${esc(val)}">`;
  } else if(f.type === 'select' || (f.type === 'seg' && opts.length > 5)){
    inp = `<select class="in" ${common}>${opts.map(([o, l]) => `<option value="${esc(o)}"${String(o) === String(val) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  } else if(f.type === 'seg'){
    inp = `<div class="opts" ${common} data-k="${f.k}" role="radiogroup">${opts.map(([o, l]) =>
      `<button type="button" role="radio" aria-checked="${String(o) === String(val)}" class="${String(o) === String(val) ? 'on' : ''}" data-v="${esc(o)}" data-testid="${id}-${esc(o || 'ninguno')}">${esc(l)}</button>`).join('')}</div>`;
  } else if(f.type === 'tel'){
    inp = `<input class="in" ${common} type="tel" inputmode="tel" autocomplete="off" placeholder="${esc(f.ph || '300 123 4567')}" value="${esc(val)}">`;
  } else if(f.type === 'info'){
    inp = `<div class="hint">${f.html || ''}</div>`;
  } else {
    inp = `<input class="in" ${common} type="text" autocomplete="off" autocapitalize="sentences" placeholder="${esc(f.ph || '')}" value="${esc(val)}">`;
  }
  return `<div class="fld" data-fk="${f.k}">${f.label ? `<label for="${id}">${esc(f.label)}</label>` : ''}${inp}${f.note ? `<span class="note">${f.note}</span>` : ''}</div>`;
}

function openForm(kind, d, opts){
  const spec = FORMS[kind];
  if(!spec) return;
  d = Object.assign({}, d || {});
  if(spec.prep) spec.prep(d);
  const fields = spec.fields(d);
  const v = {};
  fields.forEach(f => { let x = d[f.k]; if(x === undefined || x === null) x = f.val !== undefined ? f.val : ''; v[f.k] = x; });
  F = {kind, spec, d, v, fields, touched: {}, fromQuick: !!(opts && opts.fromQuick)};
  $('#sheetTitle').textContent = typeof spec.title === 'function' ? spec.title(d) : spec.title;
  $('#sheetBody').innerHTML = (spec.intro ? spec.intro(d) : '') + fields.map(fieldHTML).join('');
  $('#sheetFoot').innerHTML = (spec.del && d.id ? '<button type="button" class="btn b-r" data-a="formDel" data-testid="form-del">🗑️</button>' : '') +
    (spec.extra ? spec.extra(d) : '') +
    (spec.extra && spec.extra(d) ? '' : '<button type="button" class="btn b-gh" data-a="formClose" data-testid="form-cancel">Cancelar</button>') +
    `<button type="submit" class="btn b-g" data-testid="form-save">${esc(spec.saveLabel || 'Guardar')}</button>`;
  fields.forEach(f => { if(f.type === 'money') moneyEq(f.k); });
  refreshShow();
  const sh = $('#sheet');
  sh.classList.add('on'); sh.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  try { if(!(history.state && history.state.sheet)) history.pushState({sheet: 1}, ''); } catch(e){}
  const b = $('#sheetBody'); if(b) b.scrollTop = 0;
  // enfocar el primer campo obligatorio vacío (en formularios prellenados no abre el teclado)
  const first = fields.find(f => f.req && (F.v[f.k] === '' || F.v[f.k] == null) && fieldVisible(f));
  if(first){ const el = $('#f-' + first.k); if(el && el.focus) setTimeout(() => { if(F && F.kind === kind) el.focus(); }, 60); }
}

function closeForm(){
  F = null;
  const sh = $('#sheet');
  sh.classList.remove('on'); sh.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if(document.activeElement && sh.contains(document.activeElement)) document.activeElement.blur();
  setTimeout(() => { if(!F){ $('#sheetBody').innerHTML = ''; $('#sheetFoot').innerHTML = ''; $('#sheetTitle').textContent = ''; } }, 220);
}

const fieldVisible = f => !f.show || !!f.show(F.v);
function refreshShow(){
  if(!F) return;
  F.fields.forEach(f => { const w = $(`#sheetBody [data-fk="${f.k}"]`); if(w) w.hidden = !fieldVisible(f); });
}
function moneyEq(k){
  const el = $(`#sheetBody [data-eq="${k}"]`), inp = $('#f-' + k);
  if(!el || !inp) return;
  el.textContent = /[a-z]/i.test(inp.value) && F.v[k] ? '= ' + full(F.v[k]) : '';
}
/* Cambia un valor desde el código (autollenado) y refleja el DOM */
function setVal(k, val){
  if(!F) return;
  F.v[k] = val;
  const el = $('#f-' + k);
  if(!el) return;
  if(el.classList.contains('opts')) $$('button', el).forEach(b => { const on = b.dataset.v === String(val); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  else if(el.classList.contains('money')){ el.value = val === '' || val == null ? '' : miles(val); moneyEq(k); }
  else el.value = val == null ? '' : val;
}
function onField(k){
  if(!F) return;
  F.touched[k] = true;
  if(F.spec.change) F.spec.change(k, F.v, setVal, F);
  refreshShow();
}
/* Montos: atajos (1.2M, 50k, 50 mil) con parseMoney; puntos de miles mientras escribe */
function onMoneyInput(el){
  const f = typingMoney(el.value);
  if(f !== el.value) el.value = f;
  F.v[el.name] = f.trim() === '' ? '' : parseMoney(f);
  moneyEq(el.name);
}

function saveForm(){
  if(!F) return;
  // los montos se releen del DOM (por si el teclado no disparó "input")
  F.fields.forEach(f => { if(f.type === 'money'){ const el = $('#f-' + f.k); if(el) F.v[f.k] = el.value.trim() === '' ? '' : parseMoney(el.value); } });
  let res;
  try { res = F.spec.save(F.v, F.d, F) || {}; }
  catch(e){ console.error(e); toast('No pude guardar: ' + (e && e.message || e), {err: true}); return; }
  if(res.err){
    toast(res.err, {err: true});
    if(res.k){ const el = $('#f-' + res.k); if(el && el.focus) el.focus(); }
    return;
  }
  const d = F.d, kind = F.kind, fromQuick = F.fromQuick;
  if(d._pend){
    const p = get('pend', d._pend);
    if(p){ learnRule(p, kind, res.rec || {}); remove('pend', p.id); }
  }
  if(fromQuick){ const q = $('#qInput'); if(q) q.value = ''; }
  closeForm();
  if(res.after) res.after();
  commit(res.msg, res.toast);
}

/* Regla aprendida: quien → cómo se clasificó (solo gasto/ingreso/transfer y con quien no vacío, §10.4) */
function learnRule(p, kind, rec){
  if(!['gasto', 'ingreso', 'transfer'].includes(kind)) return;
  const k = normKey(p.quien);
  if(!k) return;
  put('reglas', {id: k, kind, desc: rec.desc || '', cat: rec.cat || '', tipo: rec.tipo || '', from: rec.from || '', to: rec.to || ''});
}

function deleteFromForm(){
  if(!F || !F.spec.del) return;
  const r = F.spec.del(F.v, F.d);
  if(!r) return;
  closeForm();
  commit(r.msg, r.undo ? {undo: r.undo} : null);
}

/* borra un cobro y sus abonos (en cascada); devuelve lo borrado para "Deshacer" */
function removeCobro(id){
  const c = get('cobros', id);
  if(!c) return null;
  const abs = L(DB, 'abonos').filter(a => a.cobroId === id);
  remove('cobros', id); abs.forEach(a => remove('abonos', a.id));
  return {c, abs};
}
const undoCobro = x => () => { if(!x) return; restore('cobros', x.c); x.abs.forEach(a => restore('abonos', a)); commit('Recuperado ✓'); };

const venderOpts = () => [['', '— Elige —']].concat(stockItems().sort((a, b) => String(a.desc).localeCompare(String(b.desc)))
  .map(i => [i.id, i.desc + ' · costó ' + fmt(i.buyPrice)])).concat([['__nuevo', '➕ Producto no registrado']]);

const FORMS = {
  compra: {
    title: '🛒 Compré',
    prep: d => { if(!d.buyDate) d.buyDate = today(); if(d.buyPocket === undefined) d.buyPocket = defPocket(); if(!d.cond) d.cond = 'bueno'; if(!d.cat) d.cat = d.desc ? guessCat(d.desc) : 'Otro'; },
    fields: () => [
      {k: 'desc', label: 'Producto', type: 'text', ph: 'Ej: PS5 Slim 1TB', req: 1},
      {k: 'cat', label: 'Categoría', type: 'select', opts: CATS.map(c => [c, c])},
      {k: 'buyPrice', label: '¿Cuánto te costó?', type: 'money', req: 1, ph: 'Ej: 1.2M o 350.000'},
      {k: 'buyPocket', label: '¿De dónde salió la plata?', type: 'seg', opts: pocketOpts().concat([POCKET_NONE])},
      {k: 'buyDate', label: 'Fecha', type: 'date'},
      {k: 'targetPrice', label: 'Precio meta (opcional)', type: 'money', ph: '¿En cuánto lo quieres vender?'},
      {k: 'cond', label: 'Estado', type: 'seg', opts: [['nuevo', 'Nuevo'], ['bueno', 'Bueno'], ['regular', 'Regular']]},
      {k: 'notes', label: 'Notas (opcional)', type: 'text', ph: 'Color, capacidad, detalles…'}
    ],
    change: (k, v, set, F) => { if(k === 'desc' && !F.touched.cat) set('cat', guessCat(v.desc)); },
    save: v => {
      const desc = clean(v.desc), p = num(v.buyPrice);
      if(!desc) return {err: 'Escribe qué compraste', k: 'desc'};
      if(p <= 0) return {err: '¿Cuánto te costó?', k: 'buyPrice'};
      const rec = put('items', {desc, cat: v.cat || guessCat(desc), cond: v.cond || 'bueno', notes: clean(v.notes), buyPrice: p, buyPocket: v.buyPocket || '',
        buyDate: v.buyDate || today(), targetPrice: num(v.targetPrice) || null, status: 'stock'});
      return {rec, msg: `📦 ${desc} en stock · ${full(p)}`};
    }
  },

  venta: {
    title: '💰 Vendí',
    prep: d => {
      if(!d.sellDate) d.sellDate = today();
      if(d.sellPocket === undefined) d.sellPocket = defPocket();
      if(!d.completo) d.completo = 'si';
      if(d.itemId === undefined) d.itemId = '';
      if(d.itemId && d.itemId !== '__nuevo' && !d.sellPrice){ const it = get('items', d.itemId); if(it && it.targetPrice) d.sellPrice = +it.targetPrice; }
      if(d.itemId === '__nuevo' && !d.cat) d.cat = d.desc ? guessCat(d.desc) : 'Otro';
    },
    intro: () => stockItems().length ? '' : '<p class="hint" style="margin-bottom:10px">No tienes productos en stock: elige <b>➕ Producto no registrado</b>.</p>',
    fields: () => {
      const nuevo = v => v.itemId === '__nuevo', fiado = v => v.completo === 'no';
      return [
        {k: 'itemId', label: 'Producto', type: 'select', opts: venderOpts(), req: 1},
        {k: 'desc', label: 'Nombre del producto', type: 'text', ph: 'Ej: Tenis Jordan 1', show: nuevo},
        {k: 'buyPrice', label: '¿Cuánto te costó?', type: 'money', show: nuevo, note: 'Para calcular tu ganancia. No se descuenta de tus bolsillos.'},
        {k: 'cat', label: 'Categoría', type: 'select', opts: CATS.map(c => [c, c]), show: nuevo},
        {k: 'sellPrice', label: 'Precio de venta', type: 'money', req: 1, ph: 'Ej: 1.5M'},
        {k: 'completo', label: '¿Te pagó completo?', type: 'seg', opts: [['si', 'Sí, todo'], ['no', 'No, quedó debiendo']]},
        {k: 'sellPaid', label: '¿Cuánto te pagó ya?', type: 'money', show: fiado, ph: '0 si no pagó nada'},
        {k: 'cliente', label: 'Nombre del cliente', type: 'text', show: fiado, ph: 'Ej: Juan Pérez'},
        {k: 'tel', label: 'Celular (opcional)', type: 'tel', show: fiado},
        {k: 'compromiso', label: '¿Cuándo te paga? (opcional)', type: 'date', show: fiado},
        {k: 'sellPocket', label: '¿A dónde entró la plata?', type: 'seg', opts: pocketOpts(), show: v => !fiado(v) || num(v.sellPaid) > 0},
        {k: 'sellDate', label: 'Fecha', type: 'date'},
        {k: 'sellNotes', label: 'Nota (opcional)', type: 'text'}
      ];
    },
    change: (k, v, set, F) => {
      if(k === 'itemId' && v.itemId && v.itemId !== '__nuevo' && !F.touched.sellPrice){ const it = get('items', v.itemId); if(it && it.targetPrice) set('sellPrice', +it.targetPrice); }
      if(k === 'desc' && !F.touched.cat) set('cat', guessCat(v.desc));
    },
    save: v => {
      let it;
      if(!v.itemId) return {err: 'Elige el producto que vendiste', k: 'itemId'};
      const sp = num(v.sellPrice);
      if(v.itemId === '__nuevo'){
        const desc = clean(v.desc);
        if(!desc) return {err: 'Escribe el nombre del producto', k: 'desc'};
        if(num(v.buyPrice) <= 0) return {err: '¿Cuánto te costó? (para tu ganancia)', k: 'buyPrice'};
        if(sp <= 0) return {err: '¿En cuánto lo vendiste?', k: 'sellPrice'};
        it = {id: uid(), desc, cat: v.cat || guessCat(desc), cond: 'bueno', notes: '', buyPrice: num(v.buyPrice), buyPocket: '', buyDate: v.sellDate || today(), targetPrice: null};
      } else {
        it = get('items', v.itemId);
        if(!it) return {err: 'Ese producto ya no está en stock', k: 'itemId'};
        if(sp <= 0) return {err: '¿En cuánto lo vendiste?', k: 'sellPrice'};
      }
      const fiado = v.completo === 'no';
      const paid = fiado ? Math.min(num(v.sellPaid), sp) : sp;
      const cliente = clean(v.cliente);
      if(fiado && paid < sp && !cliente) return {err: '¿Quién te quedó debiendo?', k: 'cliente'};
      const pocket = v.sellPocket || defPocket();
      const rec = put('items', Object.assign({}, it, {status: 'sold', sellPrice: sp, sellPaid: paid, sellPocket: pocket, sellDate: v.sellDate || today(), sellNotes: clean(v.sellNotes)}));
      let extra = '';
      if(paid < sp){
        put('cobros', {nombre: titleCase(cliente), tel: clean(v.tel), total: sp - paid, pagado: 0, bolsillo: '', fecha: v.sellDate || today(),
          compromiso: v.compromiso || '', notas: 'Venta: ' + it.desc, itemId: rec.id});
        extra = ` · ${titleCase(cliente)} te debe ${full(sp - paid)}`;
      }
      const g = sp - (+it.buyPrice || 0);
      return {rec, msg: `💰 ¡Vendido! Ganancia ${full(g)}${extra}`};
    }
  },

  editItem: {
    title: '✏️ Editar producto',
    fields: d => {
      const f = [
        {k: 'desc', label: 'Producto', type: 'text', req: 1},
        {k: 'cat', label: 'Categoría', type: 'select', opts: CATS.map(c => [c, c])},
        {k: 'cond', label: 'Estado', type: 'seg', opts: [['nuevo', 'Nuevo'], ['bueno', 'Bueno'], ['regular', 'Regular']]},
        {k: 'buyPrice', label: 'Costo', type: 'money', req: 1},
        {k: 'buyPocket', label: '¿De dónde salió la plata?', type: 'seg', opts: pocketOpts().concat([POCKET_NONE])},
        {k: 'buyDate', label: 'Fecha de compra', type: 'date'}
      ];
      if(d.status === 'sold') f.push(
        {k: 'sellPrice', label: 'Precio de venta', type: 'money', req: 1},
        {k: 'sellPocket', label: '¿A dónde entró la plata?', type: 'seg', opts: pocketOpts()},
        {k: 'sellDate', label: 'Fecha de venta', type: 'date'});
      else f.push({k: 'targetPrice', label: 'Precio meta (opcional)', type: 'money'});
      f.push({k: 'notes', label: 'Notas', type: 'text'});
      return f;
    },
    extra: d => d.status === 'sold' ? '<button type="button" class="btn b-y" data-a="formUnsell" data-testid="form-unsell">↩️ A stock</button>' : '',
    save: (v, d) => {
      const desc = clean(v.desc), bp = num(v.buyPrice);
      if(!desc) return {err: 'Escribe el nombre del producto', k: 'desc'};
      if(bp <= 0) return {err: 'El costo debe ser mayor a 0', k: 'buyPrice'};
      const it = Object.assign({}, get('items', d.id) || d, {desc, cat: v.cat, cond: v.cond, notes: clean(v.notes), buyPrice: bp, buyPocket: v.buyPocket || '', buyDate: v.buyDate || today()});
      if(it.status === 'sold'){
        const sp = num(v.sellPrice);
        if(sp <= 0) return {err: 'El precio de venta debe ser mayor a 0', k: 'sellPrice'};
        const wasFull = it.sellPaid == null || it.sellPaid === '' || +it.sellPaid >= +it.sellPrice;
        it.sellPaid = wasFull ? sp : Math.min(+it.sellPaid, sp);
        it.sellPrice = sp; it.sellPocket = v.sellPocket || it.sellPocket; it.sellDate = v.sellDate || it.sellDate;
        const c = L(DB, 'cobros').find(x => x.itemId === it.id);
        if(c && !wasFull) put('cobros', Object.assign({}, c, {total: sp - it.sellPaid}));
      } else it.targetPrice = num(v.targetPrice) || null;
      put('items', it);
      return {rec: it, msg: '✓ ' + desc + ' actualizado'};
    },
    del: (v, d) => {
      const it = get('items', d.id);
      if(!it) return null;
      const cs = L(DB, 'cobros').filter(c => c.itemId === it.id);
      if(!confirm(`¿Eliminar “${it.desc}”?` + (cs.length ? '\nTambién se borra el cobro de esa venta.' : '') + '\nSe borra la compra' + (it.status === 'sold' ? ' y la venta.' : '.'))) return null;
      remove('items', it.id);
      const gone = cs.map(c => removeCobro(c.id));
      return {msg: '🗑️ ' + it.desc + ' eliminado', undo: () => { restore('items', it); gone.forEach(x => x && (restore('cobros', x.c), x.abs.forEach(a => restore('abonos', a)))); commit('Recuperado ✓'); }};
    }
  },

  gasto: {
    title: d => d._pend ? '💸 Gasto ' + (d.tipo === 'negocio' ? 'del negocio' : 'personal') : '💸 Gasto',
    prep: d => {
      if(!d.fecha) d.fecha = today();
      if(d.bolsillo === undefined) d.bolsillo = defPocket();
      if(!d.cat) d.cat = d.desc ? guessGCat(d.desc) : 'Otro';
      if(!d.tipo) d.tipo = NEG_CATS.includes(d.cat) ? 'negocio' : 'personal';
    },
    fields: () => [
      {k: 'desc', label: '¿En qué?', type: 'text', ph: 'Ej: Envío Servientrega'},
      {k: 'valor', label: 'Valor', type: 'money', req: 1, ph: 'Ej: 12k o 12.000'},
      {k: 'cat', label: 'Categoría', type: 'select', opts: GCATS.map(c => [c, c])},
      {k: 'tipo', label: 'Tipo', type: 'seg', opts: [['negocio', '🏢 Negocio'], ['personal', '👤 Personal']]},
      {k: 'bolsillo', label: '¿De dónde salió?', type: 'seg', opts: pocketOpts()},
      {k: 'fecha', label: 'Fecha', type: 'date'}
    ],
    change: (k, v, set, F) => {
      if(k === 'desc' && !F.touched.cat){ const c = guessGCat(v.desc); set('cat', c); if(!F.touched.tipo && !F.d._pend) set('tipo', NEG_CATS.includes(c) ? 'negocio' : 'personal'); }
      if(k === 'cat' && !F.touched.tipo) set('tipo', NEG_CATS.includes(v.cat) ? 'negocio' : 'personal');
    },
    save: v => {
      const valor = num(v.valor);
      if(valor <= 0) return {err: '¿Cuánto fue el gasto?', k: 'valor'};
      if(!v.bolsillo) return {err: '¿De qué bolsillo salió?', k: 'bolsillo'};
      const desc = clean(v.desc) || v.cat || 'Gasto';
      const rec = put('gastos', {desc, valor, cat: v.cat || 'Otro', tipo: v.tipo === 'negocio' ? 'negocio' : 'personal', bolsillo: v.bolsillo, fecha: v.fecha || today()});
      return {rec, msg: `💸 ${desc} · ${full(valor)} (${rec.tipo})`};
    }
  },

  ingreso: {
    title: '➕ Ingreso',
    prep: d => { if(!d.fecha) d.fecha = today(); if(d.bolsillo === undefined) d.bolsillo = defPocket(); },
    intro: () => '<p class="hint" style="margin-bottom:10px">Plata que entra y <b>no</b> es una venta: sueldo, regalos, intereses…</p>',
    fields: () => [
      {k: 'desc', label: '¿De qué?', type: 'text', ph: 'Ej: Sueldo, regalo, arriendo'},
      {k: 'valor', label: 'Valor', type: 'money', req: 1},
      {k: 'bolsillo', label: '¿A dónde entró?', type: 'seg', opts: pocketOpts()},
      {k: 'fecha', label: 'Fecha', type: 'date'}
    ],
    save: v => {
      const valor = num(v.valor);
      if(valor <= 0) return {err: '¿Cuánto te entró?', k: 'valor'};
      if(!v.bolsillo) return {err: '¿A qué bolsillo entró?', k: 'bolsillo'};
      const desc = clean(v.desc) || 'Ingreso';
      const rec = put('ingresos', {desc, valor, bolsillo: v.bolsillo, fecha: v.fecha || today()});
      return {rec, msg: `➕ ${desc} · ${full(valor)}`};
    }
  },

  cobro: {
    title: d => d.id ? '✏️ Editar cobro' : '🤝 Me deben',
    prep: d => { if(!d.fecha) d.fecha = today(); if(d.bolsillo === undefined) d.bolsillo = ''; if(d.pagado === undefined) d.pagado = ''; if(!d.compromiso) d.compromiso = ''; },
    fields: () => [
      {k: 'nombre', label: '¿Quién te debe?', type: 'text', ph: 'Ej: Juan Pérez', req: 1},
      {k: 'tel', label: 'Celular (para WhatsApp, opcional)', type: 'tel'},
      {k: 'total', label: '¿Cuánto en total?', type: 'money', req: 1},
      {k: 'pagado', label: '¿Ya te abonó algo? (opcional)', type: 'money', ph: '0'},
      {k: 'bolsillo', label: '¿Le prestaste plata? ¿De dónde salió?', type: 'seg', opts: [['', 'No salió plata (fiado)']].concat(pocketOpts()),
        note: 'Si le prestaste, se descuenta de ese bolsillo.'},
      {k: 'compromiso', label: '¿Cuándo te paga? (opcional)', type: 'date'},
      {k: 'notas', label: 'Nota (opcional)', type: 'text', ph: 'Ej: por los audífonos'}
    ],
    save: (v, d) => {
      const nombre = titleCase(clean(v.nombre)), total = num(v.total), pagado = num(v.pagado);
      if(!nombre) return {err: '¿Quién te debe?', k: 'nombre'};
      if(total <= 0) return {err: '¿Cuánto te debe?', k: 'total'};
      if(pagado > total) return {err: 'Lo abonado no puede ser mayor que el total', k: 'pagado'};
      const base = d.id ? (get('cobros', d.id) || {}) : {};
      const rec = put('cobros', Object.assign({}, base, {id: d.id, nombre, tel: clean(v.tel), total, pagado, bolsillo: v.bolsillo || '', fecha: d.fecha || today(),
        compromiso: v.compromiso || '', notas: clean(v.notas)}));
      return {rec, msg: d.id ? '✓ Cobro actualizado' : `🤝 ${nombre} te debe ${full(total - pagado)}`};
    },
    del: (v, d) => {
      if(!confirm('¿Eliminar el cobro de ' + d.nombre + '? También se borran sus abonos.')) return null;
      const x = removeCobro(d.id);
      return {msg: '🗑️ Cobro eliminado', undo: undoCobro(x)};
    }
  },

  abono: {
    title: '💵 Abono',
    prep: d => { if(!d.fecha) d.fecha = today(); if(d.bolsillo === undefined) d.bolsillo = defPocket(); if(d.cobroId === undefined) d.cobroId = ''; },
    intro: d => (d._nombre ? `<p class="hint" style="margin-bottom:10px">No encontré un cobro de <b>${esc(d._nombre)}</b>. Elígelo de la lista o créalo con “Me deben”.</p>` : '') +
      (cobrosPend(DB).length ? '' : '<p class="hint" style="margin-bottom:10px">No tienes cobros pendientes. Primero crea uno con <b>🤝 Me deben</b>.</p>'),
    fields: () => [
      {k: 'cobroId', label: '¿Quién te abonó?', type: 'select', req: 1, opts: [['', '— Elige —']].concat(cobrosPend(DB).map(c => [c.id, c.nombre + ' · debe ' + full(c.pend)]))},
      {k: 'monto', label: '¿Cuánto?', type: 'money', req: 1},
      {k: 'bolsillo', label: '¿A dónde entró?', type: 'seg', opts: pocketOpts()},
      {k: 'fecha', label: 'Fecha', type: 'date'}
    ],
    save: v => {
      const c = cobrosPend(DB).find(x => x.id === v.cobroId);
      if(!c) return {err: '¿Quién te abonó? Elige el cobro', k: 'cobroId'};
      const monto = num(v.monto);
      if(monto <= 0) return {err: '¿Cuánto te abonó?', k: 'monto'};
      if(monto > c.pend) return {err: `${c.nombre} solo te debe ${full(c.pend)}`, k: 'monto'};
      if(!v.bolsillo) return {err: '¿A qué bolsillo entró?', k: 'bolsillo'};
      const rec = put('abonos', {cobroId: c.id, monto, bolsillo: v.bolsillo, fecha: v.fecha || today()});
      const rest = c.pend - monto;
      return {rec, msg: rest <= 0 ? `🎉 ¡Saldado! ${c.nombre} ya no te debe nada` : `💵 Abono de ${full(monto)} · ${c.nombre} debe ${full(rest)}`};
    }
  },

  transfer: {
    title: '🔁 Mover plata',
    prep: d => {
      if(!d.fecha) d.fecha = today();
      if(!d.from) d.from = d.to ? otherPocket(d.to) : defPocket();
      if(!d.to) d.to = otherPocket(d.from);
    },
    intro: () => '<p class="hint" style="margin-bottom:10px">Retiros de Nequi a efectivo, consignaciones, etc. No cambia tu caja total.</p>',
    fields: () => [
      {k: 'from', label: 'Desde', type: 'seg', opts: pocketOpts()},
      {k: 'to', label: 'Hacia', type: 'seg', opts: pocketOpts()},
      {k: 'monto', label: '¿Cuánto?', type: 'money', req: 1},
      {k: 'fecha', label: 'Fecha', type: 'date'}
    ],
    change: (k, v, set) => { if(k === 'from' && v.from === v.to) set('to', otherPocket(v.from)); if(k === 'to' && v.from === v.to) set('from', otherPocket(v.to)); },
    save: v => {
      const monto = num(v.monto);
      if(!v.from || !v.to) return {err: 'Elige los dos bolsillos'};
      if(v.from === v.to) return {err: 'Elige bolsillos distintos', k: 'to'};
      if(monto <= 0) return {err: '¿Cuánto moviste?', k: 'monto'};
      const rec = put('transfers', {from: v.from, to: v.to, monto, fecha: v.fecha || today()});
      return {rec, msg: `🔁 ${pn(v.from)} → ${pn(v.to)} · ${full(monto)}`};
    }
  },

  ajuste: {
    title: d => '⚖️ Ajustar ' + pn(d.bolsillo),
    intro: d => `<p class="hint" style="margin-bottom:10px">Según lo que registraste, en <b>${esc(pn(d.bolsillo))}</b> tienes <b class="mono">${full(balances(DB)[d.bolsillo] || 0)}</b>.
      Escribe lo que de verdad tienes hoy y lo cuadramos.</p>`,
    fields: d => [{k: 'real', label: 'Saldo real hoy en ' + pn(d.bolsillo), type: 'money', req: 1, ph: 'Ej: 1.250.000'}],
    saveLabel: 'Cuadrar',
    save: (v, d) => {
      if(v.real === '' || v.real == null) return {err: 'Escribe el saldo real', k: 'real'};
      const delta = num(v.real) - (balances(DB)[d.bolsillo] || 0);
      if(!delta) return {msg: '✓ ' + pn(d.bolsillo) + ' ya cuadra'};
      const rec = put('ajustes', {bolsillo: d.bolsillo, delta, fecha: today(), nota: 'Cuadre ' + pn(d.bolsillo)});
      return {rec, msg: `⚖️ ${pn(d.bolsillo)} ajustado: ${delta > 0 ? '+' : '−'}${full(Math.abs(delta))}`};
    }
  },

  bolsillo: {
    title: '👛 Nuevo bolsillo',
    fields: () => [
      {k: 'nombre', label: 'Nombre', type: 'text', ph: 'Ej: Bancolombia, Daviplata, Ahorros', req: 1},
      {k: 'ini', label: '¿Cuánto tiene hoy?', type: 'money', ph: '0'}
    ],
    save: v => {
      const nombre = clean(v.nombre);
      if(!nombre) return {err: 'Ponle un nombre', k: 'nombre'};
      if(pockets().some(p => normKey(p.nombre) === normKey(nombre))) return {err: 'Ya tienes un bolsillo con ese nombre', k: 'nombre'};
      let id = normKey(nombre).replace(/ /g, '-') || uid();
      if((DB.bolsillos || []).some(p => p.id === id) || !/^[a-z0-9-]+$/.test(id)) id = 'b' + uid();
      const rec = put('bolsillos', {id, nombre, ini: num(v.ini)});
      return {rec, msg: '👛 ' + nombre + ' creado'};
    }
  },

  renombrar: {
    title: '✏️ Renombrar bolsillo',
    prep: d => { const p = get('bolsillos', d.id); d.nombre = p ? p.nombre : ''; },
    fields: () => [{k: 'nombre', label: 'Nombre', type: 'text', req: 1}],
    save: (v, d) => {
      const nombre = clean(v.nombre), p = get('bolsillos', d.id);
      if(!nombre) return {err: 'Ponle un nombre', k: 'nombre'};
      if(!p) return {err: 'Ese bolsillo ya no existe'};
      if(pockets().some(x => x.id !== p.id && normKey(x.nombre) === normKey(nombre))) return {err: 'Ya tienes un bolsillo con ese nombre', k: 'nombre'};
      put('bolsillos', Object.assign({}, p, {nombre}));
      return {msg: '✓ Ahora se llama ' + nombre};
    }
  },

  tel: {
    title: d => '💬 Celular de ' + d.nombre,
    fields: () => [{k: 'tel', label: 'Celular', type: 'tel', req: 1, ph: '300 123 4567'}],
    saveLabel: 'Guardar y abrir WhatsApp',
    save: (v, d) => {
      const t = waNumber(v.tel);
      if(!t) return {err: 'Escribe un celular de 10 dígitos (empieza por 3)', k: 'tel'};
      const c = get('cobros', d.cobroId);
      if(!c) return {err: 'Ese cobro ya no existe'};
      put('cobros', Object.assign({}, c, {tel: clean(v.tel)}));
      return {msg: '✓ Celular guardado', after: () => openWA(d.cobroId)};
    }
  }
};

/* ── WhatsApp ── */
function waNumber(tel){
  const d = String(tel || '').replace(/\D/g, '');
  if(d.length === 10 && d[0] === '3') return '57' + d;
  if(d.length === 12 && d.startsWith('573')) return d;
  if(d.length >= 11 && d.length <= 15 && !d.startsWith('0')) return d;   // número internacional
  return '';
}
function openWA(id){
  const c = cobrosPend(DB).find(x => x.id === id) || (() => { const x = get('cobros', id); return x ? Object.assign({}, x, {pend: Math.max(0, x.total - cobroPagado(DB, x))}) : null; })();
  if(!c) return;
  const n = waNumber(c.tel);
  if(!n){ openForm('tel', {cobroId: c.id, nombre: c.nombre, tel: c.tel || ''}); return; }
  const msg = `Hola ${c.nombre}, ¿cómo vas? Te escribo por el saldo pendiente de ${full(c.pend)}${c.notas ? ' (' + c.notas + ')' : ''}. ¿Cuándo me podrías abonar? 🙏`;
  window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
}

/* ── Por clasificar ── */
function classify(id, k){
  const p = get('pend', id);
  if(!p) return;
  const f = p.fecha || today(), b = p.bolsillo || defPocket(), m = +p.monto || 0, q = titleCase(p.quien || ''), base = {_pend: p.id};
  const M = {
    compra: () => openForm('compra', Object.assign(base, {buyPrice: m, buyPocket: b, buyDate: f})),
    gastoN: () => openForm('gasto', Object.assign(base, {valor: m, bolsillo: b, fecha: f, tipo: 'negocio', desc: q, cat: q ? guessGCat(q) : 'Otro'})),
    gastoP: () => openForm('gasto', Object.assign(base, {valor: m, bolsillo: b, fecha: f, tipo: 'personal', desc: q, cat: q ? guessGCat(q) : 'Otro'})),
    transferOut: () => openForm('transfer', Object.assign(base, {from: b, to: otherPocket(b), monto: m, fecha: f})),
    prestamo: () => openForm('cobro', Object.assign(base, {nombre: q, total: m, pagado: 0, bolsillo: b, fecha: f})),
    venta: () => openForm('venta', Object.assign(base, {sellPrice: m, sellPocket: b, sellDate: f})),
    abono: () => { const c = q ? bestMatch(q, cobrosPend(DB), x => x.nombre) : null; openForm('abono', Object.assign(base, {cobroId: c ? c.id : '', monto: m, bolsillo: b, fecha: f})); },
    ingreso: () => openForm('ingreso', Object.assign(base, {desc: q, valor: m, bolsillo: b, fecha: f})),
    transferIn: () => openForm('transfer', Object.assign(base, {from: otherPocket(b), to: b, monto: m, fecha: f}))
  };
  if(M[k]) M[k]();
}

function applyRule(id){
  const p = get('pend', id), r = p && ruleFor(p);
  if(!r) return;
  const f = p.fecha || today(), b = p.bolsillo || defPocket(), m = +p.monto || 0;
  let col, rec;
  if(r.kind === 'gasto'){ col = 'gastos'; rec = put(col, {desc: r.desc || titleCase(p.quien), valor: m, cat: r.cat || 'Otro', tipo: r.tipo === 'negocio' ? 'negocio' : 'personal', bolsillo: b, fecha: f}); }
  else if(r.kind === 'ingreso'){ col = 'ingresos'; rec = put(col, {desc: r.desc || titleCase(p.quien), valor: m, bolsillo: b, fecha: f}); }
  else {
    let from = r.from, to = r.to;
    if(p.dir === 'in'){ to = b; if(!from || from === b) from = otherPocket(b); }
    else { from = b; if(!to || to === b) to = otherPocket(b); }
    col = 'transfers'; rec = put(col, {from, to, monto: m, fecha: f});
  }
  remove('pend', p.id);
  commit('✓ ' + ruleLabel(r) + ' · ' + full(m), {undo: () => { remove(col, rec.id); restore('pend', p); commit('Deshecho'); }});
}

function ignorePend(id){
  const p = get('pend', id);
  if(!p) return;
  remove('pend', id);
  commit('Ignorado', {undo: () => { restore('pend', p); commit('Recuperado ✓'); }});
}

/* ── Acciones de la lista de movimientos y botones ── */
function tapMov(col, id){
  if(col === 'items'){ const it = get('items', id); if(it) openForm('editItem', it); return; }
  const r = get(col, id);
  if(!r) return;
  const row = movs().find(x => x.col === col && x.id === id);
  const label = row ? row.t + ' · ' + full(row.m != null ? Math.abs(row.m) : row.amt) + ' · ' + fd(row.fecha) : '';
  if(col === 'cobros'){
    if(!confirm('¿Eliminar este préstamo?\n' + label + '\nTambién se borran sus abonos.')) return;
    const x = removeCobro(id);
    commit('🗑️ Eliminado', {undo: undoCobro(x)});
    return;
  }
  if(!confirm('¿Eliminar este movimiento?\n' + label)) return;
  remove(col, id);
  commit('🗑️ Eliminado', {undo: () => { restore(col, r); commit('Recuperado ✓'); }});
}

function unsellFromForm(){
  if(!F || F.kind !== 'editItem') return;
  const it = get('items', F.d.id);
  if(!it) return;
  const cs = L(DB, 'cobros').filter(c => c.itemId === it.id);
  if(!confirm(`¿Devolver “${it.desc}” al stock? Se borra la venta` + (cs.length ? ' y su cobro.' : '.'))) return;
  const back = Object.assign({}, it, {status: 'stock'});
  ['sellPrice', 'sellPaid', 'sellPocket', 'sellDate', 'sellNotes'].forEach(k => delete back[k]);
  put('items', back);
  const gone = cs.map(c => removeCobro(c.id));
  closeForm();
  commit('↩️ ' + it.desc + ' volvió al stock', {undo: () => { put('items', it); gone.forEach(x => x && (restore('cobros', x.c), x.abs.forEach(a => restore('abonos', a)))); commit('Deshecho'); }});
}

function delBolsillo(id){
  const p = get('bolsillos', id);
  if(!p) return;
  if(pocketUsed(id)) return toast('No se puede: ' + p.nombre + ' tiene movimientos', {err: true});
  if(pockets().length <= 1) return toast('Necesitas al menos un bolsillo', {err: true});
  if(!confirm('¿Eliminar el bolsillo ' + p.nombre + '?')) return;
  remove('bolsillos', id);
  commit('🗑️ ' + p.nombre + ' eliminado', {undo: () => { restore('bolsillos', p); commit('Recuperado ✓'); }});
}

const ACT = {
  form: el => openForm(el.dataset.k, {}),
  ex: el => { const q = $('#qInput'); q.value = el.dataset.t; q.focus(); toast('Cámbialo a tu gusto y toca ➤'); },
  goAjustes: () => { UI.masSeg = 'ajustes'; setView('mas'); },
  goStock: () => { UI.stSeg = 'stock'; setView('stock'); },
  goCobros: () => setView('cobros'),
  goMovs: () => setView('movs'),
  pend: el => classify(el.dataset.id, el.dataset.k),
  pendRule: el => applyRule(el.dataset.id),
  pendIgnore: el => ignorePend(el.dataset.id),
  pendMore: el => { UI.pendOpen[el.dataset.id] = true; renderInicio(); },
  pendAll: () => { UI.pendAll = !UI.pendAll; renderInicio(); },
  wa: el => openWA(el.dataset.id),
  abonar: el => openForm('abono', {cobroId: el.dataset.id}),
  ajustar: el => openForm('ajuste', {bolsillo: el.dataset.id}),
  nuevoBolsillo: () => openForm('bolsillo', {}),
  renombrar: el => openForm('renombrar', {id: el.dataset.id}),
  delBolsillo: el => delBolsillo(el.dataset.id),
  vender: el => openForm('venta', {itemId: el.dataset.id}),
  editItem: el => { const it = get('items', el.dataset.id); if(it) openForm('editItem', it); },
  editCobro: el => { const c = get('cobros', el.dataset.id); if(c) openForm('cobro', c); },
  delCobro: el => { const c = get('cobros', el.dataset.id); if(!c || !confirm('¿Eliminar el cobro de ' + c.nombre + '? También se borran sus abonos.')) return; commit('🗑️ Cobro eliminado', {undo: undoCobro(removeCobro(c.id))}); },
  mov: el => tapMov(el.dataset.col, el.dataset.id),
  voz: () => startVoice(),
  formClose: () => closeForm(),
  formDel: () => deleteFromForm(),
  formUnsell: () => unsellFromForm(),
  copy: el => copyText(el.dataset.t, el.dataset.n)
};

/* ═════════ 4. REGISTRO RÁPIDO Y VOZ ═════════ */
const quickCtx = () => ({
  bolsillos: pockets().map(p => ({id: p.id, nombre: p.nombre})),
  stock: stockItems().map(i => ({id: i.id, desc: i.desc})),
  cobros: cobrosPend(DB).map(c => ({id: c.id, nombre: c.nombre}))
});

function runQuick(text){
  text = clean(text);
  const q = $('#qInput');
  if(!text){ toast('Escribe algo como “almuerzo 18 mil”'); if(q) q.focus(); return; }
  let r = null;
  try { r = parseQuick(text, quickCtx()); } catch(e){ console.error(e); }
  if(!r || !FORMS[r.kind]) r = {kind: 'gasto', d: {}};
  if(q) q.blur();
  openForm(r.kind, Object.assign({}, r.d), {fromQuick: true});
}

let REC = null;
function startVoice(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const q = $('#qInput'), mic = $('#qMic');
  const gboard = () => { toast('Usa el micrófono del teclado (Gboard) 🎤', {ms: 4500}); if(q) q.focus(); };
  if(UI.view !== 'inicio') setView('inicio');
  if(REC){ try { REC.stop(); } catch(e){} return; }
  if(!SR || navigator.onLine === false) return gboard();     // §10.5: el dictado necesita internet
  let rec;
  try { rec = new SR(); } catch(e){ return gboard(); }
  REC = rec;
  rec.lang = 'es-CO'; rec.interimResults = false; rec.maxAlternatives = 1; rec.continuous = false;
  rec.onstart = () => { mic.classList.add('rec'); q.placeholder = 'Te escucho… ej: “almuerzo 18 mil”'; };
  rec.onresult = e => {
    const res = e && e.results && e.results[e.resultIndex || 0];
    const t = res && res[0] && res[0].transcript;
    if(t){ q.value = t; runQuick(t); }
  };
  rec.onerror = e => {
    const er = e && e.error;
    if(er === 'no-speech') toast('No te escuché. Toca 🎤 e intenta otra vez');
    else if(er !== 'aborted') gboard();
  };
  rec.onend = () => { if(REC === rec) REC = null; mic.classList.remove('rec'); q.placeholder = 'Ej: compré ps5 1.2M nequi'; };
  try { rec.start(); } catch(e){ REC = null; mic.classList.remove('rec'); gboard(); }
}

/* ═════════ 5. AJUSTES, RESPALDO Y BIENVENIDA ═════════ */
function renderAjustes(){
  const u = $('#cfgUrl'), k = $('#cfgKey');
  if(document.activeElement !== u) u.value = CFG.url || '';
  if(document.activeElement !== k) k.value = CFG.key || '';
  setSync(UI.sync, UI.syncMsg);
  renderCfgInfo();
  let h = '';
  if(hasCloud()){
    let links = [];
    try {
      links = [
        ['Macro A · Nequi → App (POST)', cloudURL({action: 'capture', key: CFG.key, bolsillo: 'nequi'})],
        ['Macro B · Resumen semanal (GET)', cloudURL({action: 'summary', key: CFG.key})],
        ['Macro C · Recordatorios (GET)', cloudURL({action: 'reminders', key: CFG.key})]
      ];
    } catch(e){ links = []; }
    h = links.map(([l, url]) => `<div class="fld"><label>${esc(l)}</label><div class="copy">
      <input class="in" readonly value="${esc(url)}" aria-label="${esc(l)}">
      <button type="button" class="btn b-gh" data-a="copy" data-t="${esc(url)}" data-n="${esc(l)}">Copiar</button></div></div>`).join('') +
      '<p class="hint" style="margin-bottom:12px">Pégalo en el campo URL de la acción “Solicitud HTTP” de MacroDroid (la guía tiene el paso a paso).</p>';
  } else h = '<p class="hint" style="margin-bottom:12px">Primero conecta tu nube arriba; aquí aparecerán los enlaces listos para copiar.</p>';
  $('#mdLinks').innerHTML = h;
  $('#cfgTest').disabled = !hasCloud();
  $('#cfgSync').disabled = !hasCloud();
  $('#appVer').textContent = APP_VERSION;
  $('#appCount').textContent = String(COLS.reduce((a, c) => a + L(DB, c).length, 0));
}

function renderCfgInfo(){
  const el = $('#cfgInfo');
  if(!el) return;
  el.innerHTML = hasCloud()
    ? `Última sincronización: <b>${esc(horaTxt(CFG.last))}</b>${UI.sync === 'err' && UI.syncMsg ? `<br><span class="neg">${esc(UI.syncMsg)}</span>` : ''}`
    : 'Pega la URL y la clave que te dio el Apps Script. Tus datos quedan en <b>tu</b> Google Sheet y se respaldan solos.';
}

function copyText(t, what){
  const done = () => toast('📋 Copiado' + (what ? ': ' + what.split('·')[0].trim() : ''));
  const fallback = () => {
    try {
      const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand('copy'); ta.remove(); done();
    } catch(e){ toast('No pude copiar: mantén presionado el enlace y cópialo', {err: true}); }
  };
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback);
  else fallback();
}

async function saveCloud(){
  const url = clean($('#cfgUrl').value), key = clean($('#cfgKey').value);
  if(!url && !key){
    CFG.url = ''; CFG.key = ''; saveCfg(); setSync('off'); render();
    return toast('Nube desconectada. Tus datos siguen en este celular.');
  }
  if(!/^https:\/\/\S+$/i.test(url)) return toast('La URL debe empezar por https://', {err: true});
  try { new URL(url); } catch(e){ return toast('Esa URL no es válida', {err: true}); }
  if(/\/dev\/?(\?|$)/.test(url)) return toast('Esa es la URL de prueba (/dev). Usa la que termina en /exec', {err: true});
  if(!key) return toast('Falta la clave', {err: true});
  CFG.url = url; CFG.key = key; saveCfg();
  const b = $('#cfgSave'); b.disabled = true; b.textContent = 'Probando…';
  setSync('busy');
  try {
    await cloudFetch(cloudURL({action: 'ping', key}), {method: 'GET'});
    toast('✅ ¡Conectado! Trayendo tus datos…');
    const ok = await sync();
    if(ok) toast('✅ Nube conectada y al día');
    else toast('Conectó, pero la sincronización falló: ' + UI.syncMsg, {err: true});
  } catch(e){
    setSync(navigator.onLine === false ? 'nosig' : 'err', e.message);
    toast(e.message === 'Clave incorrecta' ? 'Clave incorrecta. Cópiala otra vez del registro del Apps Script.' : e.message, {err: true});
  } finally {
    b.disabled = false; b.textContent = 'Guardar y probar';
    render();
  }
}

async function testCapture(){
  if(!hasCloud()) return toast('Primero conecta tu nube', {err: true});
  const b = $('#cfgTest'); b.disabled = true; b.textContent = 'Probando…';
  try {
    const j = await cloudFetch(cloudURL({action: 'capture', key: CFG.key, bolsillo: 'nequi'}), {method: 'POST', body: 'Enviaste $1.000 a PRUEBA'});
    await sync();
    const found = L(DB, 'pend').some(p => /prueba/i.test(p.raw || '') || /prueba/i.test(p.quien || ''));
    if(found){ toast('✅ ¡Funciona! Mira “Por clasificar” en Inicio (tócale Ignorar)', {ms: 5000}); setView('inicio'); }
    else if(j.added === false) toast('La nube respondió, pero no lo agregó (¿lo probaste hace menos de 10 min?)', {err: true});
    else toast('Se envió, pero no llegó todavía. Toca ↻ Sincronizar en un momento.', {err: true});
  } catch(e){ toast(e.message, {err: true}); }
  finally { b.disabled = !hasCloud(); b.textContent = '🧪 Probar captura'; }
}

function exportJSON(){
  const name = 'miapp_' + today().replace(/-/g, '') + '.json';
  try {
    const blob = new Blob([JSON.stringify(DB)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch(e){} }, 10000);
    toast('⬇️ Descargado ' + name);
  } catch(e){ toast('No pude exportar: ' + e.message, {err: true}); }
}

function importFile(file){
  if(!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    let j;
    try { j = JSON.parse(String(fr.result)); } catch(e){ return toast('Ese archivo no es un respaldo válido', {err: true}); }
    if(j && j.db && typeof j.db === 'object' && !Array.isArray(j.items)) j = j.db;
    if(!j || typeof j !== 'object' || !COLS.some(c => Array.isArray(j[c]))) return toast('Ese archivo no es un respaldo de Mi App', {err: true});
    const n = COLS.reduce((a, c) => a + (Array.isArray(j[c]) ? j[c].length : 0), 0);
    DB = mergeDB(DB, j);          // une, no reemplaza: por id gana el más reciente
    UI.rev++;
    if(!CFG.onboarded){ CFG.onboarded = true; saveCfg(); }
    commit('⬆️ Importado: ' + plural(n, 'registro') + ' unidos');
  };
  fr.onerror = () => toast('No pude leer el archivo', {err: true});
  fr.readAsText(file);
}

/* Bienvenida (§10.3): nunca pisa la nube */
function afterSync(){
  if(!CFG.onboarded && hasData()){
    CFG.onboarded = true; saveCfg();
    if(UI.onb) showOnb('');
  }
}

function typingMoney(s){
  if(/^[\d.]+$/.test(s) && !s.endsWith('.') && s.split('.').slice(1).every(g => g.length >= 3)){
    const n = s.replace(/\./g, '').replace(/^0+(?=\d)/, '');
    return n ? miles(n) : '';
  }
  return s;
}

function showOnb(step){
  UI.onb = step || '';
  const el = $('#onb');
  if(!step){ el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  if(step === 'ask') el.innerHTML = `<div class="onb-in"><div class="logo">$</div><h1>¡Hola! 👋</h1>
    <p>¿Primera vez o ya usas Mi App en otro celular?</p>
    <button type="button" class="btn b-g" data-a="onbFirst" data-testid="onb-first">✨ Es mi primera vez</button>
    <button type="button" class="btn b-gh" data-a="onbOther" data-testid="onb-other">📱 Ya la uso en otro celular</button>
    <p class="hint" style="margin-top:12px">Si ya la usas, conectamos tu nube y traemos tus datos. No te pedimos saldos.</p></div>`;
  else if(step === 'saldos') el.innerHTML = `<form class="onb-in" id="onbForm" autocomplete="off" novalidate><div class="logo">$</div>
    <h1>¿Cuánto tienes hoy?</h1><p>Así tus saldos arrancan cuadrados. Lo puedes ajustar después.</p>
    <div class="fld"><label for="onbEfe">💵 Efectivo</label><input class="in money" id="onbEfe" data-testid="onb-efectivo" type="text" inputmode="decimal" placeholder="$ 0"></div>
    <div class="fld"><label for="onbNeq">📱 Nequi</label><input class="in money" id="onbNeq" data-testid="onb-nequi" type="text" inputmode="decimal" placeholder="$ 0"></div>
    <button type="submit" class="btn b-g" data-testid="onb-save">Empezar</button>
    <button type="button" class="btn b-gh" data-a="onbBack">← Volver</button></form>`;
  else if(step === 'wait') el.innerHTML = `<div class="onb-in"><div class="logo">$</div><h1>Buscando tus datos…</h1><p>Conectando con tu nube ☁️</p></div>`;
}

function onbSave(){
  const efe = parseMoney($('#onbEfe').value), neq = parseMoney($('#onbNeq').value);
  [['efectivo', efe, 'Efectivo'], ['nequi', neq, 'Nequi']].forEach(([id, v, nombre]) => {
    if(!v) return;
    const p = (DB.bolsillos || []).find(b => b.id === id) || {id, nombre};
    put('bolsillos', Object.assign({}, p, {ini: v, del: undefined}));
  });
  CFG.onboarded = true; saveCfg();
  showOnb('');
  setView('inicio');
  commit('¡Listo! Registra tu primer movimiento arriba 👆', {ms: 4000});
}

Object.assign(ACT, {
  onbFirst: () => {
    if(hasData()){ CFG.onboarded = true; saveCfg(); showOnb(''); return; }
    showOnb('saldos'); const e = $('#onbEfe'); if(e) e.focus();
  },
  onbBack: () => showOnb('ask'),
  onbOther: () => {
    CFG.onboarded = true; saveCfg();
    showOnb('');
    UI.masSeg = 'ajustes'; setView('mas');
    const u = $('#cfgUrl'); if(u) u.focus();
    toast('Pega la URL y la clave de tu nube (las mismas del otro celular)', {ms: 5000});
  }
});

/* ═════════ 6. ARRANQUE Y EVENTOS ═════════ */
function bindEvents(){
  document.addEventListener('click', e => {
    const el = e.target && e.target.closest ? e.target.closest('[data-a]') : null;
    if(!el || el.disabled) return;
    const fn = ACT[el.dataset.a];
    if(fn){ e.preventDefault(); fn(el); }
  });
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if(b) setView(b.dataset.v); });

  /* registro rápido */
  $('#qForm').addEventListener('submit', e => { e.preventDefault(); runQuick($('#qInput').value); });
  $('#qMic').addEventListener('click', e => { e.preventDefault(); startVoice(); });

  /* controles con estado (markup estático: no pierden el foco al pintar) */
  $('#stSearch').addEventListener('input', e => { UI.stQ = e.target.value; renderStock(); });
  $('#stSeg').addEventListener('click', e => { const b = e.target.closest('button[data-seg]'); if(b){ UI.stSeg = b.dataset.seg; renderStock(); } });
  $('#mvPrev').addEventListener('click', () => { UI.mvMonth = ymAdd(UI.mvMonth, -1); renderMovs(); });
  $('#mvNext').addEventListener('click', () => { if(UI.mvMonth < today().slice(0, 7)){ UI.mvMonth = ymAdd(UI.mvMonth, 1); renderMovs(); } });
  $('#mvFil').addEventListener('click', e => { const b = e.target.closest('button[data-f]'); if(b){ UI.mvF = b.dataset.f; renderMovs(); } });
  $('#masSeg').addEventListener('click', e => { const b = e.target.closest('button[data-seg]'); if(b){ UI.masSeg = b.dataset.seg; renderMas(); } });
  $('#anPrev').addEventListener('click', () => { UI.anMonth = ymAdd(UI.anMonth, -1); renderAnalisis(); });
  $('#anNext').addEventListener('click', () => { if(UI.anMonth < today().slice(0, 7)){ UI.anMonth = ymAdd(UI.anMonth, 1); renderAnalisis(); } });
  $('#cbNew').addEventListener('click', () => openForm('cobro', {}));
  $('#syncBtn').addEventListener('click', () => { if(!hasCloud()) ACT.goAjustes(); else sync(true); });

  /* ajustes */
  $('#cfgSave').addEventListener('click', () => saveCloud());
  $('#cfgSync').addEventListener('click', () => sync(true));
  $('#cfgTest').addEventListener('click', () => testCapture());
  $('#bkExp').addEventListener('click', exportJSON);
  $('#bkImp').addEventListener('click', () => $('#bkFile').click());
  $('#bkFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; importFile(f); e.target.value = ''; });

  /* hoja de formularios */
  const body = $('#sheetBody');
  const onEdit = e => {
    const el = e.target;
    if(!F || !el || !el.name || !(el.name in F.v)) return;
    if(el.classList.contains('money')) onMoneyInput(el); else F.v[el.name] = el.value;
    onField(el.name);
  };
  body.addEventListener('input', onEdit);
  body.addEventListener('change', onEdit);
  body.addEventListener('click', e => {
    const b = e.target.closest('.opts button[data-v]');
    if(!b || !F) return;
    const k = b.parentElement.dataset.k;
    setVal(k, b.dataset.v);
    onField(k);
  });
  body.addEventListener('focusout', e => {
    const el = e.target;
    if(F && el && el.classList && el.classList.contains('money') && el.value.trim() && F.v[el.name]){ el.value = miles(F.v[el.name]); moneyEq(el.name); }
  });
  body.addEventListener('focusin', e => {
    const el = e.target;
    if(el && el.matches && el.matches('input,select,textarea')) setTimeout(() => { try { el.scrollIntoView({block: 'center', behavior: 'smooth'}); } catch(_){} }, 300);
  });
  $('#sheetForm').addEventListener('submit', e => { e.preventDefault(); saveForm(); });
  $('#sheetX').addEventListener('click', closeForm);
  $('#sheet').addEventListener('click', e => { if(e.target === e.currentTarget) closeForm(); });
  window.addEventListener('popstate', () => { if(F) closeForm(); });
  document.addEventListener('keydown', e => { if(e.key === 'Escape' && F) closeForm(); });

  /* bienvenida */
  const onb = $('#onb');
  onb.addEventListener('submit', e => { e.preventDefault(); onbSave(); });
  onb.addEventListener('input', e => { if(e.target.classList.contains('money')) e.target.value = typingMoney(e.target.value); });

  /* sincronización automática */
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible'){ renderHeader(); sync(); } });
  window.addEventListener('online', () => sync());
  window.addEventListener('offline', () => { if(hasCloud()) setSync('nosig', 'Sin señal'); });
  setInterval(() => { if(document.visibilityState === 'visible') sync(); }, 60000);

  /* Chart.js llega con "defer": si Análisis ya está a la vista, se redibuja */
  window.addEventListener('load', () => { if(UI.view === 'mas' && UI.masSeg === 'analisis') renderAnalisis(); });
}

function registerSW(){
  try {
    if('serviceWorker' in navigator && navigator.serviceWorker && /^https?:$/.test(location.protocol))
      Promise.resolve(navigator.serviceWorker.register('sw.js')).catch(() => {});
  } catch(e){}
}

function init(){
  CFG = Object.assign({url: '', key: '', onboarded: false, last: 0}, loadJSON(K_CFG) || {});
  DB = mergeDB(emptyDB(), loadJSON(K_DB) || {});
  saveDB();
  UI.mvMonth = UI.anMonth = today().slice(0, 7);
  bindEvents();
  setSync(hasCloud() ? (navigator.onLine === false ? 'nosig' : 'ok') : 'off', '');

  let qs;
  try { qs = new URLSearchParams(location.search); } catch(e){ qs = new URLSearchParams(''); }
  const v0 = qs.get('v'), voz = qs.get('voz') === '1';
  if(v0 || voz){ try { history.replaceState(null, '', location.pathname); } catch(e){} }
  setView(VIEWS.includes(v0) ? v0 : 'inicio');
  registerSW();

  const first = hasCloud() ? sync() : Promise.resolve(false);
  if(!CFG.onboarded){
    if(hasData()){ CFG.onboarded = true; saveCfg(); }
    else if(hasCloud()){
      showOnb('wait');
      first.then(() => { afterSync(); if(!CFG.onboarded && UI.onb === 'wait') showOnb('ask'); });
    } else showOnb('ask');
  }
  if(voz && !UI.onb) setTimeout(() => { const q = $('#qInput'); if(q) q.focus(); startVoice(); }, 250);
}

init();
