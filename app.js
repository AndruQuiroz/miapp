/* ═══════════════════════════════════════════════
   app.js — Mi App v2 (interfaz). Script clásico: usa los globales de core.js y quick.js.
   Bloques: 1 estado/almacenamiento/sync · 2 pantallas · 3 formularios · 4 registro rápido/voz · 5 ajustes/respaldo · 6 arranque
═══════════════════════════════════════════════ */
'use strict';

const APP_VERSION = '2.9.0';
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
  view: 'inicio', stSeg: 'stock', stQ: '', mvMonth: '', mvF: 'todos', mvFondo: '', masSeg: 'analisis', dnSeg: 'donde', anMonth: '', refQ: '', ctQ: '',
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
    DB = ensureSeeds(mergeDB(DB, j.db));      // §13.2: semillas que falten (Nequi pareja, apartados), sin duplicar
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

/* ── Apartados (fondos): PARA QUÉ es la plata (§13). Bolsillo = DÓNDE está. ── */
const FONDO_BASE = ['negocio', 'personal'];
const fondos = () => fondosOrdenados(DB);
const fondoValid = id => !!id && fondos().some(f => f.id === id);
/* "💼 Negocio" (también para apartados borrados, para que el historial se lea bien) */
const fnName = id => {
  const f = (DB.fondos || []).find(x => x.id === id);
  if(f) return (f.emoji ? f.emoji + ' ' : '') + (f.nombre || id);
  return id === 'personal' ? '👤 Personal' : id === 'negocio' ? '💼 Negocio' : String(id || '—');
};
/* El usuario NO separa la plata del negocio y la personal (por defecto): se ven juntas como "💵 Plata libre".
   Los datos no cambian (fondoDe sigue igual): si algún día activa la separación, todo se reparte solo hacia atrás. */
const juntos = () => !(CFG && CFG.separarNP);
const LIBRE = '__libre', LIBRE_NOM = '💵 Plata libre';
const fondosExtra = () => fondos().filter(f => !FONDO_BASE.includes(f.id));
const libreSaldo = bf => (bf.negocio || 0) + (bf.personal || 0);
const fondoOpts = withSaldo => {
  const bf = withSaldo ? balancesFondos(DB) : null;
  if(juntos()) return [[LIBRE, LIBRE_NOM + (bf ? ' · ' + fmt(libreSaldo(bf)) : '')]].concat(fondosExtra().map(f => [f.id, fnName(f.id) + (bf ? ' · ' + fmt(bf[f.id] || 0) : '')]));
  return fondos().map(f => [f.id, fnName(f.id) + (bf ? ' · ' + fmt(bf[f.id] || 0) : '')]);
};
const otherFondo = id => { const fs = fondos(); const p = fs.find(f => f.id === 'personal'); if(p && p.id !== id) return p.id; const o = fs.find(f => f.id !== id); return o ? o.id : id; };
const sumObj = o => Object.keys(o).reduce((a, k) => a + (+o[k] || 0), 0);
/* resolvedor rápido (core.fondoResolver arma sus índices una sola vez) */
const fondoRes = () => typeof fondoResolver === 'function' ? fondoResolver(DB) : (c, r) => fondoDe(c, r, DB);

/* ¿algún registro nombra este apartado? (los de base se resuelven por defecto y nunca se borran) */
const fondoUsed = id => ['items','gastos','ingresos','cobros','abonos','ajustes'].some(c => L(DB, c).some(r => r.fondo === id)) ||
  L(DB, 'repartos').some(r => r.from === id || r.to === id) ||
  pockets().some(p => p.iniFondos && +p.iniFondos[id]);
/* bolsillos digitales (para los enlaces de captura de MacroDroid) */
const digitalPockets = () => pockets().filter(p => p.id !== 'efectivo' && !/efectivo|cash|caja|alcanc|billete/i.test(normKey(p.nombre)));
/* "nequi, mi nequi, neki" → ['nequi','mi nequi','neki'] (sin tildes ni repetidos) */
const parseAlias = s => Array.from(new Set(String(s || '').split(/[,;\n]+/).map(a => normKey(a)).filter(Boolean))).slice(0, 20);

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
    if(i.fromTradeOf) rows.push({col: 'items', id: i.id, kind: 'compra', ico: '📦', t: i.desc, s: 'Recibido en parte de pago', f: 'negocio', fecha: i.buyDate, u: i.u,
      m: 0, amt: +i.buyPrice || 0});
    else rows.push({col: 'items', id: i.id, kind: 'compra', ico: '🛒', t: i.desc, s: 'Compra', f: 'negocio', fecha: i.buyDate, u: i.u,
      m: i.buyPocket ? -(+i.buyPrice || 0) : 0, amt: +i.buyPrice || 0, pocket: i.buyPocket, extra: i.buyPocket ? '' : 'no salió de tus bolsillos'});
    if(i.status === 'sold'){
      const paid = i.sellPaid != null && i.sellPaid !== '' ? +i.sellPaid : +i.sellPrice || 0;
      const tv = +i.tradeInValor || 0, credito = paid < (+i.sellPrice || 0) - tv;
      rows.push({col: 'items', id: i.id, kind: 'venta', ico: '💰', t: i.desc, f: 'negocio',
        s: tv ? (credito ? 'Venta + parte de pago + crédito' : 'Venta + parte de pago') : credito ? 'Venta a crédito' : 'Venta',
        fecha: i.sellDate, u: i.u, m: paid, amt: +i.sellPrice || 0, pocket: i.sellPocket});
    }
  });
  const itDesc = id => { const x = (DB.items || []).find(i => i.id === id); return x ? x.desc : ''; };
  L(DB, 'gastos').forEach(g => rows.push({col: 'gastos', id: g.id, ico: g.itemId ? '🔧' : g.tipo === 'negocio' ? '🏢' : '👤', t: g.desc || g.cat || 'Gasto', extra: g.itemId ? 'de ' + itDesc(g.itemId) : '',
    s: (g.tipo === 'negocio' ? 'Negocio' : 'Personal') + ' · ' + (g.cat || 'Otro'), f: g.tipo === 'negocio' ? 'negocio' : 'personal', fecha: g.fecha, u: g.u, m: -(+g.valor || 0), pocket: g.bolsillo}));
  L(DB, 'ingresos').forEach(g => rows.push({col: 'ingresos', id: g.id, ico: '➕', t: g.desc || 'Ingreso', s: 'Ingreso', f: 'personal', fecha: g.fecha, u: g.u, m: +g.valor || 0, pocket: g.bolsillo}));
  L(DB, 'abonos').forEach(a => { const c = cob[a.cobroId];
    rows.push({col: 'abonos', id: a.id, ico: '💸', t: 'Abono de ' + (c ? c.nombre : '¿?'), s: 'Abono', f: 'cobros', fecha: a.fecha, u: a.u, m: +a.monto || 0, pocket: a.bolsillo}); });
  L(DB, 'cobros').forEach(c => { if(c.bolsillo) rows.push({col: 'cobros', id: c.id, ico: '🤝', t: 'Préstamo a ' + c.nombre, s: 'Préstamo', f: 'cobros',
    fecha: c.fecha, u: c.u, m: -((+c.total || 0) - (+c.pagado || 0)), pocket: c.bolsillo}); });
  L(DB, 'transfers').forEach(t => rows.push({col: 'transfers', id: t.id, ico: '🔁', t: pn(t.from) + ' → ' + pn(t.to), s: 'Mover', f: 'bolsillos', fecha: t.fecha, u: t.u, m: null, amt: +t.monto || 0}));
  L(DB, 'ajustes').forEach(a => rows.push({col: 'ajustes', id: a.id, ico: '⚖️', t: a.nota || 'Ajuste de saldo', s: 'Ajuste', f: 'bolsillos', fecha: a.fecha, u: a.u, m: +a.delta || 0, pocket: a.bolsillo}));
  L(DB, 'repartos').forEach(r => rows.push({col: 'repartos', id: r.id, ico: '🔀', t: fnName(r.from) + ' → ' + fnName(r.to), s: r.nota ? 'Reparto · ' + r.nota : 'Reparto',
    f: 'bolsillos', fecha: r.fecha, u: r.u, m: null, amt: +r.monto || 0, from: r.from, to: r.to}));
  /* apartado de cada fila (§13.4: filtro por apartado); fx = el que eligió el usuario a mano */
  const fr = fondoRes(), byId = {};
  ['items','gastos','ingresos','cobros','abonos','ajustes'].forEach(c => L(DB, c).forEach(x => byId[c + ':' + x.id] = x));
  rows.forEach(r => { const x = byId[r.col + ':' + r.id]; if(x){ r.fondo = fr(r.col, x); if(x.fondo) r.fx = r.fondo; } });
  return rows.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || (+b.u || 0) - (+a.u || 0));
}

function rowHTML(r){
  const sub = [r.s, fd(r.fecha), r.pocket ? pn(r.pocket) : '', r.fx ? fnName(r.fx) : '', r.extra || ''].filter(Boolean).join(' · ');
  return `<button type="button" class="row" data-a="mov" data-col="${r.col}" data-id="${esc(r.id)}" data-kind="${r.kind || ''}">
    <span class="ico">${r.ico}</span>
    <span class="rmain"><span class="rt" style="display:block">${esc(r.t)}</span><span class="rs" style="display:block">${esc(sub)}</span></span>
    <span class="ramt">${money(r.m, r.amt)}${r.kind === 'venta' && r.m < r.amt ? `<small>de ${full(r.amt)}</small>` : ''}</span></button>`;
}

/* ── Inicio ── */
const QUICK_EX = ['almuerzo 18 mil', 'compré ps5 1.2M nequi', 'vendí ps5 1.5M efectivo', 'envío 12k nequi', 'juan me debe 200k', 'juan abonó 50k nequi', 'retiré 100k nequi', 'sueldo 1.3M nequi'];

/* Tarjeta "Organiza tu plata" (§13.4): hay datos, plata en caja y todavía no hay repartos ni saldo inicial repartido */
const showOrganizar = caja => !juntos() && !CFG.fondosIntro && caja > 0 && hasData() && fondoValid('negocio') && fondoValid('personal') &&
  !L(DB, 'repartos').length && !pockets().some(p => p.iniFondos && Object.keys(p.iniFondos).some(k => +p.iniFondos[k]));

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
    if(pend.length >= 2) h += `<button type="button" class="btn b-g full" style="margin:0 0 12px" data-a="pendTodos" data-testid="pend-todos">${iaOn() ? '🧠' : '⚡'} Clasificar los ${pend.length} de una vez</button>`;
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

  /* (c2) topes cerca o pasados (§14.4) */
  topesEstado(DB, ym).filter(x => x.estado !== 'ok').sort((a, b) => b.pct - a.pct).forEach(x => {
    const pas = x.estado === 'pasado', nom = topeNombre(x.tope);
    h += `<button type="button" class="alert card" style="--ac:${pas ? 'var(--R)' : 'var(--Y)'};display:block" data-a="goTopes" data-testid="tope-alerta" data-estado="${x.estado}">
      <div class="alert-t">${pas ? `🚨 Te pasaste del tope de ${esc(nom)} por ${full(x.gastado - x.tope.limite)}` : `⚠️ Ya gastaste el ${x.pct}% de tu tope de ${esc(nom)}`}</div>
      <div class="meta">${full(x.gastado)} de ${full(x.tope.limite)} este mes${pas ? '' : ' · te quedan ' + full(x.tope.limite - x.gastado)}</div></button>`;
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
  /* §14.4: comentario del mes, sin tener que buscarlo */
  let ins = '';
  try { ins = monthInsight(DB, ym) || ''; } catch(e){ ins = ''; }
  if(ins) h += `<p class="insight" data-testid="insight">${esc(ins)}</p>`;

  /* bolsillos */
  h += `<div class="pocks">${pockets().map(p => `<button type="button" class="pock" data-a="ajustar" data-id="${esc(p.id)}" title="Ajustar saldo">
    <small>${esc(p.nombre)}</small><b class="${(bal[p.id] || 0) < 0 ? 'neg' : ''}">${full(bal[p.id] || 0)}</b></button>`).join('')}
    <button type="button" class="pock" data-a="nuevoBolsillo"><small>Nuevo</small><b>＋</b></button></div>`;

  /* apartados (§13.4): para qué es la plata; tocar → Repartir */
  const bf = balancesFondos(DB);
  const fchips = juntos() ? (fondosExtra().length ? [{id: LIBRE, n: LIBRE_NOM, s: libreSaldo(bf)}].concat(fondosExtra().map(f => ({id: f.id, n: fnName(f.id), s: bf[f.id] || 0}))) : [])
    : fondos().map(f => ({id: f.id, n: fnName(f.id), s: bf[f.id] || 0}));
  if(fchips.length) h += `<div class="pocks fons" data-testid="fondo-chips">${fchips.map(f => `<button type="button" class="pock fon" data-a="repartir" data-fondo="${esc(f.id)}" data-testid="fondo-chip" title="Repartir">
    <small>${esc(f.n)}</small><b class="${f.s < 0 && !(juntos() && f.id === LIBRE) ? 'neg' : ''}">${full(f.s)}</b></button>`).join('')}
    <button type="button" class="pock fon" data-a="goDinero"><small>Apartados</small><b>›</b></button></div>`;

  /* primera vez con apartados: ¿cuánto es del negocio? (descartable) */
  { const rr = rendimiento(DB); if(rr.estado === 'comiendo' && rr.comido >= 50000) h += `<div class="alert" style="--ac:var(--R)" data-testid="alerta-capital"><div class="alert-t">🔻 Este mes gastaste ${full(rr.comido)} más de lo que entró</div>
    <div class="meta">Te estás comiendo capital del negocio. Mira el detalle en Más → Análisis.</div></div>`; }
  if(showOrganizar(caja)) h += `<div class="alert" style="--ac:var(--P)" data-testid="organizar"><div class="alert-t">🎯 Organiza tu plata en apartados</div>
    <div class="meta">Ahora la app separa <b>dónde</b> está tu plata (Nequi, efectivo…) de <b>para qué</b> es (💼 negocio, 👤 personal, 🏠 arriendo…). ¿Cuánto de lo que tienes hoy es capital del negocio?</div>
    <div class="pbtns"><button type="button" class="btn b-b" data-a="form" data-k="organizar" data-testid="organizar-go">Organizar</button>
    <button type="button" class="btn b-gh mut" data-a="organizarNo">Ahora no</button></div></div>`;

  /* acciones rápidas */
  const A = [['compra', '🛒', 'Compré'], ['venta', '💰', 'Vendí'], ['gasto', '💸', 'Gasto'], ['ingreso', '➕', 'Ingreso'], ['cobro', '🤝', 'Me deben'], ['abono', '💵', 'Abono'], ['transfer', '🔁', 'Mover'], ['reparto', '🔀', 'Repartir']];
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

const quienKey = q => normKey(typeof mvSinBasura === 'function' ? mvSinBasura(q) : q);
function ruleFor(p){
  const k = quienKey(p.quien);
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
    <div class="alert-h"><div style="min-width:0"><div class="alert-t">${esc((typeof mvSinBasura === 'function' ? mvSinBasura(p.quien) : p.quien) || 'Sin nombre')}</div>
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
      const d = daysBetween(i.buyDate, t), meta = +i.targetPrice || 0, ct = costoReal(i), ex = ct - (+i.buyPrice || 0);
      const dc = d >= 60 ? 't-r' : d >= 30 ? 't-y' : 't-n';
      return `<div class="it" data-testid="item" data-id="${esc(i.id)}"><div class="it-h tap" data-a="ficha" data-id="${esc(i.id)}" role="button" tabindex="0" aria-label="Ver ficha de ${esc(i.desc)}"><div style="min-width:0"><div class="it-n">${esc(i.desc)} <span class="mut" aria-hidden="true">›</span></div>
        <div class="it-tags"><span class="tag t-b">${esc(i.cat || 'Otro')}</span><span class="tag ${dc}">${d} ${d === 1 ? 'día' : 'días'}</span>${i.cond ? `<span class="tag t-n">${esc(i.cond)}</span>` : ''}${ex ? `<span class="tag t-o">🔧 +${fmt(ex)}</span>` : ''}${i.bateria != null && i.bateria !== '' ? `<span class="tag t-n">🔋 ${esc(i.bateria)}%</span>` : ''}</div></div></div>
        <div class="kv"><div><small>${ex ? 'Costo real' : 'Costo'}</small><b>${full(ct)}</b></div><div><small>Meta</small><b>${meta ? full(meta) : '—'}</b></div>
        <div><small>Ganarías</small><b class="${meta ? (meta - ct >= 0 ? 'pos' : 'neg') : 'mut'}">${meta ? full(meta - ct) : '—'}</b></div></div>
        ${i.notes ? `<div class="meta" style="margin-top:6px">${esc(i.notes)}</div>` : ''}
        <div class="btns"><button type="button" class="btn b-g" data-a="vender" data-id="${esc(i.id)}">💰 Vender</button>
        <button type="button" class="btn b-gh" data-a="editItem" data-id="${esc(i.id)}">✏️ Editar</button></div></div>`;
    }).join('');
  } else {
    const sold = all.filter(i => i.status === 'sold');
    const list = sold.filter(match).sort((a, b) => String(b.sellDate || '').localeCompare(String(a.sellDate || '')) || (+b.u || 0) - (+a.u || 0));
    const gan = sum(sold, 'sellPrice') - sum(sold.map(costoReal));
    h += `<div class="tot">
      <div class="card a-g"><div class="lbl">Vendidos</div><div class="val">${sold.length}</div></div>
      <div class="card a-b"><div class="lbl">Ventas</div><div class="val">${fmt(sum(sold, 'sellPrice'))}</div></div>
      <div class="card a-p"><div class="lbl">Ganancia</div><div class="val ${gan < 0 ? 'neg' : 'pos'}">${fmt(gan)}</div></div></div>`;
    if(!sold.length) h += emptyHTML('💰', 'Todavía no hay ventas. Cuando vendas, escribe en Inicio:', ['vendí ps5 1.5M efectivo', 'vendí tenis 250k fiado a juan']);
    else if(!list.length) h += emptyHTML('🔎', 'Nada coincide con “' + esc(UI.stQ) + '”.');
    h += list.slice(0, 150).map(i => {
      const ct = costoReal(i), g = (+i.sellPrice || 0) - ct, paid = (i.sellPaid != null && i.sellPaid !== '' ? +i.sellPaid : +i.sellPrice) + (+i.tradeInValor || 0);
      return `<div class="it" data-testid="item" data-id="${esc(i.id)}"><div class="it-h"><div style="min-width:0" class="tap" data-a="ficha" data-id="${esc(i.id)}" role="button" tabindex="0"><div class="it-n">${esc(i.desc)} <span class="mut" aria-hidden="true">›</span></div>
        <div class="it-tags"><span class="tag t-b">${esc(i.cat || 'Otro')}</span><span class="tag t-g">vendido ${fdE(i.sellDate)}</span>
        <span class="tag t-n">${daysBetween(i.buyDate, i.sellDate)} d</span>${paid < i.sellPrice ? '<span class="tag t-y">a crédito</span>' : ''}${i.tradeInValor ? '<span class="tag t-p">+ parte de pago</span>' : ''}</div></div>
        <button type="button" class="ibtn" data-a="editItem" data-id="${esc(i.id)}" aria-label="Editar">✏️</button></div>
        <div class="kv"><div><small>${ct !== +i.buyPrice ? 'Costo real' : 'Costo'}</small><b>${full(ct)}</b></div><div><small>Precio</small><b>${full(i.sellPrice)}</b></div>
        <div><small>Ganancia</small><b class="${g >= 0 ? 'pos' : 'neg'}">${full(g)}</b></div></div></div>`;
    }).join('');
    if(list.length > 150) h += `<p class="hint">Mostrando las 150 más recientes. Usa el buscador.</p>`;
  }
  $('#stockBody').innerHTML = h;
  renderRefQuick();
}

/* Stock → "¿Cuánto vale un…?" (§14.4) */
function renderRefQuick(){
  const el = $('#refBody');
  if(!el) return;
  const q = clean(UI.refQ);
  if(q.length < 2){ el.innerHTML = ''; return; }
  const r = priceRef(DB, q);
  el.innerHTML = r ? `<button type="button" class="card a-g refcard" data-a="verRef" data-q="${esc(q)}" data-testid="ref-quick">
      <div class="lbl">${esc(r.modelo)} · ${plural(r.items.length, 'registro')}</div>
      <div class="val">${r.sugeridoVenta ? '~' + full(r.sugeridoVenta) : '—'}</div>
      <div class="sub">${esc(refLine(r))}${r.gananciaProm != null ? ' · ganas ~' + fmt(r.gananciaProm) : ''} · ver todo ›</div></button>`
    : `<p class="hint" style="margin:-4px 0 12px" data-testid="ref-quick-none">No has comprado ni vendido “${esc(q)}” todavía.</p>`;
}

/* ── Movimientos ── */
function renderMovs(){
  const ym = UI.mvMonth;
  $('#mvMonth').textContent = ymLabel(ym);
  $('#mvNext').disabled = ym >= today().slice(0, 7);
  $$('#mvFil button').forEach(b => b.classList.toggle('on', b.dataset.f === UI.mvF));
  /* filtro por apartado (§13.4): los repartos cuentan con signo para ese apartado; los traslados entre bolsillos no tienen apartado */
  const sel = $('#mvFondo'), fs = juntos() ? [{id: LIBRE}].concat(fondosExtra()) : fondos();
  if(UI.mvFondo && !fs.some(f => f.id === UI.mvFondo)) UI.mvFondo = '';
  if(sel){
    sel.hidden = juntos() && !fondosExtra().length;
    sel.innerHTML = `<option value="">🎯 Todos los apartados</option>` + fs.map(f => `<option value="${esc(f.id)}">${esc(f.id === LIBRE ? LIBRE_NOM : fnName(f.id))}</option>`).join('');
    sel.value = UI.mvFondo;
  }
  const fo = UI.mvFondo;
  const inFo = x => fo === LIBRE ? FONDO_BASE.includes(x) : x === fo;
  const all = movs().filter(r => String(r.fecha || '').slice(0, 7) === ym)
    .filter(r => !fo || inFo(r.fondo) || (r.col === 'repartos' && (inFo(r.from) !== inFo(r.to))))
    .map(r => fo && r.col === 'repartos' ? Object.assign({}, r, {m: inFo(r.to) ? r.amt : -r.amt}) : r);
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
  else if(UI.masSeg === 'dinero') renderDinero();
  else if(UI.masSeg === 'contactos') renderContactos();
  else renderAjustes();
}


/* ── ¿Cómo vas? (patrimonio, gasto vs ganancia, rotación) ── */
const pct = x => Math.round(x * 100) + '%';
function rendHTML(ym){
  const r = rendimiento(DB, ym);
  if(r.estado === 'sin-datos' && !r.pFin.total) return '';
  const cls = {creciendo: 'var(--G)', justo: 'var(--Y)', comiendo: 'var(--R)', 'sin-datos': 'var(--B)'}[r.estado];
  let titulo;
  if(r.estado === 'comiendo') titulo = `🔻 Gastaste ${full(r.comido)} más de lo que entró: te estás comiendo capital`;
  else if(r.estado === 'justo') titulo = r.pctGasto > 1 ? `⚠️ Gastaste más de lo que ganó el negocio (${pct(r.pctGasto)}); lo cubrieron tus otros ingresos` : `⚠️ Gastaste el ${pct(r.pctGasto)} de lo que ganaste: quedó poco para crecer`;
  else if(r.estado === 'creciendo') titulo = r.pctGasto != null ? `📈 Vas bien: gastaste el ${pct(r.pctGasto)} de lo que ganaste` : '📈 Vas bien';
  else titulo = '📈 Tu patrimonio';
  const max = Math.max(1, ...r.serie.map(x => x.total));
  const barras = `<div class="rend-serie" aria-label="Patrimonio de los últimos 6 meses">${r.serie.map(x => `<div class="rs"><i style="height:${Math.max(3, Math.round(x.total / max * 42))}px"></i><small>${esc(monthLabel(x.ym).split(' ')[0])}</small></div>`).join('')}</div>`;
  const fila = (l, v, sub, c) => `<div class="rf"><span>${l}</span><b class="mono ${c || ''}">${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  return `<div class="alert rend" style="--ac:${cls}" data-testid="rendimiento"><div class="alert-t">${esc(titulo)}</div>
    <div class="rend-top"><div><div class="lbl">Patrimonio ${r.actual ? 'hoy' : 'al cierre'}</div><div class="val">${full(r.pFin.total)}</div>
      <div class="sub ${r.cambio < 0 ? 'neg' : 'pos'}">${r.cambio >= 0 ? '▲' : '▼'} ${full(Math.abs(r.cambio))} en el mes</div></div>${barras}</div>
    ${fila('💵 Plata en bolsillos', full(r.pFin.caja))}${fila('📦 Stock (a lo que costó)', full(r.pFin.stock))}${fila('🤝 Te deben', full(r.pFin.deben))}
    <div class="rsep"></div>
    ${fila('Ganancia del negocio', full(r.neta), '', r.neta < 0 ? 'neg' : 'pos')}
    ${fila('Gastos personales', full(r.gP), r.pctGasto != null ? pct(r.pctGasto) + ' de la ganancia' : '', r.estado === 'comiendo' ? 'neg' : '')}
    ${r.roi != null ? fila('Rendimiento del capital', pct(r.roi), 'ganancia ÷ patrimonio al iniciar el mes') : ''}
    ${r.diasProm != null ? fila('Rotación', r.diasProm + ' días', r.vueltas ? `tu plata da ~${r.vueltas} vueltas al mes` : '') : ''}
    ${r.quietos.n ? fila('⏳ Plata quieta (+30 días)', full(r.quietos.total), plural(r.quietos.n, 'producto'), 'yel') : ''}
    <p class="hint" style="margin-top:8px">Patrimonio = bolsillos + stock + lo que te deben. Si sube mes a mes, estás creciendo. Meta sana: gastar en lo personal máximo la mitad de la ganancia.</p></div>`;
}

function renderAnalisis(){
  const ym = UI.anMonth, s = monthStats(DB, ym);
  $('#anMonth').textContent = ymLabel(ym);
  $('#anNext').disabled = ym >= today().slice(0, 7);
  const k = (lbl, v, sub, ac, cls) => `<div class="card ${ac}"><div class="lbl">${lbl}</div><div class="val ${cls || ''}">${v}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  $('#anKpis').innerHTML = rendHTML(ym) + `<div class="kpis">
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

/* ── Más → Dinero (§13.4): ¿Dónde está? (bolsillos) · ¿Para qué es? (apartados) + chequeo de cuadre ── */
function renderDinero(){
  if(UI.dnSeg !== 'para' && UI.dnSeg !== 'topes') UI.dnSeg = 'donde';
  $$('#dnSeg button').forEach(b => b.classList.toggle('on', b.dataset.seg === UI.dnSeg));
  $('#bolBody').hidden = UI.dnSeg !== 'donde';
  $('#fonBody').hidden = UI.dnSeg !== 'para';
  $('#topBody').hidden = UI.dnSeg !== 'topes';
  $('#dnCheck').hidden = UI.dnSeg === 'topes';
  if(UI.dnSeg !== 'topes') renderCuadre();
  if(UI.dnSeg === 'donde') renderBolsillos(); else if(UI.dnSeg === 'para') renderFondos(); else renderTopes();
}

/* "Total en bolsillos $X = Total en apartados $X ✅" — si no cuadra (no debería) ⚠️ + Reportar */
function renderCuadre(){
  const tb = sumObj(balances(DB)), tf = sumObj(balancesFondos(DB)), ok = tb === tf;
  $('#dnCheck').innerHTML = `<div class="cuadre ${ok ? 'ok' : 'bad'}" data-testid="cuadre" data-ok="${ok ? 1 : 0}">
    <div class="cq"><small>Total en bolsillos</small><b data-testid="total-bolsillos">${full(tb)}</b></div><span class="eqs">${ok ? '=' : '≠'}</span>
    <div class="cq"><small>Total en apartados</small><b data-testid="total-apartados">${full(tf)}</b></div>
    <span class="ck" aria-label="${ok ? 'Cuadra' : 'No cuadra'}">${ok ? '✅' : '⚠️'}</span></div>
    ${ok ? '<p class="hint" style="margin:-4px 0 12px">Cada peso está en un bolsillo y tiene un para qué. Si los dos totales son iguales, tus cuentas cuadran.</p>'
      : `<div class="alert" style="--ac:var(--R)"><div class="alert-t">⚠️ No cuadra por ${full(tb - tf)}</div><div class="meta">Esto no debería pasar. Copia el reporte y envíaselo a quien te ayuda con la app.</div>
        <div class="pbtns"><button type="button" class="btn b-r wide" data-a="reportarCuadre" data-testid="cuadre-reportar">📋 Copiar reporte</button></div></div>`}`;
}

function renderBolsillos(){
  const bal = balances(DB), ps = pockets();
  let h = ps.map(p => `<div class="it" data-testid="bolsillo" data-id="${esc(p.id)}"><div class="it-h"><div style="min-width:0"><div class="it-n">${esc(p.nombre)}</div>
    ${(p.alias || []).length ? `<div class="meta">Lo reconozco como: ${esc(p.alias.slice(0, 5).join(', '))}${p.alias.length > 5 ? '…' : ''}</div>` : ''}</div>
    <div class="alert-m ${(bal[p.id] || 0) < 0 ? 'neg' : ''}">${full(bal[p.id] || 0)}</div></div>
    <div class="btns"><button type="button" class="btn b-gh" data-a="ajustar" data-id="${esc(p.id)}">⚖️ Ajustar saldo</button>
    <button type="button" class="ibtn" data-a="renombrar" data-id="${esc(p.id)}" aria-label="Editar nombre y alias">✏️</button>
    ${pocketUsed(p.id) ? '' : `<button type="button" class="ibtn" data-a="delBolsillo" data-id="${esc(p.id)}" aria-label="Eliminar">🗑️</button>`}</div></div>`).join('');
  h += `<div class="btns" style="margin-bottom:12px"><button type="button" class="btn b-g" data-a="nuevoBolsillo">+ Nuevo bolsillo</button>
    <button type="button" class="btn b-b" data-a="form" data-k="transfer">🔁 Mover entre bolsillos</button></div>
    <p class="hint">El saldo se calcula solo con lo que registras; si no cuadra con Nequi, usa <b>Ajustar</b>. Solo puedes eliminar un bolsillo sin movimientos.
    Con ✏️ cambias su nombre y las palabras con que lo nombras al escribir (“el nequi de mi pareja”).</p>`;
  $('#bolBody').innerHTML = h;
}

/* Más → Dinero → Topes (§14.4): gastado / límite del mes con barra; sugerir "Todo lo personal" */
function renderTopes(){
  const ym = today().slice(0, 7), est = topesEstado(DB, ym);
  let h = `<p class="hint" style="margin-bottom:10px">Lo máximo que quieres gastar al mes. Te aviso en Inicio al llegar al 80% y si te pasas. Mes: <b>${esc(ymLabel(ym))}</b>.</p>`;
  h += est.sort((a, b) => b.pct - a.pct).map(x => {
    const c = x.estado === 'pasado' ? 'var(--R)' : x.estado === 'cerca' ? 'var(--Y)' : 'var(--G)';
    return `<div class="it" data-testid="tope" data-id="${esc(x.tope.id)}" data-estado="${x.estado}"><div class="it-h"><div style="min-width:0"><div class="it-n">${x.tope.cat === '__personal' ? '👤 Todo lo personal' : esc(x.tope.cat)}</div>
      <div class="meta">${full(x.gastado)} de ${full(x.tope.limite)} · ${x.estado === 'pasado' ? `<b class="neg">te pasaste por ${full(x.gastado - x.tope.limite)}</b>` : `te quedan ${full(x.tope.limite - x.gastado)}`}</div></div>
      <div class="alert-m ${x.estado === 'pasado' ? 'neg' : x.estado === 'cerca' ? 'yel' : ''}">${x.pct}%</div></div>
      <div class="bar"><i style="width:${Math.min(100, x.pct)}%;background:${c}"></i></div>
      <div class="btns"><button type="button" class="btn b-gh" data-a="editTope" data-id="${esc(x.tope.id)}">✏️ Editar</button></div></div>`;
  }).join('');
  if(!est.some(x => x.tope.cat === '__personal')){
    /* sugerencia: promedio de lo personal de los 3 meses anteriores, redondeado a $50.000 */
    const prev = [1, 2, 3].map(n => monthStats(DB, ymAdd(ym, -n)).gP).filter(x => x > 0);
    const sug = prev.length ? Math.ceil(sum(prev) / prev.length / 50000) * 50000 : 0;
    h += `<div class="alert" style="--ac:var(--B)" data-testid="tope-sugerido"><div class="alert-t">💡 Ponle un tope a todo lo personal</div>
      <div class="meta">${sug ? `En promedio gastas ${full(sug)} al mes en lo personal. Empieza con eso y ajústalo.` : 'Así sabes cuánto puedes gastar sin tocar la plata del negocio.'}</div>
      <div class="pbtns"><button type="button" class="btn b-b wide" data-a="nuevoTope" data-cat="__personal" data-lim="${sug || ''}">🚦 Crear tope personal${sug ? ' de ' + full(sug) : ''}</button></div></div>`;
  }
  h += `<div class="btns" style="margin-bottom:12px"><button type="button" class="btn b-g" data-a="nuevoTope" data-testid="tope-nuevo">+ Nuevo tope</button></div>`;
  $('#topBody').innerHTML = h;
}

/* Más → Contactos (§14.4): buscador, compras / ventas / ganancia / debe, WhatsApp y editar */
function renderContactos(){
  const q = normNombre(UI.ctQ), all = contactos();
  const list = all.filter(c => !q || normNombre([c.nombre, c.tel, c.notas].join(' ')).includes(q));
  let h = `<div class="btns" style="margin:0 0 12px"><button type="button" class="btn b-g" data-a="nuevoContacto" data-testid="contacto-nuevo">+ Nuevo contacto</button></div>`;
  if(!all.length) h += emptyHTML('👥', 'Aún no tienes contactos. Guárdalos al comprar o vender (“¿Lo guardo en tus contactos?”) o créalos aquí.');
  else if(!list.length) h += emptyHTML('🔎', 'Nadie coincide con “' + esc(UI.ctQ) + '”.');
  h += list.map(c => {
    const s = contactoStats(DB, c.id) || {compras: {n: 0, total: 0}, ventas: {n: 0, total: 0, ganancia: 0}, debe: 0, ultimo: null};
    return `<div class="it" data-testid="contacto" data-id="${esc(c.id)}"><div class="it-h"><div style="min-width:0"><div class="it-n">${esc(c.nombre)}</div>
      <div class="it-tags"><span class="tag ${c.tipo === 'proveedor' ? 't-p' : c.tipo === 'ambos' ? 't-b' : 't-g'}">${esc(CT_TIPO[c.tipo] || 'Cliente')}</span>${c.tel ? `<span class="tag t-n">${esc(c.tel)}</span>` : ''}${s.debe ? `<span class="tag t-y">te debe ${esc(fmt(s.debe))}</span>` : ''}</div></div></div>
      ${c.notas ? `<div class="meta" style="margin-top:6px">${esc(c.notas)}</div>` : ''}
      <div class="kv" data-testid="contacto-stats"><div><small>Le compraste</small><b>${s.compras.n ? s.compras.n + ' · ' + fmt(s.compras.total) : '—'}</b></div>
      <div><small>Le vendiste</small><b>${s.ventas.n ? s.ventas.n + ' · ' + fmt(s.ventas.total) : '—'}</b></div>
      <div><small>${s.debe ? 'Te debe' : 'Ganancia'}</small><b class="${s.debe ? 'yel' : s.ventas.ganancia > 0 ? 'pos' : s.ventas.ganancia < 0 ? 'neg' : 'mut'}">${s.debe ? full(s.debe) : s.ventas.n ? full(s.ventas.ganancia) : '—'}</b></div></div>
      ${s.ultimo ? `<div class="meta" style="margin-top:6px">Último: ${esc(s.ultimo.tipo)} ${s.ultimo.desc ? '· ' + esc(s.ultimo.desc) : ''} · ${fdE(s.ultimo.fecha)}</div>` : ''}
      <div class="btns"><button type="button" class="btn b-wa" data-a="waContacto" data-id="${esc(c.id)}">💬 WhatsApp</button>
      <button type="button" class="ibtn" data-a="editContacto" data-id="${esc(c.id)}" aria-label="Editar">✏️</button></div></div>`;
  }).join('');
  $('#ctBody').innerHTML = h;
}

/* por qué un apartado está en negativo, en palabras */
function fondoNegTxt(f, x, bf){
  const otros = id => (bf[id] || 0) >= x;
  if(f.id === 'negocio') return `El negocio está usando ${full(x)} de ${otros('personal') ? 'tu plata personal' : 'la plata de tus otros apartados'}. Se repone cuando vendas, o pásale plata con Repartir.`;
  if(f.id === 'personal') return `Estás usando ${full(x)} de ${otros('negocio') ? 'la plata del negocio' : 'tus otros apartados'} para lo personal. Repártele de vuelta cuando puedas.`;
  return `${f.nombre} gastó ${full(x)} más de lo que le apartaste: lo está cubriendo tu otra plata. Repártele para cuadrarlo.`;
}

function renderFondos(){
  const bf = balancesFondos(DB), fs = juntos() ? fondosExtra() : fondos();
  let h = '';
  if(juntos()) h += `<div class="it" data-testid="fondo" data-id="${LIBRE}"><div class="it-h"><div style="min-width:0"><div class="it-n">${LIBRE_NOM}</div>
      <div class="meta">Toda tu plata junta (negocio y personal), menos lo que tengas apartado.</div></div>
      <div class="alert-m" data-testid="fondo-saldo">${full(libreSaldo(bf))}</div></div>
      ${fondosExtra().length ? `<div class="btns"><button type="button" class="btn b-gh" data-a="repartir" data-fondo="${LIBRE}">🔀 Repartir</button></div>` : ''}</div>`;
  h += fs.map(f => {
    const s = bf[f.id] || 0, meta = +f.meta || 0;
    const pct = meta > 0 ? Math.max(0, Math.min(100, Math.round(s / meta * 100))) : 0;
    const borrable = !FONDO_BASE.includes(f.id) && !s && !fondoUsed(f.id);
    return `<div class="it" data-testid="fondo" data-id="${esc(f.id)}"><div class="it-h"><div style="min-width:0"><div class="it-n">${esc(fnName(f.id))}</div>
      ${(f.alias || []).length ? `<div class="meta">Lo reconozco como: ${esc(f.alias.slice(0, 5).join(', '))}${f.alias.length > 5 ? '…' : ''}</div>` : ''}</div>
      <div class="alert-m ${s < 0 ? 'neg' : ''}" data-testid="fondo-saldo">${full(s)}</div></div>
      ${meta > 0 ? `<div class="bar"><i style="width:${pct}%"></i></div><div class="meta" style="margin-top:4px">${s >= meta ? '🎉 ¡Meta cumplida!' : `Meta ${full(meta)} · vas en ${pct}% · faltan ${full(meta - Math.max(0, s))}`}</div>` : ''}
      ${s < 0 ? `<div class="negx" data-testid="fondo-neg">⚠️ ${esc(fondoNegTxt(f, -s, bf))}</div>` : ''}
      <div class="btns"><button type="button" class="btn b-gh" data-a="repartir" data-fondo="${esc(f.id)}">🔀 Repartir</button>
      <button type="button" class="ibtn" data-a="editFondo" data-id="${esc(f.id)}" aria-label="Editar apartado">✏️</button>
      ${borrable ? `<button type="button" class="ibtn" data-a="delFondo" data-id="${esc(f.id)}" aria-label="Eliminar apartado">🗑️</button>` : ''}</div></div>`;
  }).join('');
  h += `<div class="btns" style="margin-bottom:12px"><button type="button" class="btn b-g" data-a="nuevoFondo" data-testid="fondo-nuevo">+ Nuevo apartado</button>
    <button type="button" class="btn b-b" data-a="form" data-k="reparto">🔀 Repartir</button></div>
    ${juntos() ? `<p class="hint">Un apartado es plata con un propósito (🏠 Arriendo, 🐷 Ahorro…). Lo que no está apartado es tu <b>💵 Plata libre</b>.
    Repartir mueve plata a un apartado sin sacarla del bolsillo. La ganancia del negocio se calcula igual: la app separa los <b>gastos</b> personales de los del negocio.</p>`
    : `<p class="hint">Un apartado dice <b>para qué</b> es la plata, no dónde está. Compras y ventas van a <b>💼 Negocio</b>; gastos personales e ingresos a <b>👤 Personal</b>.
    En cada formulario lo cambias con <b>“Plata de:”</b>. Repartir mueve plata entre apartados sin sacarla del bolsillo. Solo puedes eliminar un apartado en $0 y sin movimientos.</p>`}
    <div class="it" style="margin-top:10px"><div class="it-h"><div style="min-width:0"><div class="it-n">Separar la plata del negocio y la personal</div>
      <div class="meta">${juntos() ? 'Apagado: tu plata se ve junta. Actívalo si algún día quieres llevar caja aparte para el negocio.' : 'Activado: ves 💼 Negocio y 👤 Personal por separado.'}</div></div>
      <button type="button" class="btn ${juntos() ? 'b-gh' : 'b-b'}" data-a="toggleSepNP" data-testid="toggle-separar" style="flex-shrink:0">${juntos() ? 'Activar' : 'Desactivar'}</button></div></div>`;
  $('#fonBody').innerHTML = h;
}

/* ═════════ 2b. RONDA 5 (§14.4): ficha del producto, referencia de precios, contactos y topes ═════════ */
const costoReal = it => costoItem(DB, it);
const contactos = () => L(DB, 'contactos').slice().sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));
const contactoPor = nombre => { const n = normNombre(nombre); return n ? L(DB, 'contactos').find(c => normNombre(c.nombre) === n) || null : null; };
const CT_TIPO = {cliente: 'Cliente', proveedor: 'Proveedor', ambos: 'Cliente y proveedor'};
/* nombre escrito en un formulario → {id?, nombre}; crea el contacto si el usuario lo pidió; si ya existía con el otro rol → 'ambos' */
function linkContacto(nombre, crear, tipo){
  nombre = titleCase(clean(nombre));
  if(!nombre) return {};
  let c = contactoPor(nombre);
  if(!c && crear === 'si') c = put('contactos', {nombre, tel: '', tipo, notas: ''});
  if(c && c.tipo !== tipo && c.tipo !== 'ambos') c = put('contactos', Object.assign({}, c, {tipo: 'ambos'}));
  return c ? {id: c.id, nombre: c.nombre} : {nombre};
}
/* datos del equipo: "128" → "128GB", batería 0–100 */
const almacTxt = s => { s = clean(s); return /^\d+$/.test(s) ? s + 'GB' : s.replace(/\s*(gb|tb)$/i, m => m.trim().toUpperCase()); };
const bateriaNum = x => { if(x === '' || x == null) return null; const n = Math.round(parseFloat(String(x).replace(',', '.'))); return isNaN(n) ? NaN : n; };
function equipoDe(v){
  const o = {}, b = bateriaNum(v.bateria);
  if(b != null && !isNaN(b)) o.bateria = b;
  ['imei', 'imei2', 'serie', 'almac', 'color'].forEach(k => { const x = k === 'almac' ? almacTxt(v[k]) : k === 'color' ? titleCase(clean(v[k])) : clean(v[k]); if(x) o[k] = x; });
  return o;
}
const equipoErr = v => { const b = bateriaNum(v.bateria); return b != null && (isNaN(b) || b < 0 || b > 100) ? {err: 'La batería va de 0 a 100 %', k: 'bateria'} : null; };

/* ── hoja de información (ficha y referencia): usa la misma hoja inferior que los formularios ── */
let INFO = null;   // {kind:'ficha'|'ref', id|q}
function showSheet(){
  const sh = $('#sheet');
  sh.classList.add('on'); sh.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  try { if(!(history.state && history.state.sheet)) history.pushState({sheet: 1}, ''); } catch(e){}
}
function openInfo(info, title, body, foot){
  F = null; LOTE = null; INFO = info; SHEET = 'info';
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = body;
  $('#sheetFoot').innerHTML = foot || '<button type="button" class="btn b-gh" data-a="infoClose">Cerrar</button>';
  $('#sheetBody').scrollTop = 0;
  showSheet();
}
function closeInfo(){
  INFO = null; SHEET = null;
  const sh = $('#sheet');
  sh.classList.remove('on'); sh.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  setTimeout(() => { if(!SHEET){ $('#sheetBody').innerHTML = ''; $('#sheetFoot').innerHTML = ''; $('#sheetTitle').textContent = ''; } }, 220);
}
const kv3 = arr => `<div class="kv">${arr.map(([l, v, c]) => `<div><small>${esc(l)}</small><b class="${c || ''}">${v}</b></div>`).join('')}</div>`;

/* Ficha del producto (§14.4): línea de tiempo, ganancia REAL (costo + arreglos), datos del equipo y contactos */
function fichaHTML(h){
  const it = h.item, vend = !!h.venta;
  const st = vend ? `<span class="tag t-g">vendido ${fdE(h.venta.fecha)}</span>` : `<span class="tag ${h.dias >= 60 ? 't-r' : h.dias >= 30 ? 't-y' : 't-n'}">en stock · ${plural(h.dias, 'día')}</span>`;
  let b = `<div class="it-tags" style="margin:0 0 10px">${st}<span class="tag t-b">${esc(it.cat || 'Otro')}</span>${it.cond ? `<span class="tag t-n">${esc(it.cond)}</span>` : ''}${it.del ? '<span class="tag t-r">eliminado</span>' : ''}</div>`;
  const extras = h.costoTotal - (+it.buyPrice || 0);
  if(vend) b += kv3([['Costo total', full(h.costoTotal)], ['Venta', full(h.venta.precio)], ['Ganancia real', full(h.ganancia), h.ganancia >= 0 ? 'pos' : 'neg']]) +
    kv3([['Margen', h.margen == null ? '—' : Math.round(h.margen) + '%'], ['Días', String(h.dias)], ['Arreglos', extras ? full(extras) : '—']]);
  else { const meta = +it.targetPrice || 0;
    b += kv3([['Costo total', full(h.costoTotal)], ['Meta', meta ? full(meta) : '—'], ['Ganarías', meta ? full(meta - h.costoTotal) : '—', meta ? (meta - h.costoTotal >= 0 ? 'pos' : 'neg') : 'mut']]); }
  if(extras) b += `<p class="hint" style="margin-top:6px">Costo total = lo que pagaste ${full(it.buyPrice)} + arreglos y gastos de este producto ${full(extras)}.</p>`;
  /* línea de tiempo */
  const ev = [];
  if(h.origen) ev.push({f: it.buyDate, ico: '📦', t: `Lo recibiste en parte de pago`, s: `por <button type="button" class="lnk" data-a="ficha" data-id="${esc(h.origen.id)}">${esc(h.origen.desc)}</button> · valorado en ${full(it.buyPrice)}`});
  else ev.push({f: it.buyDate, ico: '🛒', t: 'Compra · ' + full(it.buyPrice), s: esc([it.buyPocket ? pn(it.buyPocket) : 'no salió de tus bolsillos', h.proveedor ? 'a ' + h.proveedor : ''].filter(Boolean).join(' · '))});
  h.costosExtra.forEach(g => ev.push({f: g.fecha, ico: '🔧', t: esc(g.desc || g.cat || 'Gasto') + ' · ' + full(g.valor), s: esc([g.cat, pn(g.bolsillo)].filter(Boolean).join(' · ')), id: g.id}));
  if(vend){
    const tv = +it.tradeInValor || 0, pag = h.venta.pagado;
    ev.push({f: h.venta.fecha, ico: '💰', t: 'Venta · ' + full(h.venta.precio), s: esc([pag ? full(pag) + ' en plata' + (h.venta.bolsillo ? ' a ' + pn(h.venta.bolsillo) : '') : '', h.venta.cliente ? 'a ' + h.venta.cliente : ''].filter(Boolean).join(' · ')) +
      (h.recibido ? ` · + <button type="button" class="lnk" data-a="ficha" data-id="${esc(h.recibido.id)}">${esc(h.recibido.desc)}</button> (${full(tv || h.recibido.buyPrice)})` : '')});
    if(h.cobro) ev.push({f: h.cobro.fecha || h.venta.fecha, ico: '🤝', t: h.cobro.pend > 0 ? `${esc(h.cobro.nombre)} te debe ${full(h.cobro.pend)}` : `${esc(h.cobro.nombre)} ya te pagó todo`, s: 'abonado ' + full(h.cobro.pag) + ' de ' + full(h.cobro.total)});
  }
  b += `<div class="sec-h" style="margin-top:14px"><span class="sec-t">Historia</span></div><ol class="tl" data-testid="ficha-tl">${ev.map(e =>
    `<li><span class="tl-i">${e.ico}</span><div><b>${e.t}</b><div class="meta">${fdE(e.f)}${e.s ? ' · ' + e.s : ''}</div></div></li>`).join('')}</ol>`;
  /* datos del equipo y contactos */
  const eq = [['IMEI', it.imei], ['IMEI 2', it.imei2], ['Serie', it.serie], ['Batería', it.bateria != null && it.bateria !== '' ? it.bateria + '%' : ''], ['Almacenamiento', it.almac], ['Color', it.color], ['Estado', it.cond]].filter(x => x[1]);
  b += `<div class="sec-h" style="margin-top:14px"><span class="sec-t">Datos del equipo</span></div>` + (eq.length
    ? eq.map(([l, v]) => `<div class="kvline"><span>${l}</span><b class="mono">${esc(v)}</b></div>`).join('')
    : '<p class="hint">Sin datos (IMEI, batería…). Súbelos con una foto o agrégalos con ✏️ Editar.</p>');
  if(!it.del) b += `<button type="button" class="btn b-b full" style="margin-top:8px" data-a="ocrFicha" data-id="${esc(it.id)}" data-testid="ocr-ficha">📷 Leer datos de una foto</button>`;
  const ct = [['Se lo compraste a', h.proveedor, it.proveedorId], ['Se lo vendiste a', h.venta && h.venta.cliente, it.clienteId]].filter(x => x[1]);
  if(ct.length) b += `<div class="sec-h" style="margin-top:14px"><span class="sec-t">Contactos</span></div>` + ct.map(([l, n, id]) =>
    `<div class="kvline"><span>${l}</span>${id && get('contactos', id) ? `<button type="button" class="lnk" data-a="goContacto" data-id="${esc(id)}">${esc(n)}</button>` : `<b>${esc(n)}</b>`}</div>`).join('');
  /* referencia del modelo */
  const r = priceRef(DB, it);
  if(r && r.items.length > 1) b += `<button type="button" class="refline" data-a="verRef" data-q="${esc(it.desc)}" style="margin-top:12px">📊 ${esc(refLine(r))} ›</button>`;
  if(it.notes) b += `<p class="hint" style="margin-top:10px">📝 ${esc(it.notes)}</p>`;
  return b;
}
function openFicha(id){
  const h = itemHistory(DB, id);
  if(!h) return toast('Ese producto ya no existe', {err: true});
  const it = h.item, live = !it.del, sid = esc(it.id);
  openInfo({kind: 'ficha', id}, (it.status === 'sold' ? '💰 ' : '📦 ') + it.desc, fichaHTML(h),
    (live && it.status !== 'sold' ? `<button type="button" class="btn b-g" data-a="fichaVender" data-id="${sid}" data-testid="ficha-vender">💰 Vender</button>` : '') +
    (live ? `<button type="button" class="btn b-gh" data-a="fichaEditar" data-id="${sid}" data-testid="ficha-editar">✏️ Editar</button>
      <button type="button" class="btn b-gh" data-a="fichaGasto" data-id="${sid}" data-testid="ficha-gasto">＋ Gasto</button>` : '<button type="button" class="btn b-gh" data-a="infoClose">Cerrar</button>'));
  $('#sheetBody').setAttribute('data-ficha', it.id);
}
/* volver a la ficha después de un formulario abierto desde ella */
const backToFicha = id => () => { if(get('items', id) || (DB.items || []).some(i => i.id === id)) openFicha(id); };

/* Referencia de precios (§14.4) */
const veces = n => n === 1 ? '1 vez' : n + ' veces';
function refLine(r){
  const p = [];
  if(r.compras.n) p.push(`Lo has comprado ${veces(r.compras.n)}, prom. ${fmt(r.compras.prom)}`);
  if(r.sugeridoVenta) p.push(`${r.ventas.n ? 'lo vendes en' : 'podrías venderlo en'} ~${fmt(r.sugeridoVenta)} (sugerido)`);
  return p.join(' · ');
}
function refStatsHTML(r){
  const st = (t, o) => o.n ? `<div class="kvline"><span>${t} <span class="mut" style="font-size:12px">· ${veces(o.n)}</span></span><b class="mono">${full(o.prom)}</b></div>
    <div class="meta" style="margin:4px 0 8px">entre ${full(o.min)} y ${full(o.max)} · última ${full(o.ultima.precio)} el ${fdE(o.ultima.fecha)}</div>` : `<div class="kvline"><span>${t}</span><b class="mut">—</b></div>`;
  let b = `<p class="hint" style="margin-bottom:8px">Modelo: <b>${esc(r.modelo)}</b></p>`;
  b += `<div class="card a-g" style="margin-bottom:10px"><div class="lbl">Precio de venta sugerido</div><div class="val" data-testid="ref-sugerido">${r.sugeridoVenta ? full(r.sugeridoVenta) : '—'}</div>
    <div class="sub">${r.ventas.n ? 'promedio de tus últimas ventas' : r.sugeridoVenta ? 'tu costo promedio + tu margen de siempre' : 'aún no hay datos para sugerir'}</div></div>`;
  b += st('Compras', r.compras) + st('Ventas', r.ventas);
  b += `<div class="kvline"><span>Ganancia promedio</span><b class="mono ${r.gananciaProm == null ? 'mut' : r.gananciaProm >= 0 ? 'pos' : 'neg'}">${r.gananciaProm == null ? '—' : full(r.gananciaProm)}</b></div>`;
  b += `<div class="kvline"><span>Días para vender</span><b class="mono">${r.diasProm == null ? '—' : r.diasProm + ' d'}</b></div>`;
  return b;
}
function refHTML(r){
  let b = refStatsHTML(r);
  b += `<div class="sec-h" style="margin-top:12px"><span class="sec-t">${r.items.length === 1 ? 'Tu producto' : 'Tus ' + r.items.length + ' productos'} de este modelo</span></div><div class="list">` +
    r.items.slice(0, 30).map(i => { const sold = i.status === 'sold';
      return `<button type="button" class="row" data-a="ficha" data-id="${esc(i.id)}"><span class="ico">${sold ? '💰' : '📦'}</span>
      <span class="rmain"><span class="rt" style="display:block">${esc(i.desc)}</span><span class="rs" style="display:block">${sold ? 'vendido ' + fd(i.sellDate) : 'en stock desde ' + fd(i.buyDate)}</span></span>
      <span class="ramt">${sold ? full(i.sellPrice) : full(i.buyPrice)}<small>${sold ? 'costó ' + full(i.buyPrice) : 'costo'}</small></span></button>`; }).join('') + '</div>';
  return b;
}
function openRef(q){
  const r = priceRef(DB, q);
  if(!r) return toast('No tengo datos de “' + q + '” todavía', {err: true});
  openInfo({kind: 'ref', q}, '📊 ¿Cuánto vale?', refHTML(r));
}

/* ── Ronda 6: leer IMEI, batería y almacenamiento de un pantallazo (OCR en el celular, app/ocr.js) ── */
let OCR = null;   // {mode:'ficha'|'form', itemId, busy}
const OCR_TIPS = 'Usa el pantallazo de <b>Ajustes → General → Información</b> (iPhone) o <b>Ajustes → Acerca del teléfono</b> (Android). Para la batería: <b>Ajustes → Batería → Estado y carga</b>. Puedes elegir varias fotos a la vez.';
function ocrPick(mode, itemId){
  if(OCR && OCR.busy) return toast('Ya estoy leyendo una foto…');
  if(typeof leerImagenes !== 'function') return toast('El lector de fotos no está disponible', {err: true});
  OCR = {mode, itemId: itemId || ''};
  const inp = $('#ocrFile');
  if(inp){ inp.value = ''; inp.click(); }
}
/* progreso legible a partir de los mensajes de Tesseract */
function ocrProgress(n, primera){
  let foto = 1, last = 0;
  return m => {
    const st = String(m && m.status || ''), p = Math.round((+m.progress || 0) * 100);
    let txt;
    if(/recogni/.test(st)){ if(p < last - 20 && foto < n) foto++; last = p; txt = `Leyendo foto ${foto} de ${n}… ${p}%`; }
    else if(/load|download|initiali/.test(st)) txt = primera ? 'Descargando el lector (solo la primera vez, ~4 MB)… ' + p + '%' : 'Preparando el lector…';
    else return;
    ocrMsg(txt, /recogni/.test(st) ? ((foto - 1) + p / 100) / n : null);
  };
}
function ocrMsg(txt, frac){
  if(OCR && OCR.mode === 'form'){ const el = $('#ocrFormMsg'); if(el) el.textContent = txt; return; }
  const t = $('#ocrTxt'), b = $('#ocrBar');
  if(t) t.textContent = txt;
  if(b && frac != null) b.style.width = Math.round(Math.min(1, frac) * 100) + '%';
}
async function ocrRun(files){
  files = Array.from(files || []).filter(Boolean);
  if(!OCR || !files.length) return;
  const st = OCR, n = files.length, primera = typeof Tesseract === 'undefined';
  st.busy = true;
  if(st.mode === 'movs'){
    openInfo({kind: 'ocr'}, '📸 Leyendo tus movimientos', `<p class="hint" id="ocrTxt" data-testid="ocr-progreso" style="margin-bottom:8px">${primera ? 'Descargando el lector (solo la primera vez, ~4 MB)…' : `Leyendo foto 1 de ${n}…`}</p>
      <div class="bar"><i id="ocrBar" style="width:3%"></i></div><p class="hint" style="margin-top:10px">Todo se lee aquí en tu celular: la foto no se sube a ningún lado.</p>`,
      '<button type="button" class="btn b-gh" disabled>Leyendo…</button>');
  } else if(st.mode === 'ficha'){
    const it = get('items', st.itemId);
    openInfo({kind: 'ocr', id: st.itemId}, '📷 Leyendo ' + (it ? it.desc : 'la foto'), `<p class="hint" id="ocrTxt" data-testid="ocr-progreso" style="margin-bottom:8px">${primera ? 'Descargando el lector (solo la primera vez, ~4 MB)…' : `Leyendo foto 1 de ${n}…`}</p>
      <div class="bar"><i id="ocrBar" style="width:3%"></i></div><p class="hint" style="margin-top:10px">Todo se lee aquí en tu celular: la foto no se sube a ningún lado.</p>`,
      '<button type="button" class="btn b-gh" disabled>Leyendo…</button>');
  } else ocrMsg(primera ? 'Descargando el lector (solo la primera vez, ~4 MB)…' : `Leyendo foto 1 de ${n}…`);
  let r;
  try { r = await leerImagenes(files, ocrProgress(n, primera)); }
  catch(e){
    st.busy = false; OCR = null;
    const sin = navigator.onLine === false || /descargar|internet|network|fetch|load/i.test(String(e && e.message || e));
    toast(sin ? 'No pude descargar el lector de fotos. Revisa tu internet e intenta otra vez (después funciona sin señal).' : 'No pude leer la foto: ' + (e && e.message || e), {err: true, ms: 6000});
    if(st.mode === 'movs') closeInfo();
    else if(st.mode === 'ficha'){ if(get('items', st.itemId)) openFicha(st.itemId); else closeInfo(); } else { const m = $('#ocrFormMsg'); if(m) m.textContent = ''; }
    return;
  }
  st.busy = false; OCR = null;
  r = r || {};
  if(st.mode === 'form') ocrToForm(r);
  else if(st.mode === 'movs') openFotoMovs(r.texto || '', r);
  else ocrConfirm(st.itemId, r);
}
const OCR_KEYS = [['imei', 'IMEI'], ['imei2', 'IMEI 2'], ['bateria', 'Batería %'], ['almac', 'Almacenamiento'], ['serie', 'Número de serie']];
const ocrVal = (k, x) => x == null || x === '' ? '' : k === 'almac' ? almacTxt(String(x)) : String(x);
const ocrModelWarn = (r, desc) => {
  if(!r.modelo || !desc) return '';
  const a = normModelo(r.modelo), b = normModelo(desc);
  return a && b && a !== b ? `La foto parece de un ${r.modelo} y este producto es ${desc}: ¿seguro?` : '';
};
/* desde Compra / Editar: llena los campos del formulario */
function ocrToForm(r){
  if(!F) return;
  const got = [];
  OCR_KEYS.forEach(([k, l]) => { const x = ocrVal(k, r[k]); if(x && k in F.v){ setVal(k, x); F.touched[k] = true; got.push(l.replace(' %', '') + ' ' + x + (k === 'bateria' ? '%' : '')); } });
  refreshShow();
  const warn = ocrModelWarn(r, F.v.desc);
  const msg = $('#ocrFormMsg'); if(msg) msg.textContent = got.length ? '✅ ' + got.join(' · ') : '';
  if(got.length) toast('📷 Encontré: ' + got.join(' · ') + (warn ? ' — ' + warn : ''), {ms: 6000, err: !!warn});
  else toast('No encontré IMEI, batería ni almacenamiento en esa foto. Usa el pantallazo de Ajustes → General → Información.', {err: true, ms: 6000});
}
/* desde la ficha: hoja "Esto encontré" (cada dato editable y con su casilla) */
function ocrConfirm(itemId, r){
  const it = get('items', itemId);
  if(!it) return closeInfo();
  const found = OCR_KEYS.filter(([k]) => ocrVal(k, r[k]));
  const textoBtn = r.texto ? `<button type="button" class="btn b-gh full" style="margin-top:8px" data-a="ocrTexto" data-testid="ocr-ver-texto">Ver el texto que leí</button>
    <pre class="raw" id="ocrRaw" hidden data-testid="ocr-texto">${esc(r.texto)}</pre>` : '';
  if(!found.length){
    openInfo({kind: 'ocr', id: itemId}, '📷 No encontré datos', `<p data-testid="ocr-nada" style="margin-bottom:8px">No encontré IMEI, batería ni almacenamiento en ${r.texto ? 'esa foto' : 'esa foto (no pude leer texto)'}.</p>
      <p class="hint">${OCR_TIPS}</p>${textoBtn}`,
      `<button type="button" class="btn b-gh" data-a="ficha" data-id="${esc(itemId)}">Volver</button>
       <button type="button" class="btn b-b" data-a="ocrFicha" data-id="${esc(itemId)}">📷 Otra foto</button>`);
    return;
  }
  const warn = ocrModelWarn(r, it.desc);
  let b = warn ? `<div class="alert" style="--ac:var(--Y)" data-testid="ocr-modelo"><div class="alert-t" style="font-size:14px">🤔 ${esc(warn)}</div></div>` : '';
  b += `<p class="hint" style="margin-bottom:10px">Revisa y toca <b>Guardar</b>. Puedes corregir cualquier dato o quitarle la ✓.</p>`;
  b += found.map(([k, l]) => {
    const x = ocrVal(k, r[k]), antes = it[k] != null && it[k] !== '' ? String(it[k]) : '', igual = antes === x;
    return `<div class="ocrrow" data-testid="ocr-row" data-k="${k}"><label class="ocrchk"><input type="checkbox" id="ocr-on-${k}" data-testid="ocr-on-${k}"${igual ? '' : ' checked'}> <b>${esc(l)}</b>
      ${/^imei/.test(k) ? '<span class="tag t-g">✅ IMEI válido</span>' : ''}${igual ? '<span class="tag t-n">ya lo tenías</span>' : ''}</label>
      <input class="in${/^imei|bateria/.test(k) ? ' mono' : ''}" id="ocr-v-${k}" data-testid="ocr-v-${k}" type="text" ${/^imei|bateria/.test(k) ? 'inputmode="numeric"' : ''} autocomplete="off" value="${esc(x)}">
      ${antes && !igual ? `<span class="note" data-testid="ocr-antes-${k}">antes: ${esc(antes)}${k === 'bateria' ? '%' : ''}</span>` : ''}</div>`;
  }).join('') + textoBtn;
  openInfo({kind: 'ocr', id: itemId, r}, '📷 Esto encontré', b,
    `<button type="button" class="btn b-gh" data-a="ficha" data-id="${esc(itemId)}" data-testid="ocr-cancel">Cancelar</button>
     <button type="button" class="btn b-g" data-a="ocrGuardar" data-id="${esc(itemId)}" data-testid="ocr-save">Guardar</button>`);
}
function ocrGuardar(itemId){
  const it = get('items', itemId);
  if(!it) return closeInfo();
  const o = {}, done = [];
  for(const [k, l] of OCR_KEYS){
    const on = $('#ocr-on-' + k), inp = $('#ocr-v-' + k);
    if(!on || !inp || !on.checked) continue;
    let x = clean(inp.value);
    if(!x) continue;
    if(/^imei/.test(k)){ x = x.replace(/\D/g, ''); if(x.length !== 15){ toast('El ' + l + ' debe tener 15 dígitos', {err: true}); inp.focus(); return; } }
    if(k === 'bateria'){ const n = bateriaNum(x); if(isNaN(n) || n < 0 || n > 100){ toast('La batería va de 0 a 100 %', {err: true}); inp.focus(); return; } o[k] = n; done.push('🔋 ' + n + '%'); continue; }
    if(k === 'almac') x = almacTxt(x);
    o[k] = x; done.push(k === 'almac' ? x : k === 'serie' ? 'serie' : l);
  }
  if(!done.length) return toast('Marca al menos un dato para guardar', {err: true});
  put('items', Object.assign({}, it, o));
  openFicha(itemId);
  commit('📷 ' + it.desc + ': ' + done.join(' · '));
}

/* ═════════ 3. FORMULARIOS (motor genérico + tipos) ═════════ */
let SHEET = null;  // qué muestra la hoja: 'form' | 'lote' | null
let LOTE = null;   // lote de "Esto entendí": {ops:[{kind,d}], fromQuick, touched}
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
  } else if(f.type === 'fondo'){                      // §13.4: chip compacto "Plata de: 💼 Negocio ▾"
    inp = `<div class="fchip" ${common} data-k="${f.k}"><button type="button" class="fchip-b" data-fondo-toggle aria-expanded="false" data-testid="${id}-chip">Plata de: <b>${esc(juntos() && (FONDO_BASE.includes(val) || val === LIBRE) ? LIBRE_NOM : fnName(val))}</b> <span aria-hidden="true">▾</span></button>
      <div class="opts" data-k="${f.k}" hidden>${opts.map(([o, l]) =>
      `<button type="button" class="${String(o) === String(val) || (o === LIBRE && FONDO_BASE.includes(val)) ? 'on' : ''}" data-v="${esc(o)}" data-testid="${id}-${esc(o)}">${esc(l)}</button>`).join('')}</div></div>`;
  } else if(f.type === 'select' || (f.type === 'seg' && opts.length > 5 && !f.chips)){
    inp = `<select class="in" ${common}>${opts.map(([o, l]) => `<option value="${esc(o)}"${String(o) === String(val) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  } else if(f.type === 'seg'){
    inp = `<div class="opts" ${common} data-k="${f.k}" role="radiogroup">${opts.map(([o, l]) =>
      `<button type="button" role="radio" aria-checked="${String(o) === String(val)}" class="${String(o) === String(val) ? 'on' : ''}" data-v="${esc(o)}" data-testid="${id}-${esc(o || 'ninguno')}">${esc(l)}</button>`).join('')}</div>`;
  } else if(f.type === 'tel'){
    inp = `<input class="in" ${common} type="tel" inputmode="tel" autocomplete="off" placeholder="${esc(f.ph || '300 123 4567')}" value="${esc(val)}">`;
  } else if(f.type === 'info'){
    inp = `<div class="hint">${f.html || ''}</div>`;
  } else if(f.type === 'ref'){                        // §14.4: referencia de precios dentro del formulario
    inp = `<div class="refbox" ${common}></div>`;
  } else if(f.type === 'ocrbtn'){                     // ronda 6: leer IMEI/batería/almacenamiento de un pantallazo
    return `<div class="fld" data-fk="${f.k}"><button type="button" class="btn b-b full" data-a="ocrForm" data-testid="ocr-form">📷 Leer datos de una foto</button>
      <span class="note" id="ocrFormMsg" data-testid="ocr-form-msg"></span></div>`;
  } else if(f.type === 'fold'){                       // sección plegable ("Datos del equipo")
    return `<div class="fld" data-fk="${f.k}"><button type="button" class="fold" ${common} data-fold="${f.k}" aria-expanded="${val ? 'true' : 'false'}">${esc(f.text)} <span aria-hidden="true">${val ? '▴' : '▾'}</span></button></div>`;
  } else {
    inp = `<input class="in" ${common} type="text" autocomplete="off" autocapitalize="${f.cap || 'sentences'}"${f.list ? ` list="${f.list}"` : ''}${f.im ? ` inputmode="${f.im}"` : ''} placeholder="${esc(f.ph || '')}" value="${esc(val)}">`;
  }
  return `<div class="fld" data-fk="${f.k}">${f.label ? `<label for="${id}">${esc(f.label)}</label>` : ''}${inp}${f.note ? `<span class="note">${f.note}</span>` : ''}</div>`;
}

function openForm(kind, d, opts){
  const spec = FORMS[kind];
  if(!spec) return;
  opts = opts || {};
  d = Object.assign({}, d || {});
  if(d.fondo != null && !fondoValid(d.fondo)) delete d.fondo;      // apartado del parser/registro que ya no existe → por defecto
  if(spec.prep) spec.prep(d);
  let fields = spec.fields(d);
  if(juntos() && !fondosExtra().length) fields = fields.filter(f => f.type !== 'fondo');
  const v = {};
  fields.forEach(f => { let x = d[f.k]; if(x === undefined || x === null) x = f.val !== undefined ? f.val : ''; v[f.k] = x; });
  const fondoFixed = !!d.fondo;
  if(fields.some(f => f.k === 'fondo')) v.fondo = fondoFixed ? d.fondo : fondoAuto(kind, v, d);
  const fromQuick = !!opts.fromQuick, lote = opts.lote != null ? opts.lote : null;
  F = {kind, spec, d, v, fields, touched: {}, fromQuick, lote, fondoFixed, back: opts.back || null,
    parsed: opts.parsed || null, qtext: opts.qtext || '', v0: Object.assign({}, v)};
  SHEET = 'form'; INFO = null;
  $('#sheetTitle').textContent = typeof spec.title === 'function' ? spec.title(d) : spec.title;
  const ks = fromQuick && lote == null && !d._pend && KSWITCH.some(x => x[0] === kind)
    ? `<div class="kswitch" data-testid="kswitch"><span>¿Es otra cosa?</span>${KSWITCH.filter(x => x[0] !== kind).map(([k, i, l]) =>
      `<button type="button" class="chip" data-a="kswitch" data-k="${k}" data-testid="kswitch-${k}">${i} ${esc(l)}</button>`).join('')}</div>` : '';
  $('#sheetBody').innerHTML = ks + (spec.intro ? spec.intro(d) : '') + fields.map(fieldHTML).join('');
  $('#sheetFoot').innerHTML = (spec.del && d.id ? '<button type="button" class="btn b-r" data-a="formDel" data-testid="form-del">🗑️</button>' : '') +
    (spec.extra ? spec.extra(d) : '') +
    (spec.extra && spec.extra(d) ? '' : '<button type="button" class="btn b-gh" data-a="formClose" data-testid="form-cancel">Cancelar</button>') +
    `<button type="submit" class="btn b-g" data-testid="form-save">${esc(spec.saveLabel || 'Guardar')}</button>`;
  if(fields.some(f => f.list === 'dl-contactos')) $('#sheetBody').insertAdjacentHTML('beforeend',
    `<datalist id="dl-contactos">${contactos().map(c => `<option value="${esc(c.nombre)}"></option>`).join('')}</datalist>`);
  fields.forEach(f => { if(f.type === 'money') moneyEq(f.k); });
  updateRef();
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
  const backToLote = !!(F && F.lote != null && LOTE), back = F && F.back;
  F = null; SHEET = null;
  if(backToLote){ openLote(); return; }
  if(back){ back(); if(SHEET) return; }
  const sh = $('#sheet');
  sh.classList.remove('on'); sh.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if(document.activeElement && sh.contains(document.activeElement)) document.activeElement.blur();
  setTimeout(() => { if(!SHEET){ $('#sheetBody').innerHTML = ''; $('#sheetFoot').innerHTML = ''; $('#sheetTitle').textContent = ''; } }, 220);
}
/* cierra lo que esté abierto en la hoja (formulario o lote) */
function closeSheet(){ if(F) closeForm(); else if(LOTE) closeLote(); else if(INFO) closeInfo(); }

const fieldVisible = f => !f.show || !!f.show(F.v);
/* línea "Lo has comprado 3 veces, prom. $2.1M · lo vendes en ~$2.6M (sugerido)"; tocar → detalle con "Usar" */
function refQuery(){
  if(!F) return '';
  const v = F.v;
  if(F.kind === 'venta'){
    if(v.itemId === '__nuevo') return clean(v.desc);
    if(v.itemId === '__prev') return clean(F.d.desc);
    const it = v.itemId ? get('items', v.itemId) : null;
    return it ? it.desc : '';
  }
  return clean(v.desc);
}
function updateRef(){
  if(!F || !F.fields.some(f => f.type === 'ref')) return;
  const box = $('#f-_ref'), q = refQuery(), r = q.length >= 2 ? priceRef(DB, q) : null;
  F.v._ref = r ? '1' : '';
  if(box){
    const use = F.kind === 'venta' ? ['sellPrice', 'Usar ' + (r && r.sugeridoVenta ? full(r.sugeridoVenta) : '')] : ['targetPrice', 'Usar como precio meta'];
    box.innerHTML = r ? `<button type="button" class="refline" data-ref-toggle aria-expanded="false" data-testid="f-ref-line">📊 ${esc(refLine(r) || 'Ver referencia de ' + r.modelo)} <span aria-hidden="true">▾</span></button>
      <div class="refdet" hidden data-testid="f-ref-det">${refStatsHTML(r)}${r.sugeridoVenta ? `<button type="button" class="btn b-b full" data-ref-use="${use[0]}" data-v="${r.sugeridoVenta}" data-testid="f-ref-usar">${esc(use[1])}</button>` : ''}</div>` : '';
  }
  refreshShow();
}
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
  if(el.classList.contains('fchip')){
    $$('.opts button', el).forEach(b => b.classList.toggle('on', b.dataset.v === String(val)));
    const lb = $('.fchip-b b', el); if(lb) lb.textContent = fnName(val);
  }
  else if(el.classList.contains('opts')) $$('button', el).forEach(b => { const on = b.dataset.v === String(val); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  else if(el.classList.contains('money')){ el.value = val === '' || val == null ? '' : miles(val); moneyEq(k); }
  else el.value = val == null ? '' : val;
}
function onField(k){
  if(!F) return;
  F.touched[k] = true;
  if(F.spec.change) F.spec.change(k, F.v, setVal, F);
  if(k === 'desc' || k === 'itemId') updateRef();
  if(k !== 'fondo' && 'fondo' in F.v && !F.touched.fondo && !F.fondoFixed){ const a = fondoAuto(F.kind, F.v, F.d); if(a !== F.v.fondo) setVal('fondo', a); }
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
  if(F.lote != null && LOTE && LOTE.ops[F.lote]){       // editar una tarjeta del lote: no guarda todavía
    const op = LOTE.ops[F.lote];
    op.d = Object.assign({}, F.d, F.v);
    if(!F.touched.fondo && !F.fondoFixed) delete op.d.fondo;       // el apartado solo cuenta si lo eligió
    LOTE.touched[F.lote] = true;
    closeForm();
    return;
  }
  let res;
  try { res = F.spec.save(F.v, F.d, F) || {}; }
  catch(e){ console.error(e); toast('No pude guardar: ' + (e && e.message || e), {err: true}); return; }
  if(res.err){
    toast(res.err, {err: true});
    if(res.k){ const el = $('#f-' + res.k); if(el && el.focus) el.focus(); }
    return;
  }
  const d = F.d, kind = F.kind, fromQuick = F.fromQuick;
  let msg = res.msg;
  if(fromQuick && F.parsed){                                       // §12.3: aprende de lo que corrigió
    const r = learnFrom({kind, v: F.v, v0: F.v0, parsed: F.parsed, qtext: F.qtext, fondoTouched: !!F.touched.fondo});
    if(r && msg) msg += ' · 🧠 aprendí “' + r.palabra + '”';
  }
  if(fromQuick && F.qtext && res.rec) iaRecordar(F.qtext, [{kind, d: res.rec}]);
  if(d._pend){
    const p = get('pend', d._pend);
    if(p){ learnRule(p, kind, res.rec || {}); remove('pend', p.id); }
  }
  if(fromQuick){ const q = $('#qInput'); if(q) q.value = ''; }
  closeForm();
  if(res.after) res.after();
  commit(msg, res.toast);
}

/* Regla aprendida: quien → cómo se clasificó (solo gasto/ingreso/transfer y con quien no vacío, §10.4) */
function learnRule(p, kind, rec){
  if(!['gasto', 'ingreso', 'transfer'].includes(kind)) return;
  const k = quienKey(p.quien);
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

const venderOpts = d => [['', '— Elige —']].concat(d && d.itemId === '__prev' ? [['__prev', (d.desc || 'Producto') + ' (lo de esta frase)']] : []).concat(stockItems().sort((a, b) => String(a.desc).localeCompare(String(b.desc)))
  .map(i => [i.id, i.desc + ' · costó ' + fmt(i.buyPrice)])).concat([['__nuevo', '➕ Producto no registrado']]);

/* ── Apartado en los formularios (§13.4) ──
   El chip muestra fondoDe(); el registro guarda `fondo` SOLO si el usuario lo cambió o si vino explícito (parser / registro). */
const withFondo = (rec, fondo) => { if(fondo) rec.fondo = fondo; return rec; };
function fondoPick(v, d, f){
  if(f && f.touched && f.touched.fondo) return fondoValid(v.fondo) ? v.fondo : undefined;
  return d && fondoValid(d.fondo) ? d.fondo : undefined;
}
function fondoAuto(kind, v, d){
  const it = id => (id && get('items', id)) || {};
  switch(kind){
    case 'compra': return fondoDe('items', {}, DB);
    case 'editItem': return fondoDe('items', it(d.id), DB);
    case 'venta': return fondoDe('items', v.itemId && v.itemId !== '__nuevo' && v.itemId !== '__prev' ? it(v.itemId) : {}, DB);
    case 'gasto': return fondoDe('gastos', {tipo: v.tipo}, DB);
    case 'cobro': return fondoDe('cobros', d.id ? Object.assign({}, get('cobros', d.id) || {}, {fondo: ''}) : {itemId: d.itemId}, DB);
    case 'abono': return fondoDe('abonos', {cobroId: v.cobroId}, DB);
    default: return fondoDe(kind === 'ingreso' ? 'ingresos' : 'ajustes', {}, DB);
  }
}

/* ── "¿Es otra cosa?" (solo desde el registro rápido): cambia el tipo sin reescribir la frase ── */
const KSWITCH = [['compra', '🛒', 'Compra'], ['venta', '💰', 'Venta'], ['gasto', '💸', 'Gasto'], ['ingreso', '➕', 'Ingreso'],
  ['cobro', '🤝', 'Me deben'], ['abono', '💵', 'Abono'], ['transfer', '🔁', 'Mover'], ['reparto', '🔀', 'Repartir']];
const K_MONEY = {compra: 'buyPrice', venta: 'sellPrice', gasto: 'valor', ingreso: 'valor', cobro: 'total', abono: 'monto', transfer: 'monto', reparto: 'monto'};
const K_DATE = {compra: 'buyDate', venta: 'sellDate', gasto: 'fecha', ingreso: 'fecha', cobro: 'fecha', abono: 'fecha', transfer: 'fecha', reparto: 'fecha'};
const K_POCKET = {compra: 'buyPocket', venta: 'sellPocket', gasto: 'bolsillo', ingreso: 'bolsillo', abono: 'bolsillo', transfer: 'from'};
function switchKind(k){
  if(!F || !FORMS[k] || k === F.kind) return;
  F.fields.forEach(f => { if(f.type === 'money'){ const el = $('#f-' + f.k); if(el) F.v[f.k] = el.value.trim() === '' ? '' : parseMoney(el.value); } });
  const v = F.v, d = F.d, from = F.kind, n = {};
  let desc = clean(v.desc || v.nombre || d.desc || d._nombre || '');
  if(from === 'venta' && v.itemId && !['__nuevo', '__prev'].includes(v.itemId)){ const it = get('items', v.itemId); if(it) desc = it.desc; }
  const monto = num(v[K_MONEY[from]]);
  if(monto) n[K_MONEY[k]] = monto;
  n[K_DATE[k]] = v[K_DATE[from]] || d[K_DATE[from]] || today();
  const pk = K_POCKET[from] && v[K_POCKET[from]];
  if(pk && K_POCKET[k] && pockets().some(p => p.id === pk)) n[K_POCKET[k]] = pk;
  if(F.touched.fondo || F.fondoFixed) n.fondo = v.fondo;
  if(k === 'compra' || k === 'gasto' || k === 'ingreso') n.desc = desc;
  else if(k === 'venta'){ const it = desc ? bestMatch(desc, stockItems(), i => i.desc) : null; if(it) n.itemId = it.id; else if(desc){ n.itemId = '__nuevo'; n.desc = desc; } }
  else if(k === 'cobro') n.nombre = titleCase(desc);
  else if(k === 'abono'){ const c = desc ? bestMatch(desc, cobrosPend(DB), x => x.nombre) : null; if(c) n.cobroId = c.id; else if(desc) n._nombre = titleCase(desc); }
  openForm(k, n, {fromQuick: true, parsed: F.parsed, qtext: F.qtext});
}

/* ── Aprende de tus correcciones (§12.3) ──
   Compara lo que propuso el registro rápido (lo que el usuario VIO al abrir) con lo que guardó. Por cada corrección de
   categoría / tipo / bolsillo / apartado / clase de movimiento guarda en `reglas` {id:'q:'+palabra, kind:'quick', palabra, …}.
   La palabra es el sustantivo principal de la descripción ("domicilio"), nunca un número, verbo, relleno, bolsillo o apartado.
   Decisiones: el bolsillo solo se aprende en gastos e ingresos y solo si la frase NO lo decía; en compras solo la categoría
   (el bolsillo de un producto varía); ventas, cobros y abonos no aprenden campos (su "palabra" es un producto o una persona). */
const LEARN_FIELDS = {gasto: {cat: 'cat', tipo: 'tipo', bolsillo: 'bolsillo', fondo: 'fondo'}, ingreso: {bolsillo: 'bolsillo', fondo: 'fondo'}, compra: {cat: 'cat', fondo: 'fondo'}};
const LEARN_STOP = new Set(('de del el la los las lo un una unos unas en por con sin a al para pa mi mis me le les y o que se su sus tu te ya hoy ayer antier anteayer ' +
  'manana lunes martes miercoles jueves viernes sabado domingo pasado semana dia dias hace mes este esta eso esa otro otra mas ' +
  'mil k lucas luca palos palo millon millones melon melones pesos peso pesitos barras barra plata efectivo cash fisico billete nequi neki nequy ' +
  'transferencia consignacion compre compra compras compro comprar vendi vende venta ventas vendido vender gaste gasto gastos gastar pague pague pago pagos ' +
  'pagar pagado pagaron ingreso ingresos recibi gane abono abonos abono abonaron debe debo preste prestamo fiado fiao retire saque pase movi transferi ' +
  'negocio personal aparte separe guarde reserve meti total valor precio costo').split(' '));
function palabraClave(parsedD, text){
  const stop = new Set(LEARN_STOP);
  pockets().concat(fondos()).forEach(x => [x.nombre].concat(x.alias || []).forEach(a => normKey(a).split(' ').forEach(w => stop.add(w))));
  const ok = w => w.length >= 3 && /[a-z]/.test(w) && !/^\d/.test(w) && !stop.has(w);
  const desde = s => normKey(s).split(' ').find(ok) || '';
  return desde((parsedD && (parsedD.desc || '')) || '') || desde(text || '');
}
function learnFrom(o){
  if(!o || !o.parsed) return null;
  const pk = o.parsed.kind, pd = o.parsed.d || {}, diffs = {};
  const map = LEARN_FIELDS[o.kind] || {};
  Object.keys(map).forEach(rf => {
    const fk = map[rf], sv = o.v[fk];
    if(sv == null || sv === '') return;
    const ppk = K_POCKET[pk] || K_POCKET[o.kind];
    if(rf === 'bolsillo' && pd[ppk] != null && pd[ppk] !== '') return;   // la frase ya lo decía
    if(rf === 'fondo' && !o.fondoTouched) return;
    if(String(sv) !== String(o.v0[fk] == null ? '' : o.v0[fk])) diffs[rf] = sv;
  });
  if(pk && pk !== o.kind && ['compra', 'venta', 'gasto', 'ingreso', 'cobro', 'abono', 'transfer', 'reparto'].includes(o.kind)) diffs.gkind = o.kind;
  if(!Object.keys(diffs).length) return null;
  const palabra = palabraClave(pd, o.qtext);
  if(!palabra) return null;
  const id = 'q:' + normKey(palabra), prev = L(DB, 'reglas').find(r => r.id === id && r.kind === 'quick');
  const rec = Object.assign({}, prev || {}, {id, kind: 'quick', palabra}, diffs);
  if(diffs.gkind === undefined && prev && prev.gkind && prev.gkind !== o.kind) delete rec.gkind;   // la clase que guardó manda
  return put('reglas', rec);
}
/* "domicilio → Envíos · negocio · Efectivo · 💼 Negocio" */
const KIND_TXT = {compra: 'compra', venta: 'venta', gasto: 'gasto', ingreso: 'ingreso', cobro: 'me deben', abono: 'abono', transfer: 'mover', reparto: 'repartir'};
const quickRuleTxt = r => [r.gkind ? 'es ' + (KIND_TXT[r.gkind] || r.gkind) : '', r.cat || '', r.tipo || '', r.bolsillo ? pn(r.bolsillo) : '', r.fondo ? fnName(r.fondo) : '']
  .filter(Boolean).join(' · ');

/* §14.4: campos compartidos de compra / edición */
const eqShow = v => !!v._equipo;
const EQ_FIELDS = () => [
  {k: '_equipo', type: 'fold', text: '📱 Datos del equipo (IMEI, batería, almacenamiento, color)'},
  {k: '_ocr', type: 'ocrbtn', show: eqShow},
  {k: 'imei', label: 'IMEI (opcional)', type: 'text', im: 'numeric', cap: 'off', ph: '15 dígitos (*#06#)', show: eqShow},
  {k: 'imei2', label: 'IMEI 2', type: 'text', im: 'numeric', cap: 'off', ph: 'Si tiene doble SIM', show: v => eqShow(v) && !!clean(v.imei2)},
  {k: 'bateria', label: 'Batería %', type: 'text', im: 'numeric', ph: 'Ej: 89', show: eqShow},
  {k: 'almac', label: 'Almacenamiento', type: 'text', cap: 'off', ph: 'Ej: 128GB', show: eqShow},
  {k: 'color', label: 'Color', type: 'text', ph: 'Ej: Azul', show: eqShow},
  {k: 'serie', label: 'Número de serie', type: 'text', cap: 'characters', ph: 'Opcional', show: v => eqShow(v) && !!clean(v.serie)}
];
const prepEquipo = d => { if(!d._equipo && ['imei', 'imei2', 'bateria', 'almac', 'color', 'serie'].some(k => d[k] != null && d[k] !== '')) d._equipo = '1'; };
const CONTACT_FIELDS = (k, label, ph) => [
  {k, label, type: 'text', list: 'dl-contactos', cap: 'words', ph},
  {k: k + 'Nuevo', label: '¿Lo guardo en tus contactos?', type: 'seg', val: 'no', opts: [['no', 'No'], ['si', 'Sí, guardarlo']], show: v => !!clean(v[k]) && !contactoPor(v[k])}
];
const REF_FIELD = {k: '_ref', type: 'ref', show: v => !!v._ref};
const gastoItemOpts = d => [['', 'No']].concat(stockItems().sort((a, b) => String(a.desc).localeCompare(String(b.desc))).map(i => [i.id, i.desc]))
  .concat(d && d.itemId && !stockItems().some(i => i.id === d.itemId) && get('items', d.itemId) ? [[d.itemId, get('items', d.itemId).desc + ' (vendido)']] : []);

const topeNombre = t => t.cat === '__personal' ? 'todo lo personal' : t.cat;

const FONDO_EMOJIS = ['🏠', '🐷', '🚗', '🎓', '✈️', '🎁', '📱', '🏥', '💡', '🎯'];

const FORMS = {
  compra: {
    title: '🛒 Compré',
    prep: d => { if(!d.buyDate) d.buyDate = d.fecha || today(); if(d.buyPocket === undefined) d.buyPocket = defPocket(); if(!d.cond) d.cond = 'bueno'; if(!d.cat) d.cat = d.desc ? guessCat(d.desc) : 'Otro';
      if(d.proveedorId && !d.proveedor){ const c = get('contactos', d.proveedorId); if(c) d.proveedor = c.nombre; }
      prepEquipo(d); },
    fields: () => [
      {k: 'desc', label: 'Producto', type: 'text', ph: 'Ej: PS5 Slim 1TB', req: 1},
      REF_FIELD,
      {k: 'cat', label: 'Categoría', type: 'select', opts: CATS.map(c => [c, c])},
      {k: 'buyPrice', label: '¿Cuánto te costó?', type: 'money', req: 1, ph: 'Ej: 1.2M o 350.000'},
      {k: 'buyPocket', label: '¿De dónde salió la plata?', type: 'seg', opts: pocketOpts().concat([POCKET_NONE])},
      {k: 'fondo', type: 'fondo', opts: fondoOpts()},
      {k: 'buyDate', label: 'Fecha', type: 'date'},
      {k: 'targetPrice', label: 'Precio meta (opcional)', type: 'money', ph: '¿En cuánto lo quieres vender?'},
      ...CONTACT_FIELDS('proveedor', '¿A quién se lo compraste? (opcional)', 'Ej: Andrés del centro'),
      {k: 'cond', label: 'Estado', type: 'seg', opts: [['nuevo', 'Nuevo'], ['bueno', 'Bueno'], ['regular', 'Regular']]},
      ...EQ_FIELDS(),
      {k: 'notes', label: 'Notas (opcional)', type: 'text', ph: 'Detalles, accesorios…'}
    ],
    change: (k, v, set, F) => { if(k === 'desc' && !F.touched.cat) set('cat', guessCat(v.desc)); },
    save: (v, d, Fx) => {
      const desc = clean(v.desc), p = num(v.buyPrice);
      if(!desc) return {err: 'Escribe qué compraste', k: 'desc'};
      if(p <= 0) return {err: '¿Cuánto te costó?', k: 'buyPrice'};
      const ee = equipoErr(v); if(ee) return ee;
      const prov = linkContacto(v.proveedor, v.proveedorNuevo, 'proveedor');
      const rec = put('items', withFondo(Object.assign({desc, cat: v.cat || guessCat(desc), cond: v.cond || 'bueno', notes: clean(v.notes), buyPrice: p, buyPocket: v.buyPocket || '',
        buyDate: v.buyDate || today(), targetPrice: num(v.targetPrice) || null, status: 'stock'}, equipoDe(v),
        prov.nombre ? {proveedor: prov.nombre} : {}, prov.id ? {proveedorId: prov.id} : {}), fondoPick(v, d, Fx)));
      return {rec, msg: `📦 ${desc} en stock · ${full(p)}`};
    }
  },

  venta: {
    title: '💰 Vendí',
    prep: d => {
      if(!d.sellDate) d.sellDate = d.fecha || today();
      if(d.sellPocket === undefined) d.sellPocket = defPocket();
      if(!d.completo) d.completo = 'si';
      if(d.itemId === undefined) d.itemId = '';
      if(d.tradeIn){ d.parte = 'si'; d.tiDesc = d.tradeIn.desc || ''; d.tiValor = +d.tradeIn.valor || ''; d.tiCat = d.tradeIn.cat || guessCat(d.tiDesc); delete d.tradeIn; }
      if(!d.parte) d.parte = 'no';
      if(!d.tiCat) d.tiCat = d.tiDesc ? guessCat(d.tiDesc) : 'Otro';
      if(d.itemId && d.itemId !== '__nuevo' && d.itemId !== '__prev' && !d.sellPrice){ const it = get('items', d.itemId); if(it && it.targetPrice) d.sellPrice = +it.targetPrice; }
      if(d.itemId === '__nuevo' && !d.cat) d.cat = d.desc ? guessCat(d.desc) : 'Otro';
      if(d.clienteId && !d.cliente){ const c = get('contactos', d.clienteId); if(c) d.cliente = c.nombre; }
    },
    intro: d => stockItems().length || d.itemId ? '' : '<p class="hint" style="margin-bottom:10px">No tienes productos en stock: elige <b>➕ Producto no registrado</b>.</p>',
    fields: d => {
      const nuevo = v => v.itemId === '__nuevo', fiado = v => v.completo === 'no', parte = v => v.parte === 'si';
      return [
        {k: 'itemId', label: 'Producto', type: 'select', opts: venderOpts(d), req: 1},
        REF_FIELD,
        {k: 'desc', label: 'Nombre del producto', type: 'text', ph: 'Ej: Tenis Jordan 1', show: nuevo},
        {k: 'buyPrice', label: '¿Cuánto te costó?', type: 'money', show: nuevo, note: 'Para calcular tu ganancia. No se descuenta de tus bolsillos.'},
        {k: 'cat', label: 'Categoría', type: 'select', opts: CATS.map(c => [c, c]), show: nuevo},
        {k: 'sellPrice', label: 'Precio de venta (en plata)', type: 'money', ph: 'Ej: 1.5M'},
        {k: 'parte', label: '¿Recibiste algo como parte de pago?', type: 'seg', opts: [['no', 'No'], ['si', 'Sí, un producto']]},
        {k: 'tiDesc', label: 'Producto que recibiste', type: 'text', ph: 'Ej: iPhone 16 Pro Max', show: parte},
        {k: 'tiCat', label: 'Categoría de lo que recibiste', type: 'select', opts: CATS.map(c => [c, c]), show: parte},
        {k: 'tiValor', label: '¿En cuánto lo valoras?', type: 'money', show: parte, ph: 'Ej: 2.100.000',
          note: 'La venta total = plata + este valor. Entra a tu stock con este costo, sin salir de tus bolsillos.'},
        {k: 'completo', label: '¿Te pagó completa la plata?', type: 'seg', opts: [['si', 'Sí, todo'], ['no', 'No, quedó debiendo']]},
        {k: 'sellPaid', label: '¿Cuánto te pagó ya?', type: 'money', show: fiado, ph: '0 si no pagó nada'},
        ...CONTACT_FIELDS('cliente', '¿A quién se lo vendiste?', 'Ej: Juan Pérez (opcional si pagó todo)'),
        {k: 'tel', label: 'Celular (opcional)', type: 'tel', show: fiado},
        {k: 'compromiso', label: '¿Cuándo te paga? (opcional)', type: 'date', show: fiado},
        {k: 'sellPocket', label: '¿A dónde entró la plata?', type: 'seg', opts: pocketOpts(), show: v => fiado(v) ? num(v.sellPaid) > 0 : num(v.sellPrice) > 0},
        {k: 'fondo', type: 'fondo', opts: fondoOpts()},
        {k: 'sellDate', label: 'Fecha', type: 'date'},
        {k: 'sellNotes', label: 'Nota (opcional)', type: 'text'}
      ];
    },
    change: (k, v, set, F) => {
      if(k === 'itemId' && v.itemId && v.itemId !== '__nuevo' && !F.touched.sellPrice){ const it = get('items', v.itemId); if(it && it.targetPrice) set('sellPrice', +it.targetPrice); }
      if(k === 'desc' && !F.touched.cat) set('cat', guessCat(v.desc));
      if(k === 'tiDesc' && !F.touched.tiCat) set('tiCat', guessCat(v.tiDesc));
    },
    save: (v, d, Fx) => {
      let it;
      const fondo = fondoPick(v, d, Fx);
      if(!v.itemId) return {err: 'Elige el producto que vendiste', k: 'itemId'};
      const sp = num(v.sellPrice);                                  // plata acordada
      const parte = v.parte === 'si', V = parte ? num(v.tiValor) : 0, tiDesc = clean(v.tiDesc);
      if(parte && !tiDesc) return {err: '¿Qué producto recibiste como parte de pago?', k: 'tiDesc'};
      if(parte && V <= 0) return {err: '¿En cuánto valoras lo que recibiste?', k: 'tiValor'};
      if(sp < 0 || sp + V <= 0) return {err: '¿En cuánto lo vendiste?', k: 'sellPrice'};
      if(v.itemId === '__nuevo'){
        const desc = clean(v.desc);
        if(!desc) return {err: 'Escribe el nombre del producto', k: 'desc'};
        if(num(v.buyPrice) <= 0) return {err: '¿Cuánto te costó? (para tu ganancia)', k: 'buyPrice'};
        it = {id: uid(), desc, cat: v.cat || guessCat(desc), cond: 'bueno', notes: '', buyPrice: num(v.buyPrice), buyPocket: '', buyDate: v.sellDate || today(), targetPrice: null};
      } else {
        it = get('items', v.itemId);
        if(!it) return {err: 'Ese producto ya no está en stock', k: 'itemId'};
      }
      const fiado = v.completo === 'no';
      const paid = fiado ? Math.min(num(v.sellPaid), sp) : sp;
      const cliente = clean(v.cliente);
      if(fiado && paid < sp && !cliente) return {err: '¿Quién te quedó debiendo?', k: 'cliente'};
      if(paid > 0 && !v.sellPocket && d && d._lote) return {err: '¿A dónde entró la plata de la venta?', k: 'sellPocket'};
      const pocket = v.sellPocket || defPocket();
      const fecha = v.sellDate || today();
      const venta = withFondo(Object.assign({}, it, {status: 'sold', sellPrice: sp + V, sellPaid: paid, sellPocket: pocket, sellDate: fecha, sellNotes: clean(v.sellNotes)}), fondo);
      delete venta.tradeInId; delete venta.tradeInValor; delete venta.cliente; delete venta.clienteId;
      const cl = cliente ? linkContacto(cliente, v.clienteNuevo, 'cliente') : {};      // §14.4: a quién se lo vendiste
      if(cl.nombre) venta.cliente = cl.nombre;
      if(cl.id){ venta.clienteId = cl.id; const c = get('contactos', cl.id); if(c && !c.tel && clean(v.tel)) put('contactos', Object.assign({}, c, {tel: clean(v.tel)})); }
      let recibido = null;
      if(parte){
        recibido = {id: uid(), desc: tiDesc, cat: v.tiCat || guessCat(tiDesc), cond: 'bueno', notes: 'Parte de pago por ' + it.desc, buyPrice: V, buyPocket: '',
          buyDate: fecha, targetPrice: null, status: 'stock', fromTradeOf: venta.id};
        if(venta.fondo) recibido.fondo = venta.fondo;               // lo recibido es del mismo apartado que la venta
        venta.tradeInId = recibido.id; venta.tradeInValor = V;
      }
      const rec = put('items', venta);
      if(recibido) put('items', recibido);
      let extra = '';
      if(paid < sp){
        put('cobros', withFondo(Object.assign({nombre: titleCase(cliente), tel: clean(v.tel), total: sp - paid, pagado: 0, bolsillo: '', fecha,
          compromiso: v.compromiso || '', notas: 'Venta: ' + it.desc, itemId: rec.id}, cl.id ? {contactoId: cl.id} : {}), venta.fondo));
        extra = ` · ${titleCase(cliente)} te debe ${full(sp - paid)}`;
      }
      if(recibido) extra += ` · ${recibido.desc} entró al stock`;
      const g = sp + V - costoReal(it);                         // ganancia REAL: costo + arreglos ligados
      return {rec, recibido, g, msg: `💰 ¡Vendido! Ganancia ${full(g)}${extra}`};
    }
  },

  editItem: {
    title: '✏️ Editar producto',
    prep: d => {
      if(d.proveedorId){ const c = get('contactos', d.proveedorId); if(c) d.proveedor = c.nombre; }
      if(d.clienteId){ const c = get('contactos', d.clienteId); if(c) d.cliente = c.nombre; }
      prepEquipo(d);
    },
    fields: d => {
      const f = [
        {k: 'desc', label: 'Producto', type: 'text', req: 1},
        {k: 'cat', label: 'Categoría', type: 'select', opts: CATS.map(c => [c, c])},
        {k: 'cond', label: 'Estado', type: 'seg', opts: [['nuevo', 'Nuevo'], ['bueno', 'Bueno'], ['regular', 'Regular']]},
        {k: 'buyPrice', label: 'Costo', type: 'money', req: 1},
        {k: 'buyPocket', label: '¿De dónde salió la plata?', type: 'seg', opts: pocketOpts().concat([POCKET_NONE])},
        {k: 'fondo', type: 'fondo', opts: fondoOpts()},
        {k: 'buyDate', label: 'Fecha de compra', type: 'date'}
      ];
      if(d.status === 'sold') f.push(
        {k: 'sellPrice', label: d.tradeInValor ? 'Precio de venta total (plata + parte de pago)' : 'Precio de venta', type: 'money', req: 1,
          note: d.tradeInValor ? 'Incluye ' + esc(full(d.tradeInValor)) + ' de la parte de pago.' : ''},
        {k: 'sellPocket', label: '¿A dónde entró la plata?', type: 'seg', opts: pocketOpts()},
        {k: 'sellDate', label: 'Fecha de venta', type: 'date'},
        ...CONTACT_FIELDS('cliente', '¿A quién se lo vendiste?', 'Nombre (opcional)'));
      else f.push({k: 'targetPrice', label: 'Precio meta (opcional)', type: 'money'});
      f.push(...CONTACT_FIELDS('proveedor', '¿A quién se lo compraste?', 'Nombre (opcional)'), ...EQ_FIELDS(), {k: 'notes', label: 'Notas', type: 'text'});
      return f;
    },
    extra: d => d.status === 'sold' ? '<button type="button" class="btn b-y" data-a="formUnsell" data-testid="form-unsell">↩️ A stock</button>' : '',
    save: (v, d, Fx) => {
      const desc = clean(v.desc), bp = num(v.buyPrice);
      if(!desc) return {err: 'Escribe el nombre del producto', k: 'desc'};
      if(bp <= 0) return {err: 'El costo debe ser mayor a 0', k: 'buyPrice'};
      const ee = equipoErr(v); if(ee) return ee;
      const it = withFondo(Object.assign({}, get('items', d.id) || d, {desc, cat: v.cat, cond: v.cond, notes: clean(v.notes), buyPrice: bp, buyPocket: v.buyPocket || '', buyDate: v.buyDate || today()}),
        Fx && Fx.touched.fondo ? fondoPick(v, {}, Fx) : undefined);
      if(it.status === 'sold'){
        const sp = num(v.sellPrice);
        if(sp <= 0) return {err: 'El precio de venta debe ser mayor a 0', k: 'sellPrice'};
        const tv = +it.tradeInValor || 0;                       // parte de pago: no es plata
        if(sp < tv) return {err: 'El precio total no puede ser menor que la parte de pago (' + full(tv) + ')', k: 'sellPrice'};
        const cash0 = (+it.sellPrice || 0) - tv, cash = sp - tv;
        const wasFull = it.sellPaid == null || it.sellPaid === '' || +it.sellPaid >= cash0;
        it.sellPaid = wasFull ? cash : Math.min(+it.sellPaid, cash);
        it.sellPrice = sp; it.sellPocket = v.sellPocket || it.sellPocket; it.sellDate = v.sellDate || it.sellDate;
        const c = L(DB, 'cobros').find(x => x.itemId === it.id);
        if(c && !wasFull) put('cobros', Object.assign({}, c, {total: cash - it.sellPaid}));
      } else it.targetPrice = num(v.targetPrice) || null;
      ['imei', 'imei2', 'serie', 'bateria', 'almac', 'color', 'proveedor', 'proveedorId'].forEach(k => delete it[k]);   // §14.4: datos del equipo y contactos
      Object.assign(it, equipoDe(v));
      const prov = linkContacto(v.proveedor, v.proveedorNuevo, 'proveedor');
      if(prov.nombre) it.proveedor = prov.nombre;
      if(prov.id) it.proveedorId = prov.id;
      if(it.status === 'sold'){
        delete it.cliente; delete it.clienteId;
        const cl = linkContacto(v.cliente, v.clienteNuevo, 'cliente');
        if(cl.nombre) it.cliente = cl.nombre;
        if(cl.id) it.clienteId = cl.id;
      }
      put('items', it);
      if(Fx && Fx.touched.fondo && it.fondo)                        // el cobro de esa venta (y sus abonos) siguen al producto
        L(DB, 'cobros').filter(c => c.itemId === it.id && c.fondo !== it.fondo).forEach(c => put('cobros', Object.assign({}, c, {fondo: it.fondo})));
      return {rec: it, msg: '✓ ' + desc + ' actualizado'};
    },
    del: (v, d) => {
      const it = get('items', d.id);
      if(!it) return null;
      const cs = L(DB, 'cobros').filter(c => c.itemId === it.id);
      if(!confirm(`¿Eliminar “${it.desc}”?` + (cs.length ? '\nTambién se borra el cobro de esa venta.' : '') + '\nSe borra la compra' + (it.status === 'sold' ? ' y la venta.' : '.'))) return null;
      remove('items', it.id);
      const gone = cs.map(c => removeCobro(c.id));
      const ti = askTradeInRemoval(it);
      return {msg: '🗑️ ' + it.desc + ' eliminado', undo: () => { restore('items', it); if(ti) restore('items', ti); gone.forEach(x => x && (restore('cobros', x.c), x.abs.forEach(a => restore('abonos', a)))); commit('Recuperado ✓'); }};
    }
  },

  gasto: {
    title: d => d._pend ? '💸 Gasto ' + (d.tipo === 'negocio' ? 'del negocio' : 'personal') : '💸 Gasto',
    prep: d => {
      if(!d.fecha) d.fecha = today();
      if(d.bolsillo === undefined) d.bolsillo = defPocket();
      if(d.itemId && !get('items', d.itemId)) delete d.itemId;
      if(d.itemId === undefined) d.itemId = '';
      if(!d.cat || (d.itemId && d.cat === 'Otro')) d.cat = d.desc ? guessGCat(d.desc) : 'Otro';
      if(d.itemId && d.cat === 'Otro') d.cat = 'Mantenimiento';
      if(!d.tipo) d.tipo = d.itemId || NEG_CATS.includes(d.cat) ? 'negocio' : 'personal';
    },
    intro: d => { const it = d.itemId && get('items', d.itemId);
      return it && d._ficha ? `<p class="hint" style="margin-bottom:10px">Arreglo, repuesto, envío… de <b>${esc(it.desc)}</b>: suma a su costo y descuenta de su ganancia.</p>` : ''; },
    fields: d => [
      {k: 'desc', label: '¿En qué?', type: 'text', ph: 'Ej: Envío Servientrega'},
      {k: 'valor', label: 'Valor', type: 'money', req: 1, ph: 'Ej: 12k o 12.000'},
      {k: 'cat', label: 'Categoría', type: 'select', opts: GCATS.map(c => [c, c])},
      {k: 'tipo', label: 'Tipo', type: 'seg', opts: [['negocio', '🏢 Negocio'], ['personal', '👤 Personal']]},
      {k: 'itemId', label: '¿Es de un producto? (arreglo, repuesto, envío…)', type: 'select', opts: gastoItemOpts(d),
        note: 'Si es de un producto, suma a su costo y la ganancia de esa venta sale real.'},
      {k: 'bolsillo', label: '¿De dónde salió?', type: 'seg', opts: pocketOpts()},
      {k: 'fondo', type: 'fondo', opts: fondoOpts()},
      {k: 'fecha', label: 'Fecha', type: 'date'}
    ],
    change: (k, v, set, F) => {
      const tipoDe = c => v.itemId || NEG_CATS.includes(c) ? 'negocio' : 'personal';
      if(k === 'desc' && !F.touched.cat){ const c = guessGCat(v.desc); set('cat', c); if(!F.touched.tipo && !F.d._pend) set('tipo', tipoDe(c)); }
      if(k === 'cat' && !F.touched.tipo) set('tipo', tipoDe(v.cat));
      if(k === 'itemId' && v.itemId){ if(!F.touched.tipo) set('tipo', 'negocio'); if(!F.touched.cat && v.cat === 'Otro') set('cat', 'Mantenimiento'); }
    },
    save: (v, d, Fx) => {
      const valor = num(v.valor);
      if(valor <= 0) return {err: '¿Cuánto fue el gasto?', k: 'valor'};
      if(!v.bolsillo) return {err: '¿De qué bolsillo salió?', k: 'bolsillo'};
      const desc = clean(v.desc) || v.cat || 'Gasto';
      const it = v.itemId ? get('items', v.itemId) : null;
      const rec = put('gastos', withFondo(Object.assign({desc, valor, cat: v.cat || 'Otro', tipo: v.tipo === 'negocio' ? 'negocio' : 'personal', bolsillo: v.bolsillo, fecha: v.fecha || today()},
        it ? {itemId: it.id} : {}), fondoPick(v, d, Fx)));
      return {rec, msg: `💸 ${desc} · ${full(valor)} (${rec.tipo})` + (it ? ` · costo de ${it.desc}: ${full(costoReal(it))}` : '')};
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
      {k: 'fondo', type: 'fondo', opts: fondoOpts()},
      {k: 'fecha', label: 'Fecha', type: 'date'}
    ],
    save: (v, d, Fx) => {
      const valor = num(v.valor);
      if(valor <= 0) return {err: '¿Cuánto te entró?', k: 'valor'};
      if(!v.bolsillo) return {err: '¿A qué bolsillo entró?', k: 'bolsillo'};
      const desc = clean(v.desc) || 'Ingreso';
      const rec = put('ingresos', withFondo({desc, valor, bolsillo: v.bolsillo, fecha: v.fecha || today()}, fondoPick(v, d, Fx)));
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
      {k: 'fondo', type: 'fondo', opts: fondoOpts(), show: v => !!v.bolsillo},
      {k: 'compromiso', label: '¿Cuándo te paga? (opcional)', type: 'date'},
      {k: 'notas', label: 'Nota (opcional)', type: 'text', ph: 'Ej: por los audífonos'}
    ],
    save: (v, d, Fx) => {
      const nombre = titleCase(clean(v.nombre)), total = num(v.total), pagado = num(v.pagado);
      if(!nombre) return {err: '¿Quién te debe?', k: 'nombre'};
      if(total <= 0) return {err: '¿Cuánto te debe?', k: 'total'};
      if(pagado > total) return {err: 'Lo abonado no puede ser mayor que el total', k: 'pagado'};
      const base = d.id ? (get('cobros', d.id) || {}) : {};
      const fondo = d.id ? (Fx && Fx.touched.fondo ? fondoPick(v, {}, Fx) : undefined) : fondoPick(v, d, Fx);
      const rec = put('cobros', withFondo(Object.assign({}, base, {id: d.id, nombre, tel: clean(v.tel), total, pagado, bolsillo: v.bolsillo || '', fecha: d.fecha || today(),
        compromiso: v.compromiso || '', notas: clean(v.notas)}), fondo));
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
      {k: 'fondo', type: 'fondo', opts: fondoOpts()},
      {k: 'fecha', label: 'Fecha', type: 'date'}
    ],
    save: (v, d, Fx) => {
      const c = cobrosPend(DB).find(x => x.id === v.cobroId);
      if(!c) return {err: '¿Quién te abonó? Elige el cobro', k: 'cobroId'};
      const monto = num(v.monto);
      if(monto <= 0) return {err: '¿Cuánto te abonó?', k: 'monto'};
      if(monto > c.pend) return {err: `${c.nombre} solo te debe ${full(c.pend)}`, k: 'monto'};
      if(!v.bolsillo) return {err: '¿A qué bolsillo entró?', k: 'bolsillo'};
      const rec = put('abonos', withFondo({cobroId: c.id, monto, bolsillo: v.bolsillo, fecha: v.fecha || today()}, fondoPick(v, d, Fx)));
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
    fields: d => [{k: 'real', label: 'Saldo real hoy en ' + pn(d.bolsillo), type: 'money', req: 1, ph: 'Ej: 1.250.000'},
      {k: 'fondo', type: 'fondo', opts: fondoOpts(), note: 'La diferencia (de más o de menos) va a este apartado.'}],
    saveLabel: 'Cuadrar',
    save: (v, d, Fx) => {
      if(v.real === '' || v.real == null) return {err: 'Escribe el saldo real', k: 'real'};
      const delta = num(v.real) - (balances(DB)[d.bolsillo] || 0);
      if(!delta) return {msg: '✓ ' + pn(d.bolsillo) + ' ya cuadra'};
      const rec = put('ajustes', withFondo({bolsillo: d.bolsillo, delta, fecha: today(), nota: 'Cuadre ' + pn(d.bolsillo)}, fondoPick(v, d, Fx)));
      return {rec, msg: `⚖️ ${pn(d.bolsillo)} ajustado: ${delta > 0 ? '+' : '−'}${full(Math.abs(delta))}`};
    }
  },

  bolsillo: {
    title: '👛 Nuevo bolsillo',
    fields: () => [
      {k: 'nombre', label: 'Nombre', type: 'text', ph: 'Ej: Bancolombia, Daviplata, Ahorros', req: 1},
      {k: 'ini', label: '¿Cuánto tiene hoy?', type: 'money', ph: '0'},
      {k: 'alias', label: 'Otras formas de nombrarlo (opcional)', type: 'text', ph: 'Ej: bancolombia, la de ahorros', note: 'Separadas por comas. Así lo reconozco cuando escribes una frase.'}
    ],
    save: v => {
      const nombre = clean(v.nombre);
      if(!nombre) return {err: 'Ponle un nombre', k: 'nombre'};
      if(pockets().some(p => normKey(p.nombre) === normKey(nombre))) return {err: 'Ya tienes un bolsillo con ese nombre', k: 'nombre'};
      let id = normKey(nombre).replace(/ /g, '-') || uid();
      if((DB.bolsillos || []).some(p => p.id === id) || !/^[a-z0-9-]+$/.test(id)) id = 'b' + uid();
      const alias = parseAlias([nombre, v.alias].join(','));
      const rec = put('bolsillos', {id, nombre, ini: num(v.ini), alias});
      return {rec, msg: '👛 ' + nombre + ' creado'};
    }
  },

  renombrar: {
    title: '✏️ Editar bolsillo',
    prep: d => { const p = get('bolsillos', d.id); d.nombre = p ? p.nombre : ''; d.alias = p && Array.isArray(p.alias) ? p.alias.join(', ') : ''; },
    fields: () => [
      {k: 'nombre', label: 'Nombre', type: 'text', req: 1},
      {k: 'alias', label: 'Cómo lo nombras al escribir', type: 'text', ph: 'Ej: nequi de mi pareja, mi novia', note: 'Separadas por comas. “gasté 20k del nequi de mi pareja” → este bolsillo.'}
    ],
    save: (v, d) => {
      const nombre = clean(v.nombre), p = get('bolsillos', d.id);
      if(!nombre) return {err: 'Ponle un nombre', k: 'nombre'};
      if(!p) return {err: 'Ese bolsillo ya no existe'};
      if(pockets().some(x => x.id !== p.id && normKey(x.nombre) === normKey(nombre))) return {err: 'Ya tienes un bolsillo con ese nombre', k: 'nombre'};
      put('bolsillos', Object.assign({}, p, {nombre, alias: parseAlias(v.alias)}));
      return {msg: nombre !== p.nombre ? '✓ Ahora se llama ' + nombre : '✓ ' + nombre + ' actualizado'};
    }
  },

  /* §13.4: mover plata entre apartados sin moverla de bolsillo */
  reparto: {
    title: '🔀 Repartir plata',
    prep: d => {
      if(!d.fecha) d.fecha = today();
      if(juntos()){ if(FONDO_BASE.includes(d.from)) d.from = LIBRE; if(FONDO_BASE.includes(d.to)) d.to = LIBRE; }
      const ok = x => fondoValid(x) || (juntos() && x === LIBRE);
      if(d.from && !ok(d.from)) d.from = '';
      if(d.to && !ok(d.to)) d.to = '';
      if(juntos()){ if(!d.from && !d.to) d.from = LIBRE; if(!d.to || d.to === d.from) d.to = d.from === LIBRE ? ((fondosExtra()[0] || {}).id || '') : LIBRE; if(!d.from) d.from = d.to === LIBRE ? ((fondosExtra()[0] || {}).id || '') : LIBRE; return; }
      if(!d.from && !d.to) d.from = 'personal';
      if(!d.from) d.from = d.to === 'personal' ? (fondoValid('negocio') ? 'negocio' : otherFondo(d.to)) : (fondoValid('personal') ? 'personal' : otherFondo(d.to));
      if(!d.to || d.to === d.from) d.to = d.from === 'personal' ? (fondoValid('negocio') ? 'negocio' : otherFondo(d.from)) : otherFondo(d.from);
    },
    intro: () => '<p class="hint" style="margin-bottom:10px">Pasa plata de un apartado a otro. No sale de ningún bolsillo: tu caja sigue igual.</p>',
    fields: () => [
      {k: 'from', label: 'Desde', type: 'seg', opts: fondoOpts(true)},
      {k: 'to', label: 'Hacia', type: 'seg', opts: fondoOpts(true)},
      {k: 'monto', label: '¿Cuánto?', type: 'money', req: 1, ph: 'Ej: 300k'},
      {k: 'fecha', label: 'Fecha', type: 'date'},
      {k: 'nota', label: 'Nota (opcional)', type: 'text', ph: 'Ej: ganancia de octubre'}
    ],
    change: (k, v, set) => { const oth = x => juntos() ? (x === LIBRE ? ((fondosExtra()[0] || {}).id || LIBRE) : LIBRE) : otherFondo(x); if(k === 'from' && v.from === v.to) set('to', oth(v.from)); if(k === 'to' && v.from === v.to) set('from', oth(v.to)); },
    save: v => {
      const monto = num(v.monto);
      if(juntos()){ v = Object.assign({}, v); if(v.from === LIBRE) v.from = 'personal'; if(v.to === LIBRE) v.to = 'personal'; }
      if(!fondoValid(v.from) || !fondoValid(v.to)) return {err: juntos() && !fondosExtra().length ? 'Primero crea un apartado (ej: 🐷 Ahorro) para repartirle plata' : 'Elige los dos apartados'};
      if(v.from === v.to) return {err: 'Elige apartados distintos', k: 'to'};
      if(monto <= 0) return {err: '¿Cuánto vas a repartir?', k: 'monto'};
      const rec = put('repartos', {from: v.from, to: v.to, monto, fecha: v.fecha || today(), nota: clean(v.nota)});
      const queda = balancesFondos(DB)[v.from] || 0;
      return {rec, msg: `🔀 ${fnName(v.from)} → ${fnName(v.to)} · ${full(monto)}` + (queda < 0 ? ` · ${fnName(v.from)} quedó en ${full(queda)}` : '')};
    }
  },

  /* apartado nuevo o editar (nombre, emoji, alias, meta) */
  fondo: {
    title: d => d.id ? '✏️ Editar apartado' : '🎯 Nuevo apartado',
    prep: d => {
      const f = d.id ? get('fondos', d.id) : null;
      if(f){ d.nombre = f.nombre || ''; d.emoji = f.emoji || ''; d.alias = (f.alias || []).join(', '); d.meta = +f.meta || ''; }
      if(!d.emoji) d.emoji = '🏠';
    },
    intro: d => d.id ? '' : '<p class="hint" style="margin-bottom:10px">Un apartado es plata con un propósito: 🏠 Arriendo, 🐷 Ahorro, 🎓 Estudio… Después le pasas plata con <b>Repartir</b>.</p>',
    fields: d => [
      {k: 'nombre', label: 'Nombre', type: 'text', req: 1, ph: 'Ej: Arriendo'},
      {k: 'emoji', label: 'Ícono', type: 'seg', chips: 1, opts: FONDO_EMOJIS.concat(d.emoji && !FONDO_EMOJIS.includes(d.emoji) ? [d.emoji] : []).map(e => [e, e])},
      {k: 'alias', label: 'Cómo lo nombras al escribir (opcional)', type: 'text', ph: 'Ej: arriendo, renta, la casa', note: 'Separadas por comas. “aparté 300k para la renta” → este apartado.'},
      {k: 'meta', label: 'Meta (opcional)', type: 'money', ph: 'Ej: 1.2M', note: 'Si tienes un objetivo, te muestro una barra de avance.'}
    ],
    save: (v, d) => {
      const nombre = clean(v.nombre);
      if(!nombre) return {err: 'Ponle un nombre', k: 'nombre'};
      if(fondos().some(f => f.id !== d.id && normKey(f.nombre) === normKey(nombre))) return {err: 'Ya tienes un apartado con ese nombre', k: 'nombre'};
      const meta = num(v.meta), alias = parseAlias([nombre, v.alias].join(','));
      if(d.id){
        const f = get('fondos', d.id);
        if(!f) return {err: 'Ese apartado ya no existe'};
        const rec = put('fondos', Object.assign({}, f, {nombre, emoji: v.emoji || '', alias, meta: meta > 0 ? meta : null}));
        return {rec, msg: '✓ ' + fnName(rec.id) + ' actualizado'};
      }
      let id = normKey(nombre).replace(/ /g, '_');
      if(!/^[a-z0-9_]+$/.test(id) || (DB.fondos || []).some(f => f.id === id) || (DB.bolsillos || []).some(b => b.id === id)) id = 'f' + uid();
      const orden = fondos().reduce((m, f) => Math.max(m, +f.orden || 0), 0) + 1;
      const rec = put('fondos', {id, nombre, emoji: v.emoji || '', alias, meta: meta > 0 ? meta : null, orden});
      return {rec, msg: '🎯 ' + fnName(id) + ' creado · pásale plata con Repartir'};
    },
    del: (v, d) => delFondo(d.id, true)
  },

  /* tarjeta "Organiza tu plata en apartados": cuánto de lo que hay hoy es capital del negocio */
  organizar: {
    title: '🎯 Organiza tu plata',
    intro: () => {
      const bf = balancesFondos(DB);
      return `<p class="hint" style="margin-bottom:10px">Hoy tienes <b class="mono">${full(cajaTotal())}</b> entre todos tus bolsillos
        (ahora: 💼 Negocio ${full(bf.negocio || 0)} · 👤 Personal ${full(bf.personal || 0)}).
        ¿Cuánto de eso es <b>capital del negocio</b>, para comprar mercancía? El resto queda como <b>👤 Personal</b>. Después puedes crear más apartados.</p>`;
    },
    fields: () => [{k: 'negocio', label: '💼 Capital del negocio hoy', type: 'money', req: 1, ph: 'Ej: 2M'}],
    saveLabel: 'Organizar',
    save: v => {
      if(v.negocio === '' || v.negocio == null) return {err: '¿Cuánto es del negocio? (puede ser 0)', k: 'negocio'};
      const x = num(v.negocio), caja = cajaTotal();
      if(x < 0) return {err: 'Escribe un valor positivo', k: 'negocio'};
      if(x > caja) return {err: 'No puede ser más de lo que tienes hoy (' + full(caja) + ')', k: 'negocio'};
      const delta = x - (balancesFondos(DB).negocio || 0);
      if(delta) put('repartos', {from: delta > 0 ? 'personal' : 'negocio', to: delta > 0 ? 'negocio' : 'personal', monto: Math.abs(delta), fecha: today(), nota: 'Organizar apartados'});
      CFG.fondosIntro = 'ok'; saveCfg();
      const bf = balancesFondos(DB);
      return {msg: `🎯 Listo: 💼 Negocio ${full(bf.negocio || 0)} · 👤 Personal ${full(bf.personal || 0)}`};
    }
  },

  /* §14.4: contactos (clientes y proveedores) */
  contacto: {
    title: d => d.id ? '✏️ Editar contacto' : '👤 Nuevo contacto',
    prep: d => { const c = d.id ? get('contactos', d.id) : null; if(c) Object.assign(d, {nombre: c.nombre, tel: c.tel || '', tipo: c.tipo || 'cliente', notas: c.notas || ''}); if(!d.tipo) d.tipo = 'cliente'; },
    fields: () => [
      {k: 'nombre', label: 'Nombre', type: 'text', req: 1, cap: 'words', ph: 'Ej: Mateo Ríos'},
      {k: 'tel', label: 'Celular (opcional)', type: 'tel'},
      {k: 'tipo', label: '¿Qué es para ti?', type: 'seg', opts: [['cliente', 'Cliente'], ['proveedor', 'Proveedor'], ['ambos', 'Ambos']]},
      {k: 'notas', label: 'Notas (opcional)', type: 'text', ph: 'Ej: vende iPhones en el centro'}
    ],
    save: (v, d) => {
      const nombre = titleCase(clean(v.nombre));
      if(!nombre) return {err: 'Escribe el nombre', k: 'nombre'};
      if(L(DB, 'contactos').some(c => c.id !== d.id && normNombre(c.nombre) === normNombre(nombre))) return {err: 'Ya tienes un contacto con ese nombre', k: 'nombre'};
      if(clean(v.tel) && !waNumber(v.tel)) return {err: 'Ese celular no parece válido (10 dígitos, empieza por 3)', k: 'tel'};
      const base = d.id ? get('contactos', d.id) || {} : {};
      const rec = put('contactos', Object.assign({}, base, {id: d.id, nombre, tel: clean(v.tel), tipo: v.tipo || 'cliente', notas: clean(v.notas)}));
      return {rec, msg: (d.id ? '✓ ' : '👤 ') + nombre + (d.id ? ' actualizado' : ' guardado en contactos')};
    },
    del: (v, d) => {
      const c = get('contactos', d.id);
      if(!c || !confirm('¿Eliminar a ' + c.nombre + ' de tus contactos?\nSus compras y ventas se quedan (con el nombre escrito).')) return null;
      remove('contactos', c.id);
      return {msg: '🗑️ ' + c.nombre + ' eliminado', undo: () => { restore('contactos', c); commit('Recuperado ✓'); }};
    }
  },

  /* §14.4: topes de gasto por mes */
  tope: {
    title: d => d.id ? '✏️ Editar tope' : '🚦 Nuevo tope',
    prep: d => { const t = d.id ? get('topes', d.id) : null; if(t){ d.cat = t.cat; d.limite = +t.limite || ''; } if(!d.cat) d.cat = '__personal'; },
    intro: () => '<p class="hint" style="margin-bottom:10px">Un tope es lo máximo que quieres gastar en el mes. Te aviso al llegar al 80% y si te pasas.</p>',
    fields: () => [
      {k: 'cat', label: '¿En qué?', type: 'select', opts: [['__personal', '👤 Todo lo personal']].concat(GCATS.map(c => [c, c]))},
      {k: 'limite', label: 'Máximo al mes', type: 'money', req: 1, ph: 'Ej: 800k'}
    ],
    save: (v, d) => {
      const limite = num(v.limite);
      if(limite <= 0) return {err: '¿Cuánto es lo máximo al mes?', k: 'limite'};
      if(L(DB, 'topes').some(t => t.id !== d.id && t.cat === v.cat)) return {err: 'Ya tienes un tope para eso: edítalo', k: 'cat'};
      const base = d.id ? get('topes', d.id) || {} : {};
      const rec = put('topes', Object.assign({}, base, {id: d.id, cat: v.cat, limite}));
      return {rec, msg: '🚦 Tope de ' + topeNombre(rec) + ': ' + full(limite) + ' al mes'};
    },
    del: (v, d) => {
      const t = get('topes', d.id);
      if(!t || !confirm('¿Eliminar el tope de ' + topeNombre(t) + '?')) return null;
      remove('topes', t.id);
      return {msg: '🗑️ Tope eliminado', undo: () => { restore('topes', t); commit('Recuperado ✓'); }};
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
  if(col === 'items'){ if(get('items', id)) openFicha(id); return; }   // §14.4: la ficha (con Editar adentro)
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
  ['sellPrice', 'sellPaid', 'sellPocket', 'sellDate', 'sellNotes', 'tradeInId', 'tradeInValor'].forEach(k => delete back[k]);
  put('items', back);
  const gone = cs.map(c => removeCobro(c.id));
  const ti = askTradeInRemoval(it);
  closeForm();
  commit('↩️ ' + it.desc + ' volvió al stock', {undo: () => { put('items', it); if(ti) restore('items', ti); gone.forEach(x => x && (restore('cobros', x.c), x.abs.forEach(a => restore('abonos', a)))); commit('Deshecho'); }});
}

/* Al borrar o devolver una venta con parte de pago: ¿borrar también lo recibido? (solo si sigue en stock) */
function askTradeInRemoval(it){
  const ti = it && it.tradeInId ? get('items', it.tradeInId) : null;
  if(!ti) return null;
  if(ti.status === 'sold'){ toast(ti.desc + ' (parte de pago) ya lo vendiste: se queda.'); return null; }
  if(!confirm(`¿Eliminar también “${ti.desc}”, que recibiste como parte de pago?`)) return null;
  remove('items', ti.id);
  return ti;
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

/* Eliminar apartado: solo los creados por el usuario, en $0 y sin movimientos (§13.4) */
function delFondo(id, fromForm){
  const f = get('fondos', id);
  if(!f) return null;
  const s = balancesFondos(DB)[id] || 0;
  if(FONDO_BASE.includes(id)){ toast(fnName(id) + ' es de base: puedes cambiarle el nombre, pero no eliminarlo', {err: true}); return null; }
  if(s){ toast('Primero deja ' + fnName(id) + ' en $0 (usa Repartir): tiene ' + full(s), {err: true}); return null; }
  if(fondoUsed(id)){ toast(fnName(id) + ' tiene movimientos: no se puede eliminar', {err: true}); return null; }
  if(!confirm('¿Eliminar el apartado ' + fnName(id) + '?')) return null;
  remove('fondos', id);
  const r = {msg: '🗑️ ' + fnName(id) + ' eliminado', undo: () => { restore('fondos', f); commit('Recuperado ✓'); }};
  if(fromForm) return r;
  commit(r.msg, {undo: r.undo});
  return r;
}

/* Reporte del cuadre (no debería hacer falta nunca): saldos por bolsillo y por apartado + conteos */
function cuadreReport(){
  const b = balances(DB), f = balancesFondos(DB);
  return 'Mi App ' + APP_VERSION + ' · reporte de cuadre ' + today() + '\nBolsillos ' + JSON.stringify(b) + ' = ' + sumObj(b) +
    '\nApartados ' + JSON.stringify(f) + ' = ' + sumObj(f) + '\nRegistros ' + JSON.stringify(COLS.reduce((o, c) => (o[c] = L(DB, c).length, o), {}));
}

const ACT = {
  form: el => openForm(el.dataset.k, {}),
  /* §14.4 */
  ficha: el => openFicha(el.dataset.id),
  ocrFicha: el => ocrPick('ficha', el.dataset.id),
  ocrForm: () => { if(F) ocrPick('form', F.d && F.d.id); },
  ocrGuardar: el => ocrGuardar(el.dataset.id),
  ocrTexto: () => { const p = $('#ocrRaw'); if(p) p.hidden = !p.hidden; },
  infoClose: () => closeInfo(),
  fichaVender: el => openForm('venta', {itemId: el.dataset.id}, {back: backToFicha(el.dataset.id)}),
  fichaEditar: el => { const it = get('items', el.dataset.id); if(it) openForm('editItem', it, {back: backToFicha(it.id)}); },
  fichaGasto: el => openForm('gasto', {itemId: el.dataset.id, tipo: 'negocio', _ficha: 1}, {back: backToFicha(el.dataset.id)}),
  verRef: el => openRef(el.dataset.q),
  refBuscar: () => { const q = clean(UI.refQ); if(q) openRef(q); },
  goContacto: el => { closeSheet(); UI.masSeg = 'contactos'; UI.ctQ = (get('contactos', el.dataset.id) || {}).nombre || ''; setView('mas'); const i = $('#ctQ'); if(i) i.value = UI.ctQ; renderContactos(); },
  nuevoContacto: () => openForm('contacto', {}),
  editContacto: el => openForm('contacto', {id: el.dataset.id}),
  waContacto: el => {
    const c = get('contactos', el.dataset.id);
    if(!c) return;
    const n = waNumber(c.tel);
    if(!n){ toast('Agrégale el celular a ' + c.nombre); openForm('contacto', {id: c.id}); return; }
    window.open('https://wa.me/' + n + '?text=' + encodeURIComponent('Hola ' + c.nombre.split(' ')[0] + ', ¿cómo vas? 👋'), '_blank', 'noopener');
  },
  goTopes: () => { UI.masSeg = 'dinero'; UI.dnSeg = 'topes'; setView('mas'); },
  nuevoTope: el => openForm('tope', el.dataset.cat ? {cat: el.dataset.cat, limite: +el.dataset.lim || ''} : {}),
  editTope: el => openForm('tope', {id: el.dataset.id}),
  goDinero: () => { UI.masSeg = 'dinero'; UI.dnSeg = 'para'; setView('mas'); },
  repartir: el => { if(juntos() && !fondosExtra().length){ toast('Crea primero un apartado (ej: 🐷 Ahorro) en Más → Dinero → ¿Para qué es?'); return; } openForm('reparto', el.dataset.fondo ? (el.dataset.fondo === LIBRE ? {from: LIBRE} : {to: el.dataset.fondo}) : {}); },
  toggleSepNP: () => { CFG.separarNP = !CFG.separarNP; saveCfg(); render(); toast(CFG.separarNP ? 'Ahora ves 💼 Negocio y 👤 Personal por separado' : 'Tu plata se ve junta como 💵 Plata libre'); },
  nuevoFondo: () => openForm('fondo', {}),
  editFondo: el => openForm('fondo', {id: el.dataset.id}),
  delFondo: el => delFondo(el.dataset.id),
  organizarNo: () => { CFG.fondosIntro = 'no'; saveCfg(); renderInicio(); toast('Cuando quieras, está en Más → Dinero → ¿Para qué es?'); },
  reportarCuadre: () => copyText(cuadreReport(), 'Reporte de cuadre'),
  kswitch: el => switchKind(el.dataset.k),
  olvidar: el => {
    const r = get('reglas', el.dataset.id);
    if(!r) return;
    remove('reglas', r.id);
    commit('🧹 Olvidé “' + (r.palabra || r.id) + '”', {undo: () => { restore('reglas', r); commit('Recuperado ✓'); }});
  },
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

/* ═════════ 3b. LOTE "ESTO ENTENDÍ" (§11.4) ═════════ */
const LOTE_POCKET = {compra: 'buyPocket', venta: 'sellPocket', gasto: 'bolsillo', ingreso: 'bolsillo', abono: 'bolsillo'};

/* valores de formulario a partir de un borrador, sin DOM (mismos defaults que openForm) */
function formValues(kind, d){
  const spec = FORMS[kind], v = {};
  spec.fields(d).forEach(f => { let x = d[f.k]; if(x === undefined || x === null) x = f.val !== undefined ? f.val : ''; v[f.k] = x; });
  return v;
}
/* prep del formulario, pero el bolsillo que no se dijo queda SIN elegir (se elige con chips) */
function lotePrep(kind, d0){
  const d = Object.assign({}, d0), pk = LOTE_POCKET[kind], had = pk && d[pk] !== undefined;
  if(d.fondo != null && !fondoValid(d.fondo)) delete d.fondo;
  if(FORMS[kind].prep) FORMS[kind].prep(d);
  if(pk && !had) delete d[pk];
  return d;
}

function startLote(arr, opts){
  LOTE = {ops: arr.map(r => { const d = lotePrep(r.kind, r.d || {});
    return {kind: r.kind, d, parsed: JSON.parse(JSON.stringify({kind: r.kind, d: r.d || {}})), v0: formValues(r.kind, d)}; }),
    fromQuick: !!(opts && opts.fromQuick), qtext: (opts && opts.qtext) || '', touched: {}};
  openLote();
}

const loteCash = d => d.completo === 'no' ? Math.min(num(d.sellPaid), num(d.sellPrice)) : num(d.sellPrice);
/* costo del producto vendido (para la ganancia) */
function loteCost(i){
  const d = LOTE.ops[i].d;
  if(d.itemId === '__prev'){ const c = LOTE.ops.slice(0, i).reverse().find(o => o.kind === 'compra'); return c ? num(c.d.buyPrice) : null; }
  if(d.itemId === '__nuevo') return num(d.buyPrice) || null;
  const it = d.itemId ? get('items', d.itemId) : null;
  return it ? +it.buyPrice || 0 : null;
}
function loteName(i){
  const d = LOTE.ops[i].d;
  if(d.itemId === '__prev' || d.itemId === '__nuevo') return d.desc || 'Producto';
  const it = d.itemId ? get('items', d.itemId) : null;
  return it ? it.desc : '';
}

/* primer dato que falta (o '' si todo está listo) */
function loteMissing(){
  for(let i = 0; i < LOTE.ops.length; i++){
    const {kind, d} = LOTE.ops[i], n = '';
    if(kind === 'compra'){
      if(!clean(d.desc)) return n + 'Falta qué compraste';
      if(num(d.buyPrice) <= 0) return n + 'Falta cuánto te costó ' + d.desc;
      if(d.buyPocket === undefined) return n + '¿De dónde salió la plata de la compra?';
    } else if(kind === 'venta'){
      if(!d.itemId || (d.itemId !== '__prev' && d.itemId !== '__nuevo' && !get('items', d.itemId))) return n + 'Falta qué producto vendiste';
      if(d.itemId === '__prev' && !LOTE.ops.slice(0, i).some(o => o.kind === 'compra')) return n + 'Falta qué producto vendiste';
      if(d.itemId === '__nuevo' && num(d.buyPrice) <= 0) return n + 'Falta cuánto te costó ' + (d.desc || 'lo que vendiste');
      const V = d.parte === 'si' ? num(d.tiValor) : 0;
      if(num(d.sellPrice) + V <= 0) return n + 'Falta en cuánto lo vendiste';
      if(d.parte === 'si' && (!clean(d.tiDesc) || V <= 0)) return n + 'Falta el valor de la parte de pago';
      if(d.completo === 'no' && loteCash(d) < num(d.sellPrice) && !clean(d.cliente)) return n + '¿Quién te quedó debiendo?';
      if(loteCash(d) > 0 && d.sellPocket === undefined) return n + '¿A dónde entró la plata de la venta?';
    } else if(kind === 'gasto' || kind === 'ingreso'){
      if(num(d.valor) <= 0) return n + 'Falta el valor del ' + kind;
      if(d.bolsillo === undefined) return n + (kind === 'gasto' ? '¿De dónde salió el gasto?' : '¿A dónde entró el ingreso?');
    } else if(kind === 'abono'){
      if(!d.cobroId) return n + '¿Quién te abonó?';
      if(num(d.monto) <= 0) return n + 'Falta cuánto te abonó';
      if(d.bolsillo === undefined) return n + '¿A dónde entró el abono?';
    } else if(kind === 'cobro'){
      if(!clean(d.nombre)) return n + '¿Quién te debe?';
      if(num(d.total) <= 0) return n + 'Falta cuánto te debe';
    } else if(kind === 'transfer'){
      if(num(d.monto) <= 0) return n + 'Falta cuánto moviste';
      if(!d.from || !d.to || d.from === d.to) return n + 'Elige bolsillos distintos para mover';
    } else if(kind === 'reparto'){
      if(num(d.monto) <= 0) return n + 'Falta cuánto vas a repartir';
      if(!fondoValid(d.from) || !fondoValid(d.to) || d.from === d.to) return n + 'Elige apartados distintos para repartir';
    }
  }
  return '';
}

function loteChips(i, k, opts, val){
  return `<div class="opts" style="margin-top:8px">${opts.map(([o, l]) => `<button type="button" class="${val !== undefined && String(o) === String(val) ? 'on' : ''}"
    data-a="lotePick" data-i="${i}" data-k="${k}" data-v="${esc(o)}" data-testid="lote-${i}-${k}-${esc(o || 'ninguno')}">${esc(l)}</button>`).join('')}</div>`;
}

function loteCardsHTML(){
  const cards = [];
  const card = (i, ico, html, extra, ac) => cards.push(`<div class="alert" data-testid="lote-card" data-i="${i}" style="--ac:${ac}">${
    i >= 0 && LOTE.ops[i].d.fondo && !(juntos() && FONDO_BASE.includes(LOTE.ops[i].d.fondo)) ? `<div class="meta" style="float:right;margin:0 0 4px 6px" data-testid="lote-fondo">Plata de: ${esc(fnName(LOTE.ops[i].d.fondo))}</div>` : ''}
    <div class="alert-h"><div style="min-width:0;flex:1"><div class="alert-t" style="font-weight:500">${ico} ${html}</div></div>
    ${i >= 0 ? `<div style="display:flex;gap:4px;flex-shrink:0"><button type="button" class="ibtn" data-a="loteEdit" data-i="${i}" aria-label="Editar">✏️</button>
    <button type="button" class="ibtn" data-a="loteDel" data-i="${i}" aria-label="Quitar">✕</button></div>` : ''}</div>${extra || ''}</div>`);
  LOTE.ops.forEach(({kind, d}, i) => {
    const b = s => `<b>${esc(s)}</b>`, m = x => `<b class="mono">${full(x)}</b>`;
    if(kind === 'compra'){
      card(i, '🛒', `Compraste ${b(d.desc || '¿qué?')} · ${num(d.buyPrice) ? m(d.buyPrice) : '<span class="neg">falta el precio</span>'}`,
        `<div class="meta" style="margin-top:8px">¿De dónde salió la plata?</div>` + loteChips(i, 'buyPocket', pocketOpts().concat([POCKET_NONE]), d.buyPocket), 'var(--B)');
    } else if(kind === 'venta'){
      const V = d.parte === 'si' ? num(d.tiValor) : 0, sp = num(d.sellPrice), cash = loteCash(d), cost = loteCost(i), name = loteName(i) || '¿qué producto?';
      let txt = `Vendiste ${b(name)} en ${m(sp + V)}`;
      if(V) txt += ` = ${full(sp)} en plata + ${esc(d.tiDesc)} (${full(V)})`;
      let extra = '';
      if(d.completo === 'no' && cash < sp) extra += `<div class="meta" style="margin-top:6px">🤝 ${esc(titleCase(d.cliente || '¿quién?'))} te queda debiendo ${full(sp - cash)}</div>`;
      if(cash > 0) extra += `<div class="meta" style="margin-top:8px">¿A dónde entró la plata (${full(cash)})?</div>` + loteChips(i, 'sellPocket', pocketOpts(), d.sellPocket);
      extra += `<div class="meta" style="margin-top:8px">${cost == null ? '<span class="yel">Falta el costo: toca ✏️</span>' : 'Ganancia <b class="' + (sp + V - cost >= 0 ? 'pos' : 'neg') + ' mono">' + full(sp + V - cost) + '</b>'}</div>`;
      card(i, '💰', txt, extra, 'var(--G)');
      if(V) card(-1, '📦', `${b(d.tiDesc)} entra a tu stock · costo ${m(V)}`, `<div class="meta" style="margin-top:4px">Parte de pago: no sale de tus bolsillos.</div>`, 'var(--P)');
    } else if(kind === 'gasto' || kind === 'ingreso'){
      const g = kind === 'gasto';
      card(i, g ? '💸' : '➕', `${g ? 'Gasto' : 'Ingreso'} ${b(d.desc || d.cat || '')} · ${num(d.valor) ? m(d.valor) : '<span class="neg">falta el valor</span>'}${g ? ` <span class="tag t-n">${esc(d.cat || 'Otro')} · ${esc(d.tipo || '')}</span>` : ''}`,
        `<div class="meta" style="margin-top:8px">${g ? '¿De dónde salió?' : '¿A dónde entró?'}</div>` + loteChips(i, 'bolsillo', pocketOpts(), d.bolsillo), g ? 'var(--R)' : 'var(--G)');
    } else if(kind === 'abono'){
      const c = cobrosPend(DB).find(x => x.id === d.cobroId);
      card(i, '💵', `Abono de ${b(c ? c.nombre : (d._nombre || '¿quién?'))} · ${m(d.monto)}`,
        `<div class="meta" style="margin-top:8px">¿A dónde entró?</div>` + loteChips(i, 'bolsillo', pocketOpts(), d.bolsillo), 'var(--G)');
    } else if(kind === 'cobro'){
      card(i, '🤝', `${b(d.nombre || '¿quién?')} te debe ${m(num(d.total) - num(d.pagado))}${d.bolsillo ? ' · préstamo desde ' + esc(pn(d.bolsillo)) : ''}`, '', 'var(--P)');
    } else if(kind === 'transfer'){
      card(i, '🔁', `Moviste ${m(d.monto)} de ${b(pn(d.from))} a ${b(pn(d.to))}`, '', 'var(--B)');
    } else if(kind === 'reparto'){
      card(i, '🔀', `Repartiste ${m(d.monto)} de ${b(fnName(d.from))} a ${b(fnName(d.to))}`, '<div class="meta" style="margin-top:4px">No sale de ningún bolsillo.</div>', 'var(--P)');
    }
  });
  return cards.join('');
}

function openLote(){
  if(!LOTE) return;
  SHEET = 'lote'; F = null;
  const body = $('#sheetBody'), top = body.scrollTop;
  $('#sheetTitle').textContent = '🤖 Esto entendí';
  const miss = loteMissing();
  body.innerHTML = `<p class="hint" style="margin-bottom:10px">Revisa y toca <b>Guardar todo</b>. Con ✏️ cambias cualquier detalle.</p>` + loteCardsHTML() +
    `<p class="hint ${miss ? 'yel' : 'pos'}" data-testid="lote-falta" style="margin:4px 0 8px">${miss ? '⚠️ ' + esc(miss) : '✓ Todo listo'}</p>`;
  $('#sheetFoot').innerHTML = '<button type="button" class="btn b-gh" data-a="loteCancel" data-testid="lote-cancel">Cancelar</button>' +
    `<button type="submit" class="btn b-g" data-testid="lote-save"${miss ? ' disabled' : ''}>Guardar todo</button>`;
  const sh = $('#sheet');
  sh.classList.add('on'); sh.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  try { if(!(history.state && history.state.sheet)) history.pushState({sheet: 1}, ''); } catch(e){}
  body.scrollTop = top;
}

function closeLote(){
  LOTE = null; SHEET = null;
  const sh = $('#sheet');
  sh.classList.remove('on'); sh.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  setTimeout(() => { if(!SHEET){ $('#sheetBody').innerHTML = ''; $('#sheetFoot').innerHTML = ''; $('#sheetTitle').textContent = ''; } }, 220);
}

/* Deshacer de un lote: borra lo creado y devuelve lo modificado a como estaba */
function undoFrom(before){
  const changed = [];
  COLS.forEach(c => {
    const prev = new Map((before[c] || []).map(r => [r.id, r]));
    (DB[c] || []).forEach(r => { const b = prev.get(r.id); if(!b) changed.push([c, r.id, null]); else if(b.u !== r.u) changed.push([c, r.id, b]); });
  });
  return () => {
    changed.forEach(([c, id, b]) => { if(!b) remove(c, id); else put(c, Object.assign({}, b)); });
    commit('↩️ Deshecho: ' + plural(changed.length, 'cambio'));
  };
}

function saveLote(){
  if(!LOTE) return;
  const miss = loteMissing();
  if(miss){ toast(miss, {err: true}); return; }
  const before = JSON.parse(JSON.stringify(DB)), rev0 = UI.rev;
  let prevItem = null, n = 0, gan = null, stockIn = [];
  try {
    for(const op of LOTE.ops){
      const d = Object.assign({}, op.d, {_lote: 1});
      if(op.kind === 'venta' && d.itemId === '__prev'){
        if(!prevItem) throw new Error('No encontré la compra de esta frase');
        d.itemId = prevItem;
      }
      const v = formValues(op.kind, d);
      const res = FORMS[op.kind].save(v, d) || {};
      if(res.err) throw new Error(res.err);
      n++;
      if(op.kind === 'compra' && res.rec) prevItem = res.rec.id;
      if(op.kind === 'venta'){ gan = (gan || 0) + (res.g || 0); if(res.recibido) stockIn.push(res.recibido.desc); }
    }
  } catch(e){
    DB = before; UI.rev = rev0;
    toast(String(e && e.message || e), {err: true});
    return;
  }
  if(LOTE.fromQuick) LOTE.ops.forEach(op => learnFrom({kind: op.kind, v: formValues(op.kind, op.d), v0: op.v0, parsed: op.parsed, qtext: LOTE.qtext,
    fondoTouched: !!op.d.fondo && op.d.fondo !== op.parsed.d.fondo}));          // §12.3 también en el lote
  if(LOTE.fromQuick) iaRecordar(LOTE.qtext, LOTE.ops.map(op => ({kind: op.kind, d: op.d})));
  const undo = undoFrom(before);
  if(LOTE.fromQuick){ const q = $('#qInput'); if(q) q.value = ''; }
  closeLote();
  commit('✓ ' + plural(n + stockIn.length, 'movimiento guardado', 'movimientos guardados') + (gan != null ? ' · ganancia ' + full(gan) : '') + (stockIn.length ? ' · ' + stockIn.join(', ') + ' al stock' : ''),
    {undo, ms: 8000});
}

Object.assign(ACT, {
  lotePick: el => { const op = LOTE && LOTE.ops[+el.dataset.i]; if(!op) return; op.d[el.dataset.k] = el.dataset.v; openLote(); },
  loteEdit: el => { const i = +el.dataset.i, op = LOTE && LOTE.ops[i]; if(!op) return; openForm(op.kind, op.d, {lote: i}); },
  loteDel: el => {
    const i = +el.dataset.i, op = LOTE && LOTE.ops[i];
    if(!op) return;
    if(op.kind === 'compra') LOTE.ops.slice(i + 1).forEach(o => {     // la venta de esa compra pasa a "producto no registrado"
      if(o.kind === 'venta' && o.d.itemId === '__prev' && !LOTE.ops.slice(0, i).some(x => x.kind === 'compra'))
        Object.assign(o.d, {itemId: '__nuevo', desc: op.d.desc, cat: op.d.cat, buyPrice: op.d.buyPrice});
    });
    LOTE.ops.splice(i, 1);
    if(!LOTE.ops.length) closeLote(); else openLote();
  },
  loteCancel: () => closeLote()
});


/* ═════════ §15 PEGAR UNA LISTA AL INVENTARIO ═════════
   "Negro 512 2 palos / Negro 256 fisura recibido 2 / …" → un producto por línea (parseLista en quick.js) */
let LISTA = null, listaTimer = 0;
function openLista(texto){
  LISTA = {texto: texto || '', modelo: null, pocket: undefined, fecha: today(), quitar: new Set(), precios: {}};
  const body = `<p class="hint" style="margin-bottom:8px">Pega tu lista: <b>una línea por producto</b> con color, almacenamiento, detalles y el precio en que lo compraste o recibiste. Escribe <b>recibido</b> si vino en parte de pago.</p>
    <textarea class="in" id="listaTxt" data-testid="lista-texto" rows="5" spellcheck="false" placeholder="Negro 512 2 palos&#10;Negro 256 fisura recibido 2&#10;Desert 256 2.2">${esc(LISTA.texto)}</textarea>
    <div id="listaPrev" data-testid="lista-prev"></div>`;
  openInfo({kind: 'lista'}, '📋 Agregar al inventario', body, `<button type="button" class="btn b-gh" data-a="listaCancel">Cancelar</button>
    <button type="button" class="btn b-g" data-a="listaSave" data-testid="lista-save" id="listaSave">Agregar</button>`);
  renderListaPrev();
  const ta = $('#listaTxt'); if(ta && !LISTA.texto) setTimeout(() => ta.focus(), 50);
}
const listaActivos = r => r.items.map((it, i) => ({it, i})).filter(x => !LISTA.quitar.has(x.i));
const listaPrecio = x => num(LISTA.precios[x.i]) || x.it.buyPrice || 0;
function listaModelosRecientes(){
  const vistos = [];
  L(DB, 'items').filter(i => (i.cat || guessCat(i.desc)) === 'Celulares').sort((a, b) => (+b.u || 0) - (+a.u || 0)).forEach(i => {
    const m = String(i.desc || '').replace(/\s*\d+\s*(gb|tb)\b.*$/i, '').replace(/\s+(negro|blanco|azul|desert|natural|morado|dorado|rosado|verde|rojo|gris)\b.*$/i, '').trim();
    if(m && !vistos.includes(m) && vistos.length < 4) vistos.push(m);
  });
  return vistos;
}
function renderListaPrev(){
  if(!LISTA) return;
  const box = $('#listaPrev'); if(!box) return;
  const r = parseLista(LISTA.texto, quickCtx());
  if(LISTA.modelo == null && r.items.length) LISTA.modelo = r.sugerido || '';
  const act = listaActivos(r);
  let h = '';
  if(r.items.length && r.faltaModelo){
    const sug = [r.sugerido].concat(listaModelosRecientes()).filter((x, k, a) => x && a.indexOf(x) === k).slice(0, 4);
    h += `<div class="lbl" style="margin-top:12px">¿Qué modelo son? <span class="mut">(para las líneas que no lo dicen)</span></div>
      <input class="in" id="listaModelo" data-testid="lista-modelo" type="text" autocomplete="off" value="${esc(LISTA.modelo || '')}" placeholder="Ej: iPhone 16 Pro Max">
      ${sug.length ? `<div class="opts" style="margin-top:6px">${sug.map(m => `<button type="button" class="${m === LISTA.modelo ? 'on' : ''}" data-a="listaModeloPick" data-v="${esc(m)}">${esc(m)}</button>`).join('')}</div>` : ''}`;
  }
  h += act.map(({it, i}) => {
    const p = listaPrecio({it, i});
    const name = listaDesc(it, LISTA.modelo);
    const tags = [it.cond === 'regular' ? '<span class="tag t-y">detalle</span>' : '', it.bateria ? `<span class="tag t-n">🔋 ${esc(it.bateria)}%</span>` : '',
      it.recibido ? '<span class="tag t-p">📦 Recibido en parte de pago</span>' : '<span class="tag t-b">🛒 Comprado</span>'].join('');
    return `<div class="alert" data-testid="lista-card" data-i="${i}" style="--ac:${p ? (it.recibido ? 'var(--P)' : 'var(--B)') : 'var(--Y)'};margin-top:10px">
      <div class="alert-h"><div style="min-width:0;flex:1"><div class="alert-t" style="font-weight:600">${esc(name)}</div>
      <div class="meta" style="margin-top:4px">${tags}${it.notas ? ` <span class="mut">· ${esc(it.notas)}</span>` : ''}</div></div>
      <button type="button" class="ibtn" data-a="listaQuitar" data-i="${i}" aria-label="Quitar">✕</button></div>
      ${p ? `<div class="meta" style="margin-top:6px">${it.recibido ? 'Lo recibiste valorado en' : 'Te costó'} <b class="mono">${full(p)}</b></div>`
        : `<div class="meta yel" style="margin-top:6px">Falta el precio</div><input class="in mono" data-lp="${i}" data-testid="lista-precio-${i}" inputmode="decimal" placeholder="Ej: 2.1M" style="margin-top:6px">`}
      <div class="mut" style="font-size:12px;margin-top:4px">“${esc(it.raw)}”</div></div>`;
  }).join('');
  const comprados = act.filter(x => !x.it.recibido);
  if(comprados.length){
    h += `<div class="lbl" style="margin-top:14px">¿De dónde salió la plata de ${comprados.length === 1 ? 'el comprado' : 'los ' + comprados.length + ' comprados'}?</div>
      <div class="opts" style="margin-top:6px">${pocketOpts().concat([POCKET_NONE]).map(([o, l]) => `<button type="button" class="${LISTA.pocket !== undefined && String(o) === String(LISTA.pocket) ? 'on' : ''}" data-a="listaPocket" data-v="${esc(o)}" data-testid="lista-pocket-${esc(o || 'ninguno')}">${esc(l)}</button>`).join('')}</div>`;
  }
  if(act.length) h += `<div class="lbl" style="margin-top:14px">Fecha</div><input class="in" id="listaFecha" type="date" value="${esc(LISTA.fecha)}" data-testid="lista-fecha">
    <p class="hint" style="margin-top:10px">Total: <b class="mono">${full(act.reduce((a, x) => a + listaPrecio(x), 0))}</b>${comprados.length ? ` · comprados ${full(comprados.reduce((a, x) => a + listaPrecio(x), 0))}` : ''}</p>`;
  else if(LISTA.texto.trim()) h += `<p class="hint" style="margin-top:10px">No encontré productos con precio en ese texto.</p>`;
  box.innerHTML = h;
  const btn = $('#listaSave');
  if(btn){ const miss = listaFalta(r); btn.textContent = act.length ? `Agregar ${plural(act.length, 'producto')}` : 'Agregar'; btn.classList.toggle('dim', !!miss); btn.title = miss || ''; }
}
function listaFalta(r){
  const act = listaActivos(r);
  if(!act.length) return 'Pega al menos un producto con su precio';
  if(act.some(x => !listaPrecio(x))) return 'A algún producto le falta el precio';
  if(act.some(x => !x.it.modelo) && !String(LISTA.modelo || '').trim()) return 'Escribe qué modelo son';
  if(act.some(x => !x.it.recibido) && LISTA.pocket === undefined) return 'Elige de dónde salió la plata de los comprados';
  return '';
}
function saveLista(){
  if(!LISTA) return;
  const r = parseLista(LISTA.texto, quickCtx()), miss = listaFalta(r);
  if(miss){ toast(miss, {err: true}); return; }
  const before = JSON.parse(JSON.stringify(DB));
  const act = listaActivos(r);
  let total = 0;
  act.forEach(x => {
    const it = x.it, desc = listaDesc(it, LISTA.modelo), price = listaPrecio(x);
    const notes = [it.notas, it.recibido ? 'Recibido en parte de pago' : ''].filter(Boolean).join(' · ');
    const rec = {desc, cat: guessCat(desc) !== 'Otro' ? guessCat(desc) : 'Celulares', cond: it.cond || 'bueno', buyPrice: price,
      buyPocket: it.recibido ? '' : (LISTA.pocket || ''), buyDate: LISTA.fecha || today(), status: 'stock', targetPrice: null};
    ['color', 'almac', 'bateria', 'imei'].forEach(k => { if(it[k] != null && it[k] !== '') rec[k] = it[k]; });
    if(notes) rec.notes = notes;
    put('items', rec); total += price;
  });
  const undo = undoFrom(before);
  LISTA = null;
  const q = $('#qInput'); if(q) q.value = '';
  closeInfo();
  commit(`📦 ${plural(act.length, 'producto agregado', 'productos agregados')} al stock · ${full(total)}`, {undo, ms: 8000});
}
Object.assign(ACT, {
  lista: () => openLista(''),
  listaCancel: () => { LISTA = null; closeInfo(); },
  listaSave: () => saveLista(),
  listaQuitar: el => { if(LISTA){ LISTA.quitar.add(+el.dataset.i); renderListaPrev(); } },
  listaPocket: el => { if(LISTA){ LISTA.pocket = el.dataset.v; renderListaPrev(); } },
  listaModeloPick: el => { if(LISTA){ LISTA.modelo = el.dataset.v; renderListaPrev(); } }
});
document.addEventListener('input', e => {
  if(!LISTA || !INFO || INFO.kind !== 'lista') return;
  const t = e.target;
  if(t.id === 'listaTxt'){ LISTA.texto = t.value; LISTA.quitar.clear(); clearTimeout(listaTimer); listaTimer = setTimeout(renderListaPrev, 350); }
  else if(t.id === 'listaModelo'){ LISTA.modelo = t.value; clearTimeout(listaTimer); listaTimer = setTimeout(() => { const f = document.activeElement && document.activeElement.id; renderListaPrev(); if(f === 'listaModelo'){ const m = $('#listaModelo'); if(m){ m.focus(); m.setSelectionRange(m.value.length, m.value.length); } } }, 600); }
  else if(t.id === 'listaFecha'){ LISTA.fecha = t.value; }
  else if(t.dataset && t.dataset.lp != null){ LISTA.precios[t.dataset.lp] = parseMoney(t.value); const btn = $('#listaSave'); if(btn){ const miss = listaFalta(parseLista(LISTA.texto, quickCtx())); btn.classList.toggle('dim', !!miss); } }
});
document.addEventListener('change', e => { if(LISTA && e.target && e.target.dataset && e.target.dataset.lp != null) renderListaPrev(); });

/* ═════════ 4. REGISTRO RÁPIDO Y VOZ ═════════ */
const quickCtx = () => ({
  bolsillos: pockets().map(p => ({id: p.id, nombre: p.nombre, alias: Array.isArray(p.alias) ? p.alias.slice() : []})),
  fondos: fondos().map(f => ({id: f.id, nombre: f.nombre, alias: Array.isArray(f.alias) ? f.alias.slice() : []})),
  stock: stockItems().map(i => ({id: i.id, desc: i.desc, cat: i.cat})),
  cobros: cobrosPend(DB).map(c => ({id: c.id, nombre: c.nombre})),
  reglas: L(DB, 'reglas').filter(r => r.kind === 'quick')
});

function runQuick(text){
  text = clean(text);
  const q = $('#qInput');
  if(!text){ toast('Escribe algo como “almuerzo 18 mil”'); if(q) q.focus(); return; }
  let arr = null;
  try { arr = parseQuickMulti(text, quickCtx()); } catch(e){ console.error(e); }
  arr = (arr || []).filter(r => r && FORMS[r.kind]);
  if(iaOn() && navigator.onLine !== false && typeof iaLlamar === 'function') return iaQuick(text, arr);
  quickOpen(text, arr);
}
function quickOpen(text, arr, o){
  o = o || {};
  const q = $('#qInput');
  if(!arr.length) arr = [{kind: 'gasto', d: {}}];
  if(q) q.blur();
  arr = arr.map(r => ({kind: r.kind, d: Object.assign({}, r.d || {})}));
  if(arr.length === 1 && !arr[0].d.tradeIn) openForm(arr[0].kind, Object.assign({}, arr[0].d), {fromQuick: true, parsed: JSON.parse(JSON.stringify(arr[0])), qtext: text});
  else startLote(arr, {fromQuick: true, qtext: text});           // §11.4: varias operaciones → hoja "Esto entendí"
  if(o.duda) toast('🧠 ' + o.duda, {ms: 6000});
}

/* ═════════ IA opcional (ia.js): Gemini con el contexto del negocio; lo local es el respaldo ═════════ */
const K_IAEJ = 'miapp_ia_ej';
const iaOn = () => !!(CFG && CFG.iaKey && CFG.ia !== false);
const iaEjemplos = () => { const e = loadJSON(K_IAEJ); return Array.isArray(e) ? e : []; };
/* cada frase que confirmas queda como ejemplo de cómo hablas (solo en este celular, máx. 25) */
function iaRecordar(texto, ops){
  if(!texto || typeof iaSimple !== 'function') return;
  try {
    const simple = ops.map(op => { const x = iaSimple(op); delete x.ref; delete x.fecha; delete x.fondo; return x; }).filter(x => x.kind);
    if(!simple.length) return;
    const ej = iaEjemplos().filter(e => e.t !== texto);
    ej.push({t: String(texto).slice(0, 200), ops: simple});
    saveJSON(K_IAEJ, ej.slice(-(typeof IA_MAX_EJ !== 'undefined' ? IA_MAX_EJ : 25)));
  } catch(e){}
}
const iaCtx = () => {
  const c = quickCtx();
  const st = new Map(stockItems().map(i => [i.id, i])), cp = new Map(cobrosPend(DB).map(x => [x.id, x]));
  c.stock.forEach(x => { const i = st.get(x.id); if(i) x.buyPrice = i.buyPrice; });
  c.cobros.forEach(x => { const k = cp.get(x.id); if(k) x.pend = k.pend; });
  c.contactos = L(DB, 'contactos').map(x => ({nombre: x.nombre}));
  c.reglasNombre = L(DB, 'reglas').filter(r => r.kind !== 'quick');
  return c;
};
const IA_AVISO = {cuota: '🧠 Se acabó la IA gratis por ahora: usé el lector normal', clave: '🧠 La clave de la IA no sirve: revísala en Más → Ajustes', lento: '🧠 La IA tardó mucho: usé el lector normal',
  modelo: '🧠 No encontré un modelo de IA disponible: usé el lector normal', red: ''};
const IA_AVISADO = {};
function iaAviso(err){
  const k = Object.keys(IA_AVISO).find(x => String(err).indexOf(x) === 0) || '';
  const m = k ? IA_AVISO[k] : '🧠 La IA falló (' + err + '): usé el lector normal';
  if(!m || (IA_AVISADO[k] && Date.now() - IA_AVISADO[k] < 600000)) return;
  IA_AVISADO[k] = Date.now(); toast(m, {err: k === 'clave', ms: 5000});
}
let IA_BUSY = false;
async function iaQuick(text, local){
  if(IA_BUSY) return;
  const f = $('#qForm'), go = $('#qGo'), q = $('#qInput');
  IA_BUSY = true; if(f) f.classList.add('pensando'); if(go) go.textContent = '🧠'; if(q) q.blur();
  let ops = null, err = '';
  try {
    const r = await iaLlamar(text, iaCtx(), {key: CFG.iaKey, modelo: CFG.iaModelo, ejemplos: iaEjemplos(), pista: local, hoy: today()});
    ops = r.ops;
    if(r.modelo && r.modelo !== CFG.iaModelo){ CFG.iaModelo = r.modelo; saveCfg(); }
  } catch(e){ err = String(e && e.message || e); }
  IA_BUSY = false; if(f) f.classList.remove('pensando'); if(go) go.textContent = '➤';
  const ok = (ops || []).filter(r => r && FORMS[r.kind]);
  if(!ok.length){ if(err) iaAviso(err); return quickOpen(text, local); }
  quickOpen(text, ok, {duda: ops.duda});
}
async function iaProbar(){
  const k = clean(($('#cfgIa') || {}).value || '');
  if(!k) return toast('Pega primero tu clave de IA', {err: true});
  const b = $('#iaTest'); if(b){ b.disabled = true; b.textContent = '🧠 Probando…'; }
  try {
    const r = await iaLlamar('vendí el trece pro en uno seis a camilo por neki y almuerzo 18', iaCtx(), {key: k, hoy: today()});
    const ok = r.ops && r.ops.length;
    toast(ok ? '✅ La IA funciona (' + r.modelo + '): entendió ' + r.ops.map(o => o.kind).join(' + ') : 'La IA respondió algo raro, intenta otra vez', {err: !ok, ms: 6000});
    if(ok){ CFG.iaKey = k; CFG.ia = true; CFG.iaModelo = r.modelo; saveCfg(); renderIA(); }
  } catch(e){
    const m = String(e && e.message || e);
    if(m === 'cuota'){ CFG.iaKey = k; CFG.ia = true; saveCfg(); renderIA(); }
    toast(m === 'clave' ? 'Esa clave no funciona: cópiala otra vez de Google AI Studio' : m === 'cuota' ? 'La clave sirve pero la cuota gratis está agotada por ahora' : m === 'red' ? 'Sin conexión con Google: revisa tu internet' : 'No pude probar la IA: ' + m, {err: true, ms: 6000});
  }
  if(b){ b.disabled = false; b.textContent = '🧪 Probar y guardar'; }
}
function renderIA(){
  const el = $('#iaBody');
  if(!el) return;
  const n = iaEjemplos().length, on = iaOn();
  el.innerHTML = `<p class="hint" style="margin-bottom:10px">Con la IA de Google (gratis) la app entiende mejor lo que dictas: corrige errores del dictado, la jerga y frases largas. Revisa con tu stock, tus bolsillos y quién te debe, y aprende de las frases que confirmas. Igual siempre te muestra lo que entendió antes de guardar.</p>
    <div class="fld"><label for="cfgIa">Clave de Gemini (Google AI Studio)</label>
      <input class="in" id="cfgIa" data-testid="cfg-ia" type="password" autocomplete="off" spellcheck="false" placeholder="AIza…" value="${esc(CFG.iaKey || '')}"></div>
    <div class="pbtns" style="margin-bottom:8px"><button type="button" class="btn b-b" id="iaTest" data-a="iaProbar" data-testid="ia-test">🧪 Probar y guardar</button>
      ${CFG.iaKey ? `<button type="button" class="btn b-gh" data-a="iaToggle" data-testid="ia-toggle">${on ? '⏸️ Apagar' : '▶️ Prender'}</button>` : ''}${n ? `<button type="button" class="btn b-gh" data-a="iaOlvidar">Borrar ejemplos</button>` : ''}</div>
    <p class="hint" data-testid="ia-estado">${CFG.iaKey ? (on ? '🟢 Prendida' + (CFG.iaModelo ? ' · ' + esc(CFG.iaModelo) : '') : '⚪ Apagada: uso solo el lector normal') : '⚪ Sin clave'} · ${n} frase${n === 1 ? '' : 's'} tuya${n === 1 ? '' : 's'} de ejemplo</p>
    <details style="margin-top:8px"><summary class="hint">¿Cómo saco la clave? (2 minutos, gratis)</summary><ol class="hint" style="margin:8px 0 0 18px">
      <li>Entra a <b>aistudio.google.com/apikey</b> con tu cuenta de Google.</li><li>Toca <b>Create API key</b> (Crear clave) y cópiala.</li><li>Pégala arriba y toca <b>Probar y guardar</b>.</li></ol>
      <p class="hint" style="margin-top:8px">La clave queda solo en este celular. A Google se manda la frase y un resumen (nombres de bolsillos, modelos del stock, nombres de quien te debe); no tus saldos. En la capa gratis Google puede usar lo que le mandes para mejorar sus productos.</p></details>`;
}
Object.assign(ACT, {
  iaProbar: () => iaProbar(),
  iaToggle: () => { CFG.ia = !iaOn(); saveCfg(); renderIA(); toast(CFG.ia ? '🧠 IA prendida' : 'IA apagada: uso el lector normal'); },
  iaOlvidar: () => { saveJSON(K_IAEJ, []); renderIA(); toast('Listo, borré las frases de ejemplo'); }
});

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


/* ═════════ MODO VOZ "¿Qué hiciste?" (botón de la cortina / aviso de Nequi vía MacroDroid) ═════════
   ?voz=1                     → abre esta hoja y empieza a escuchar
   ?voz=1&noti=<texto>&bol=id → con el contexto de una notificación (monto, a quién, bolsillo)
   ?q=<frase>                 → registra la frase directo (abre "Esto entendí" / el formulario para confirmar) */
let VOZ = null, VREC = null;
function vozBolsillo(id){ return pockets().find(p => p.id === id) ? id : (pockets().find(p => p.id === 'nequi') || pockets()[0] || {id: ''}).id; }
function openVoz(o){
  o = o || {};
  const n = o.noti ? parseNoti(o.noti) : null;
  VOZ = {noti: o.noti || '', n, bol: vozBolsillo(o.bol), texto: ''};
  const ctx = n && n.monto ? `<div class="alert" style="--ac:${n.dir === 'in' ? 'var(--G)' : 'var(--R)'};margin-bottom:12px" data-testid="voz-noti">
      <div class="alert-t">${n.dir === 'in' ? '⬇️ Te entraron' : n.dir === 'out' ? '⬆️ Salieron' : '💸'} <b class="mono">${full(n.monto)}</b>${n.quien ? ` · ${esc(titleCase(n.quien))}` : ''}</div>
      <div class="meta">${esc(pn(VOZ.bol))} · “${esc(o.noti)}”</div></div>` : '';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const body = ctx + `<div class="voz">
      <button type="button" class="voz-mic" id="vozMic" data-a="vozMic" data-testid="voz-mic" aria-label="Hablar">🎙️</button>
      <div class="voz-st" id="vozSt">${SR ? 'Toca y cuéntame qué hiciste' : 'Escribe o usa el micrófono del teclado'}</div>
      <div class="hint" style="margin-top:2px">${n && n.monto ? 'Ej: “almuerzo”, “envío del 13”, “abono de Camilo”, “venta del 15 pro”' : 'Ej: “vendí el 13 en 1.6 nequi”, “almuerzo 18 mil”, “compré un 14 en 1.9”'}</div></div>
    <textarea class="in" id="vozTxt" data-testid="voz-texto" rows="3" placeholder="Lo que digas aparece aquí (puedes corregirlo)"></textarea>`;
  openInfo({kind: 'voz'}, n && n.monto ? '🎙️ ¿Qué fue esto?' : '🎙️ ¿Qué hiciste?', body,
    `<button type="button" class="btn b-gh" data-a="vozLuego" data-testid="voz-luego">${n && n.monto ? 'Luego' : 'Cancelar'}</button>
     <button type="button" class="btn b-g" data-a="vozOk" data-testid="voz-ok">Registrar</button>`);
  if(SR && o.auto !== false) setTimeout(vozEscuchar, 350);
}
function vozEscuchar(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const st = $('#vozSt'), mic = $('#vozMic'), ta = $('#vozTxt');
  if(!VOZ || !mic) return;
  if(VREC){ try { VREC.stop(); } catch(e){} return; }
  if(!SR || navigator.onLine === false){ if(st) st.textContent = 'Sin dictado aquí: usa el micrófono del teclado 🎤'; if(ta) ta.focus(); return; }
  let rec; try { rec = new SR(); } catch(e){ if(ta) ta.focus(); return; }
  VREC = rec;
  rec.lang = 'es-CO'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
  const base = ta ? ta.value.trim() : '';
  rec.onstart = () => { mic.classList.add('rec'); if(st) st.textContent = 'Te escucho…'; };
  rec.onresult = e => {
    let t = ''; for(let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
    if(ta) ta.value = (base ? base + ' ' : '') + t.trim();
    const last = e.results[e.results.length - 1];
    if(last && last.isFinal && ta && ta.value.trim()) setTimeout(() => { if(VOZ && !VREC) vozRegistrar(); }, 900);   // dijo algo: lo registra solo
  };
  rec.onerror = e => { const er = e && e.error; if(st) st.textContent = er === 'no-speech' ? 'No te escuché. Toca 🎙️ otra vez' : er === 'not-allowed' ? 'Dale permiso al micrófono (o usa el del teclado)' : 'Toca 🎙️ para intentar otra vez'; };
  rec.onend = () => { if(VREC === rec) VREC = null; mic.classList.remove('rec'); if(st && st.textContent === 'Te escucho…') st.textContent = 'Toca 🎙️ para seguir hablando'; };
  try { rec.start(); } catch(e){ VREC = null; mic.classList.remove('rec'); }
}
/* arma la frase final: si vino de una notificación y no dijo monto/bolsillo, se completan con los de la notificación */
function vozFrase(txt){
  txt = clean(txt);
  const n = VOZ && VOZ.n;
  if(!n || !n.monto) return txt;
  if(!extractMonto(txt).monto) txt += ' ' + n.monto;
  const bolDicho = parseQuickMulti(txt, quickCtx()).some(r => r.d && (r.d.bolsillo || r.d.buyPocket || r.d.sellPocket || r.d.from));
  if(!bolDicho) txt += ' ' + (pn(VOZ.bol) || 'nequi').toLowerCase();
  const k = parseQuick(txt, quickCtx()).kind;
  if(n.dir === 'in' && k === 'gasto' && !/(gast|pagu|compr|cost)/i.test(txt)) txt = 'recibí ' + txt;
  return txt;
}
function vozRegistrar(){
  if(!VOZ) return;
  if(VREC){ try { VREC.stop(); } catch(e){} }
  const ta = $('#vozTxt'), raw = ta ? ta.value : '';
  if(!clean(raw)){ toast('Cuéntame qué hiciste (o toca Luego)'); return; }
  const frase = vozFrase(raw);
  if(VOZ.noti){ L(DB, 'pend').filter(x => x.raw === VOZ.noti).forEach(x => remove('pend', x.id)); saveDB(); }
  VOZ = null; closeInfo();
  const q = $('#qInput'); if(q) q.value = frase;
  setTimeout(() => runQuick(frase), 230);
}
Object.assign(ACT, {
  vozMic: () => vozEscuchar(),
  vozOk: () => vozRegistrar(),
  vozLuego: () => {
    if(VREC){ try { VREC.stop(); } catch(e){} }
    if(VOZ && VOZ.n && VOZ.n.monto){   // queda en "Por clasificar" para no olvidarlo
      put('pend', {raw: VOZ.noti, monto: VOZ.n.monto, dir: VOZ.n.dir, quien: VOZ.n.quien || '', fecha: today(), bolsillo: VOZ.bol, t: Date.now()});
      VOZ = null; closeInfo(); commit('📲 Quedó en “Por clasificar”');
    } else { VOZ = null; closeInfo(); }
  }
});


/* ═════════ PANTALLAZO DE MOVIMIENTOS → todos los gastos y entradas de una (movs.js) ═════════ */
let FMOV = null;   // {lista, bolsillo, saldo, origen: 'foto'|'pend'}
const MV_ACC = [['pend', '📲 Por clasificar (luego)'], ['ingreso', '➕ Ingreso (no es venta)'], ['ignorar', '🚫 No registrar']];
function fotoMovsBolsillo(texto){
  const t = normKey(texto), ps = pockets();
  const banco = ps.find(p => p.id !== 'nequi' && p.id !== 'efectivo' && normKey(p.nombre).length > 3 && t.includes(normKey(p.nombre)) && !/nequi/.test(t));
  return (banco || ps.find(p => p.id === 'nequi') || ps[0] || {id: ''}).id;
}
function openFotoMovs(texto, r){
  const movs = parseMovimientos(texto, {hoy: today()});
  if(!movs.length){
    const tel = r && (r.imei || r.bateria);
    toast(tel ? 'Esa foto es la info de un celular: ábrela desde el producto en Stock (📷 Leer datos)' : 'No encontré movimientos en la foto. Usa el pantallazo de la lista de movimientos, que se vean los montos con $', {err: true, ms: 6500});
    return;
  }
  const bolsillo = fotoMovsBolsillo(texto);
  fotoMovsMostrar(clasificarMovs(DB, movs, {bolsillo}), {bolsillo, saldo: movs.saldo, origen: 'foto'});
}
/* "Por clasificar" completo → la misma hoja de revisión (cada uno con su bolsillo) */
function openPendTodos(){
  const pend = L(DB, 'pend');
  if(!pend.length) return;
  const grupos = {};
  pend.forEach(p => { const b = p.bolsillo || 'nequi'; (grupos[b] = grupos[b] || []).push(p); });
  let lista = [];
  Object.keys(grupos).forEach(b => {
    const movs = grupos[b].map(p => ({pendId: p.id, raw: p.raw || '', fecha: p.fecha || today(), desc: mvSinBasura(p.quien || p.raw || 'Movimiento'), quien: mvSinBasura(p.quien || ''), monto: +p.monto || 0, dir: p.dir || '?'}));
    lista = lista.concat(clasificarMovs(DB, movs, {bolsillo: b}));
  });
  lista.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  fotoMovsMostrar(lista, {origen: 'pend'});
}
/* la app ya decidió; si hay IA, ella revisa lo dudoso antes de mostrarlo */
async function fotoMovsMostrar(lista, o){
  FMOV = Object.assign({lista, bolsillo: o.bolsillo || '', saldo: o.saldo, origen: o.origen}, {});
  const dudosos = lista.filter(m => !m.ya && (m.accion === 'pend' || m.accion === 'gasto' && m.cat === 'Otro')).length;
  if(iaOn() && navigator.onLine !== false && typeof iaRevisarMovs === 'function' && dudosos){
    openInfo({kind: 'movs'}, '🧠 Revisando…', `<p class="hint" data-testid="movs-ia-espera">La app ya organizó ${plural(lista.length, 'movimiento')}. La IA está revisando ${plural(dudosos, 'que quedó dudoso', 'que quedaron dudosos')}…</p><div class="bar"><i style="width:60%"></i></div>`,
      '<button type="button" class="btn b-gh" disabled>Revisando…</button>');
    const yo = FMOV;
    try {
      const r = await iaRevisarMovs(lista, iaCtx(), {key: CFG.iaKey, modelo: CFG.iaModelo, ejemplos: iaEjemplos(), hoy: today(), timeout: 15000});
      if(FMOV !== yo) return;
      if(r && r.lista){ FMOV.lista = r.lista; FMOV.iaCambios = r.lista.cambios || 0; }
    } catch(e){ if(FMOV !== yo) return; iaAviso(String(e && e.message || e)); }
  }
  renderFotoMovs();
}
function fotoMovsOpts(m){
  const o = [], b = m.bolsillo || FMOV.bolsillo;
  if(m.dir !== 'in') GCATS.forEach(c => o.push(['gasto:' + c, '💸 Gasto · ' + c]));
  if(m.dir !== 'out') cobrosPend(DB).forEach(c => o.push(['abono:' + c.id, '💵 Abono de ' + c.nombre + ' (debe ' + fmt(c.pend) + ')']));
  pockets().filter(p => p.id !== b).forEach(p => {
    if(m.dir !== 'in') o.push(['mover:' + p.id, '🔁 Lo pasé a ' + p.nombre]);
    if(m.dir !== 'out') o.push(['mover:' + p.id, '🔁 Vino de ' + p.nombre]);
  });
  MV_ACC.forEach(([k, l]) => { if(k === 'ingreso' && m.dir === 'out') return; o.push([k, k === 'ignorar' && FMOV.origen === 'pend' ? '🚫 Ignorar (no es nada / ya está)' : l]); });
  return o;
}
const fotoMovsVal = m => m.accion === 'gasto' ? 'gasto:' + (m.cat || 'Otro') : m.accion === 'abono' ? 'abono:' + m.cobroId : m.accion === 'mover' ? 'mover:' + m.otro : m.accion;
function renderFotoMovs(){
  if(!FMOV) return;
  const L0 = FMOV.lista, pendO = FMOV.origen === 'pend';
  const hace = L0.filter(m => m.accion !== 'pend' && !(m.accion === 'ignorar' && !pendO));
  const ya = L0.filter(m => m.ya).length, quedan = L0.filter(m => m.accion === 'pend').length;
  let top = '';
  if(!pendO){
    const cuenta = L0.filter(m => ['gasto', 'ingreso', 'abono', 'mover'].includes(m.accion));   // "por clasificar" todavía no mueve saldos
    const ent = sum(cuenta.filter(m => m.dir === 'in'), 'monto'), sal = sum(cuenta.filter(m => m.dir !== 'in'), 'monto');
    const segs = pockets().map(p => `<button type="button" class="${p.id === FMOV.bolsillo ? 'on' : ''}" data-a="movsBol" data-id="${esc(p.id)}">${esc(p.nombre)}</button>`).join('');
    const app = balances(DB)[FMOV.bolsillo] || 0;
    top = `<div class="lbl" style="margin-bottom:6px">¿De qué bolsillo es?</div><div class="seg" style="margin-bottom:10px">${segs}</div>` +
      (FMOV.saldo != null ? `<div class="hint" style="margin:-2px 0 10px" data-testid="movs-saldo">El pantallazo dice <b class="mono">${full(FMOV.saldo)}</b> · la app (después de guardar) dirá <b class="mono">${full(app + ent - sal)}</b>${Math.abs(app + ent - sal - FMOV.saldo) > 1 ? ' · si no cuadra, al guardar te ofrezco cuadrarlo' : ' ✅'}</div>` : '');
  }
  const res = pendO
    ? `Tienes <b>${L0.length}</b> por clasificar. Ya dejé listos <b>${hace.length}</b>${ya ? ` (${ya} ya estaba${ya === 1 ? '' : 'n'} registrado${ya === 1 ? '' : 's'}: se quitan)` : ''}${quedan ? ` · <b>${quedan}</b> necesita${quedan === 1 ? '' : 'n'} que me digas qué fue${quedan === 1 ? '' : 'ron'}` : ''}.`
    : `Encontré <b>${L0.length}</b> movimiento${L0.length === 1 ? '' : 's'}${ya ? ` · <b>${ya}</b> ya estaba${ya === 1 ? '' : 'n'} registrado${ya === 1 ? '' : 's'}` : ''}.`;
  const filas = L0.map((m, i) => {
    const amt = m.dir === 'in' ? `<span class="pos">+${full(m.monto)}</span>` : m.dir === 'out' ? `<span class="neg">−${full(m.monto)}</span>` : `<span class="yel">${full(m.monto)}</span>`;
    const opts = fotoMovsOpts(m).map(([k, l]) => `<option value="${esc(k)}"${k === fotoMovsVal(m) ? ' selected' : ''}>${esc(l)}</option>`).join('');
    return `<div class="mvrow${m.accion === 'ignorar' ? ' off' : ''}${m.accion === 'pend' ? ' duda' : ''}" data-testid="movs-row" data-i="${i}">
      <div class="mvh"><div class="mvd">${esc(m.desc2 && m.desc2 !== m.desc ? m.desc2 : m.desc)}</div><div class="mono">${amt}</div></div>
      <div class="mvm">${fdE(m.fecha)}${pendO ? ' · ' + esc(pn(m.bolsillo)) : ''}${m.ya ? ` · <span class="yel">ya está (${esc(m.ya)})</span>` : m.porQue ? ` · ${esc(m.porQue)}` : ''}</div>
      <select class="in mvsel" data-movs="${i}" data-testid="movs-sel" aria-label="Qué fue">${opts}</select></div>`;
  }).join('');
  const iaTxt = FMOV.iaCambios ? `<p class="hint" style="margin-bottom:10px" data-testid="movs-ia">🧠 La IA revisó y corrigió ${plural(FMOV.iaCambios, 'movimiento')} (marcados con 🧠).</p>` : '';
  const body = `${top}<p class="hint" style="margin-bottom:10px" data-testid="movs-resumen">${res} Revisa y cambia lo que haga falta.${quedan ? ' Lo que siga “por clasificar” lo terminas después con los botones de siempre.' : ''}</p>${iaTxt}${filas}`;
  const n = pendO ? L0.filter(m => m.accion !== 'pend').length : L0.filter(m => m.accion !== 'ignorar').length;
  openInfo({kind: 'movs'}, pendO ? '⚡ Clasificar todos' : '📸 Movimientos del pantallazo', body,
    `<button type="button" class="btn b-gh" data-a="movsCancel">Cancelar</button>
     <button type="button" class="btn b-g" data-a="movsSave" data-testid="movs-save"${n ? '' : ' disabled'}>${pendO ? 'Aplicar ' : 'Guardar '}${n}</button>`);
}
function fotoMovsSet(i, val){
  const m = FMOV && FMOV.lista[i];
  if(!m) return;
  const [k, x] = String(val).split(':');
  m.accion = k; m.ya = ''; m.ia = false; m.tocado = true;
  if(k === 'gasto'){ m.cat = x; m.tipo = NEG_CATS.includes(x) ? 'negocio' : 'personal'; }
  if(k === 'abono') m.cobroId = x;
  if(k === 'mover') m.otro = x;
  renderFotoMovs();
}
function saveFotoMovs(){
  if(!FMOV) return;
  const before = {}; COLS.forEach(c => { before[c] = (DB[c] || []).map(r => Object.assign({}, r)); });
  const cuenta = {gasto: 0, ingreso: 0, abono: 0, pend: 0, mover: 0, ignorar: 0}, pendO = FMOV.origen === 'pend';
  FMOV.lista.forEach(m => {
    const b = m.bolsillo || FMOV.bolsillo;
    const desc = clean(m.desc2 || m.quien || m.desc) || (m.dir === 'in' ? 'Entrada' : 'Gasto');
    let rec = null;
    switch(m.accion){
      case 'gasto': rec = put('gastos', {desc, valor: m.monto, cat: m.cat || 'Otro', tipo: m.tipo || (NEG_CATS.includes(m.cat) ? 'negocio' : 'personal'), bolsillo: b, fecha: m.fecha}); break;
      case 'ingreso': rec = put('ingresos', {desc, valor: m.monto, bolsillo: b, fecha: m.fecha}); break;
      case 'abono': if(!get('cobros', m.cobroId)) return; rec = put('abonos', {cobroId: m.cobroId, monto: m.monto, bolsillo: b, fecha: m.fecha}); break;
      case 'mover': if(!m.otro || m.otro === b) return; rec = put('transfers', m.dir === 'in' ? {from: m.otro, to: b, monto: m.monto, fecha: m.fecha} : {from: b, to: m.otro, monto: m.monto, fecha: m.fecha}); break;
      case 'pend': if(m.pendId) return; put('pend', {raw: m.raw, monto: m.monto, dir: m.dir, quien: m.quien || m.desc, fecha: m.fecha, bolsillo: b, t: Date.now()}); break;
      case 'ignorar': if(!m.pendId) return; break;
      default: return;
    }
    if(m.pendId) remove('pend', m.pendId);
    // aprende el nombre → la próxima vez sale solo ("como la vez pasada")
    const k = normKey(m.quien);
    if(rec && k && k.split(' ').length <= 6 && !/^(pago|compra|envio|retiro|recarga|transferencia)$/.test(k)){
      if(m.accion === 'gasto' || m.accion === 'ingreso') put('reglas', {id: k, kind: m.accion, desc: rec.desc || '', cat: rec.cat || '', tipo: rec.tipo || '', from: '', to: ''});
      if(m.accion === 'mover') put('reglas', {id: k, kind: 'transfer', desc: '', cat: '', tipo: '', from: rec.from, to: rec.to});
    }
    cuenta[m.accion]++;
  });
  const saldo = FMOV.saldo, bol = FMOV.bolsillo;
  FMOV = null; closeInfo();
  const partes = [['gasto', 'gasto'], ['ingreso', 'ingreso'], ['abono', 'abono'], ['mover', 'movimiento entre bolsillos'], ['ignorar', 'ignorado'], ['pend', 'por clasificar']]
    .filter(([k]) => cuenta[k]).map(([k, l]) => cuenta[k] + ' ' + (k === 'pend' || cuenta[k] === 1 ? l : l.replace(/^(\w+)/, '$1s')));
  commit((pendO ? '⚡ Listo: ' : '📸 Guardé ') + (partes.join(' · ') || 'nada'), {undo: undoFrom(before), ms: 7000});
  if(!pendO && saldo != null && Math.abs((balances(DB)[bol] || 0) - saldo) > 1) setTimeout(() => openForm('ajuste', {bolsillo: bol, real: String(saldo)}), 600);
}
Object.assign(ACT, {
  movsFoto: () => ocrPick('movs'),
  pendTodos: () => openPendTodos(),
  movsBol: el => { if(FMOV){ FMOV.bolsillo = el.dataset.id; FMOV.lista.forEach(m => { m.bolsillo = el.dataset.id; if(m.accion === 'mover' && m.otro === el.dataset.id) m.accion = 'pend'; }); renderFotoMovs(); } },
  movsSave: () => saveFotoMovs(),
  movsCancel: () => { FMOV = null; closeInfo(); }
});

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
      /* §13.4: un enlace de captura por cada bolsillo digital (el de Nequi pareja va en el celular de la pareja) */
      links = digitalPockets().map(p => ['Macro A · ' + p.nombre + ' → App (POST)', cloudURL({action: 'capture', key: CFG.key, bolsillo: p.id}),
        p.id === 'nequi_pareja' ? 'Va en el celular de tu pareja (si instala MacroDroid): lo que llegue a su Nequi entra como ' + p.nombre + '.' : ''])
        .concat([
          ['Macro B · Resumen semanal (GET)', cloudURL({action: 'summary', key: CFG.key}), ''],
          ['Macro C · Recordatorios (GET)', cloudURL({action: 'reminders', key: CFG.key}), '']
        ]);
    } catch(e){ links = []; }
    h = links.map(([l, url, note]) => `<div class="fld"><label>${esc(l)}</label><div class="copy">
      <input class="in" readonly value="${esc(url)}" aria-label="${esc(l)}">
      <button type="button" class="btn b-gh" data-a="copy" data-t="${esc(url)}" data-n="${esc(l)}">Copiar</button></div>${note ? `<span class="note">${esc(note)}</span>` : ''}</div>`).join('') +
      '<p class="hint" style="margin-bottom:12px">Pégalo en el campo URL de la acción “Solicitud HTTP” de MacroDroid (la guía tiene el paso a paso).</p>';
  } else h = '<p class="hint" style="margin-bottom:12px">Primero conecta tu nube arriba; aquí aparecerán los enlaces listos para copiar.</p>';
  $('#mdLinks').innerHTML = h;
  $('#cfgTest').disabled = !hasCloud();
  $('#cfgSync').disabled = !hasCloud();
  renderAprendido();
  if(document.activeElement !== $('#cfgIa')) renderIA();
  $('#appVer').textContent = APP_VERSION;
  $('#appCount').textContent = String(COLS.reduce((a, c) => a + L(DB, c).length, 0));
}

/* Más → Ajustes → "Lo que he aprendido" (§12.3): reglas del registro rápido y de Nequi, cada una con Olvidar */
function renderAprendido(){
  const el = $('#aprBody');
  if(!el) return;
  const rs = L(DB, 'reglas'), q = rs.filter(r => r.kind === 'quick').sort((a, b) => String(a.palabra || a.id).localeCompare(String(b.palabra || b.id)));
  const nq = rs.filter(r => r.kind !== 'quick').sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const line = (r, t, s) => `<div class="kvline" data-testid="regla" data-id="${esc(r.id)}"><span style="min-width:0">${t}<br><small class="mut">${esc(s)}</small></span>
    <button type="button" class="btn b-gh" data-a="olvidar" data-id="${esc(r.id)}" data-testid="olvidar">Olvidar</button></div>`;
  let h = '';
  if(q.length) h += `<p class="hint" style="margin-bottom:2px">Cuando escribes una frase:</p>` + q.map(r => line(r, `<b>${esc(r.palabra || r.id.replace(/^q:/, ''))}</b> → ${esc(quickRuleTxt(r) || '—')}`, 'Lo aprendí cuando lo corregiste')).join('');
  if(nq.length) h += `<p class="hint" style="margin:10px 0 2px">Movimientos de Nequi (“↻ Igual que antes”):</p>` + nq.map(r => line(r, `📲 <b>${esc(r.id)}</b> → ${esc(ruleLabel(r))}`, 'Por clasificar')).join('');
  el.innerHTML = h || '<p class="hint">Todavía nada. Cuando corrijas algo que escribiste (p. ej. “domicilio” de Comida a Envíos), lo recuerdo para la próxima.</p>';
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
    DB = ensureSeeds(mergeDB(DB, j));   // une, no reemplaza: por id gana el más reciente
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
  document.addEventListener('change', e => { const el = e.target; if(el && el.dataset && el.dataset.movs != null) fotoMovsSet(+el.dataset.movs, el.value); });
  $('#qInput').addEventListener('paste', e => {
    const cd = e.clipboardData || window.clipboardData || {getData: () => ''};
    const img = Array.from(cd.files || []).filter(f => /^image\//.test(f.type));
    if(img.length && typeof leerImagenes === 'function'){ e.preventDefault(); OCR = {mode: 'movs'}; ocrRun(img); return; }
    const txt = cd.getData('text') || '';
    if(/\n/.test(txt.trim()) && parseLista(txt, quickCtx()).items.length >= 2){ e.preventDefault(); openLista(txt); }
  });

  /* controles con estado (markup estático: no pierden el foco al pintar) */
  $('#stSearch').addEventListener('input', e => { UI.stQ = e.target.value; renderStock(); });
  $('#stSeg').addEventListener('click', e => { const b = e.target.closest('button[data-seg]'); if(b){ UI.stSeg = b.dataset.seg; renderStock(); } });
  $('#mvPrev').addEventListener('click', () => { UI.mvMonth = ymAdd(UI.mvMonth, -1); renderMovs(); });
  $('#mvNext').addEventListener('click', () => { if(UI.mvMonth < today().slice(0, 7)){ UI.mvMonth = ymAdd(UI.mvMonth, 1); renderMovs(); } });
  $('#mvFil').addEventListener('click', e => { const b = e.target.closest('button[data-f]'); if(b){ UI.mvF = b.dataset.f; renderMovs(); } });
  $('#masSeg').addEventListener('click', e => { const b = e.target.closest('button[data-seg]'); if(b){ UI.masSeg = b.dataset.seg; renderMas(); } });
  $('#dnSeg').addEventListener('click', e => { const b = e.target.closest('button[data-seg]'); if(b){ UI.dnSeg = b.dataset.seg; renderDinero(); } });
  $('#mvFondo').addEventListener('change', e => { UI.mvFondo = e.target.value; renderMovs(); });
  $('#refQ').addEventListener('input', e => { UI.refQ = e.target.value; renderRefQuick(); });
  $('#ocrFile').addEventListener('change', e => { const fs = Array.from(e.target.files || []); if(fs.length) ocrRun(fs); else OCR = null; });
  $('#refForm').addEventListener('submit', e => { e.preventDefault(); ACT.refBuscar(); });
  $('#ctQ').addEventListener('input', e => { UI.ctQ = e.target.value; renderContactos(); });
  document.addEventListener('keydown', e => { if((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('[role=button][data-a]')){ e.preventDefault(); e.target.click(); } });
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
    const fo = e.target.closest('[data-fold]');            // "Datos del equipo ▾"
    if(fo && F){ const k = fo.dataset.fold; F.v[k] = F.v[k] ? '' : '1'; fo.setAttribute('aria-expanded', String(!!F.v[k])); const ar = fo.querySelector('span'); if(ar) ar.textContent = F.v[k] ? '▴' : '▾'; refreshShow(); return; }
    const rt = e.target.closest('[data-ref-toggle]');      // referencia de precios: ver detalle
    if(rt){ const d = rt.parentElement.querySelector('.refdet'); if(d){ d.hidden = !d.hidden; rt.setAttribute('aria-expanded', String(!d.hidden)); } return; }
    const ru = e.target.closest('[data-ref-use]');         // "Usar $2.6M"
    if(ru && F){ const k = ru.dataset.refUse; setVal(k, +ru.dataset.v); onField(k); toast('Listo: ' + full(+ru.dataset.v)); return; }
    const tg = e.target.closest('[data-fondo-toggle]');      // chip "Plata de: … ▾" → despliega los apartados
    if(tg){ const o = tg.parentElement.querySelector('.opts'); if(o){ o.hidden = !o.hidden; tg.setAttribute('aria-expanded', String(!o.hidden)); } return; }
    const b = e.target.closest('.opts button[data-v]');
    if(!b || !F) return;
    const k = b.parentElement.dataset.k;
    setVal(k, b.dataset.v);
    onField(k);
    const fc = b.closest('.fchip');
    if(fc){ b.parentElement.hidden = true; const t = $('.fchip-b', fc); if(t) t.setAttribute('aria-expanded', 'false'); }
  });
  body.addEventListener('focusout', e => {
    const el = e.target;
    if(F && el && el.classList && el.classList.contains('money') && el.value.trim() && F.v[el.name]){ el.value = miles(F.v[el.name]); moneyEq(el.name); }
  });
  body.addEventListener('focusin', e => {
    const el = e.target;
    if(el && el.matches && el.matches('input,select,textarea')) setTimeout(() => { try { el.scrollIntoView({block: 'center', behavior: 'smooth'}); } catch(_){} }, 300);
  });
  $('#sheetForm').addEventListener('submit', e => { e.preventDefault(); if(SHEET === 'lote') saveLote(); else saveForm(); });
  $('#sheetX').addEventListener('click', closeSheet);
  $('#sheet').addEventListener('click', e => { if(e.target === e.currentTarget) closeSheet(); });
  window.addEventListener('popstate', () => { if(F && F.lote != null) closeForm(); else closeSheet(); });
  document.addEventListener('keydown', e => { if(e.key === 'Escape') closeSheet(); });

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
  DB = ensureSeeds(mergeDB(emptyDB(), loadJSON(K_DB) || {}));
  saveDB();
  UI.mvMonth = UI.anMonth = today().slice(0, 7);
  bindEvents();
  setSync(hasCloud() ? (navigator.onLine === false ? 'nosig' : 'ok') : 'off', '');

  let qs;
  try { qs = new URLSearchParams(location.search); } catch(e){ qs = new URLSearchParams(''); }
  const v0 = qs.get('v'), voz = qs.get('voz') === '1', noti = qs.get('noti') || '', bolQ = qs.get('bol') || '', qDirect = qs.get('q') || '';
  if(v0 || voz || noti || qDirect){ try { history.replaceState(null, '', location.pathname); } catch(e){} }
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
  if(!UI.onb){
    if(qDirect) setTimeout(() => { const q = $('#qInput'); if(q) q.value = qDirect; runQuick(qDirect); }, 250);
    else if(voz || noti) setTimeout(() => openVoz({noti, bol: bolQ}), 250);
  }
}

init();
