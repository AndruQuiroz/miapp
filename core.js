/* ═══════════════════════════════════════════════
   core.js — lógica compartida entre la app y Google Apps Script
   (sin DOM: funciona en el navegador y en el servidor)
═══════════════════════════════════════════════ */
const COLS = ['items','gastos','ingresos','cobros','abonos','transfers','ajustes','pend','bolsillos','reglas','fondos','repartos'];

/* ── Semillas: mismo id y u:1 en todos los dispositivos → nunca se duplican al sincronizar ──
   Bolsillo = DÓNDE está la plata. Apartado (fondos) = PARA QUÉ es la plata (SPEC §13). */
const SEED_BOLSILLOS = [
  {id:'efectivo', nombre:'Efectivo', ini:0, alias:['efectivo','cash','fisico','billete','plata en mano','en mano'], u:1},
  {id:'nequi', nombre:'Nequi', ini:0, alias:['nequi','mi nequi','neki','nequy'], u:1},
  {id:'nequi_pareja', nombre:'Nequi pareja', ini:0, alias:['nequi de mi pareja','pareja','mi novia','mi esposa','mi mujer','mi amor','de ella'], u:1}
];
const SEED_FONDOS = [
  {id:'negocio', nombre:'Negocio', emoji:'💼', alias:['negocio','capital','del negocio','plata del negocio'], orden:0, u:1},
  {id:'personal', nombre:'Personal', emoji:'👤', alias:['personal','lo personal','mi plata','para mi'], orden:1, u:1}
];
const copiaSemilla = r => JSON.parse(JSON.stringify(r));

function emptyDB(){
  const d = {};
  COLS.forEach(c => d[c] = []);
  d.bolsillos = SEED_BOLSILLOS.map(copiaSemilla);
  d.fondos = SEED_FONDOS.map(copiaSemilla);
  return d;
}

/* Completa una DB existente (p. ej. de una versión anterior): crea las colecciones que falten y agrega
   las semillas que no estén. NUNCA toca un registro que ya existe (ni si está borrado ni si el usuario
   lo editó); la única excepción es darle sus alias a una semilla que sigue intacta (u ≤ 1, sin alias),
   lo cual es idéntico en todos los dispositivos. Idempotente. Modifica `db` y lo devuelve. */
function ensureSeeds(db){
  db = db || {};
  COLS.forEach(c => { if(!Array.isArray(db[c])) db[c] = []; });
  const completar = (col, seeds) => {
    const out = db[col].slice();
    seeds.forEach(s => {
      const i = out.findIndex(r => r && r.id === s.id);
      if(i < 0) out.push(copiaSemilla(s));
      else {
        const r = out[i];
        // mismo orden de claves que la semilla → el JSON es idéntico en todos los dispositivos
        if((+r.u || 0) <= 1 && !r.del && !Array.isArray(r.alias)) out[i] = Object.assign(copiaSemilla(s), r, {alias: s.alias.slice()});
      }
    });
    db[col] = out;
  };
  completar('bolsillos', SEED_BOLSILLOS);
  completar('fondos', SEED_FONDOS);
  return db;
}

/* Une dos bases: por cada registro gana el más reciente (campo u). Los borrados son {del:1}.
   Empate de u (mismo ms en dos dispositivos): gana el borrado y, si no, el JSON mayor → el resultado
   NO depende del orden (a,b) y los dispositivos siempre convergen. */
function mergeDB(a, b){
  const out = {};
  a = a || {}; b = b || {};
  const gana = (r, p) => {
    const ur = +r.u || 0, up = +p.u || 0;
    if(ur !== up) return ur > up;
    if(!!r.del !== !!p.del) return !!r.del;
    return JSON.stringify(r) > JSON.stringify(p);
  };
  COLS.forEach(c => {
    const m = new Map();
    [...(a[c] || []), ...(b[c] || [])].forEach(r => {
      if(!r || r.id == null) return;
      const p = m.get(r.id);
      if(!p || gana(r, p)) m.set(r.id, r);
    });
    out[c] = [...m.values()];
  });
  return out;
}

const L = (db, c) => ((db && db[c]) || []).filter(x => !x.del);
const sum = (arr, k) => arr.reduce((s, x) => s + (+(k ? x[k] : x) || 0), 0);

/* ── Fechas y formato ── */
const ymd = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
// En Apps Script usamos la zona de Colombia explícita; en el celular, la hora local del teléfono.
const today = () => (typeof Utilities !== 'undefined' && Utilities.formatDate)
  ? Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd')
  : ymd(new Date());
const shiftDate = (s, n) => { const [y,m,d] = s.split('-').map(Number); return ymd(new Date(y, m-1, d+n)); };
const daysBetween = (a, b) => {
  if(!a || !b) return 0;
  const p = s => { const [y,m,d] = String(s).split('-').map(Number); return Date.UTC(y, m-1, d); };
  return Math.max(0, Math.round((p(b) - p(a)) / 864e5));
};
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const fmt = n => {
  n = +n || 0; const a = Math.abs(n), s = n < 0 ? '-' : '';
  if(a >= 999500) return s + '$' + (a/1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/,'') + 'M'; // 999.500+ ya redondea a $1M (antes salía "$1000K")
  if(a >= 1e3) return s + '$' + Math.round(a/1e3) + 'K';
  return s + '$' + Math.round(a);
};
const full = n => { n = Math.round(+n || 0); return (n < 0 ? '-' : '') + '$' + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
const fd = d => { if(!d) return '—'; const [y,m,dy] = String(d).split('-'); return dy + '/' + m + '/' + String(y).slice(2); };
const monthLabel = ym => { const [y,m] = ym.split('-'); return MESES[+m-1] + ' ' + y.slice(2); };

/* ── Montos en lenguaje natural: "1.2M", "50k", "50 mil", "1.200.000", "$ 50.000,00", "1 millón 200 mil" ── */
function extractMonto(text){
  const t = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
  const B = '(?=[\\s.,;:!?)\\]}"\'»”’]|$)';   // la unidad no puede ir pegada a una letra/dígito; sí a ")", ";", comillas…
  const D = '(?:\\$\\s?)?';                    // "$50k" / "$ 50 mil": el $ se consume con el monto (no queda suelto en rest)
  // Entero suelto de 4+ cifras ("tinto 2500"). Un año tras "modelo/año/del/versión/edición" NO es plata ("moto modelo 2024").
  const pelado = () => {
    const re = /(?:^|\s)(\d{4,})(?=[\s.,!?]|$)/g; let x;
    while((x = re.exec(t))){
      if(/^(?:19|20)\d\d$/.test(x[1]) && /(?:^|\s)(?:modelo|mod\.?|a[nñ]o|del|versi[oó]n|edici[oó]n)\s*:?\s*$/.test(t.slice(0, x.index))) continue;
      return x;
    }
    return null;
  };
  let m, monto = 0;
  if((m = t.match(new RegExp(D + '(\\d+(?:[.,]\\d+)?)\\s*(?:m|mill[oó]n(?:es)?|palos?|mel[oó]n(?:es)?)' + B + '(?:\\s*(?:y\\s*)?(\\d+)\\s*(?:k|mil|lucas?)' + B + ')?')))){
    monto = parseFloat(m[1].replace(',', '.')) * 1e6 + (m[2] ? +m[2] * 1e3 : 0);
  } else if((m = t.match(new RegExp(D + '(\\d+(?:[.,]\\d+)?)\\s*(?:k|mil|lucas?|barras?)' + B)))){
    monto = parseFloat(m[1].replace(',', '.')) * 1e3;
  } else if((m = t.match(/\$?\s?(\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?(?!\d)/))){
    monto = +m[1].replace(/\./g, '');
  } else if((m = t.match(/\$\s?(\d+)/)) || (m = pelado())){
    monto = +m[1];
  }
  // quitar EXACTAMENTE la ocurrencia que dio el monto (por posición, no la primera que se parezca)
  const rest = (m ? t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length) : t).replace(/\s+/g, ' ');
  return {monto: Math.round(monto) || 0, rest};
}

function parseMoney(s){
  s = String(s == null ? '' : s).trim();
  if(!s) return 0;
  if(/^\d+$/.test(s)) return +s;
  const r = extractMonto(s).monto;
  if(r) return r;
  return Math.round(parseFloat(s.replace(/\./g, '').replace(',', '.'))) || 0;
}

/* ── Notificaciones bancarias (Nequi, Bancolombia, etc.) ── */
// Reemplazada por la propuesta de DOCS (docs/parseNoti-propuesta.js, SPEC §10.6): sin OTP/códigos como monto, promos → monto 0,
// solicitudes/pagos pendientes → dir "?", y "quien" con remitente antes del verbo, llaves Bre-B, celulares y bancos. Ver tests/CAMBIOS-core.md.
function parseNoti(text){
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const low = t.toLowerCase();

  /* ── Verbos ── */
  const IN_STRONG  = /(recibiste|recibid[oa]|acredit|\bte (?:envi|mand|transfiri|consign|pag|devolvi)\w*|te lleg\w*|lleg[oó] plata|consignaron|recarga exitosa|recargaste|devoluci|reembols|ingres)/;
  const OUT_STRONG = /(enviaste|env[ií]o exitoso|pagaste|pago exitoso|compraste|compra exitosa|retiraste|retiro exitoso|sacaste|transferiste|se descont|descont|d[eé]bito)/;
  const OUT_WEAK   = /(compra |retir|pago |pagos? en|cobro)/;
  const PENDING    = /(pendiente|ac[eé]ptalo|rech[aá]zalo|\bacepta\b|\brechaza\b|te pidi[oó]|te solicit|solicitud|por aprobar)/;
  const PROMO      = /(\bgana(?:r|s)?\b|\bhasta \$|premio|sorteo|participa|descuento|oferta|promo|regalo|gratis|cashback|aprovecha|invita|sugerido|campa[nñ]a|beneficio|te prestamos|pr[eé]stamo)/;

  /* ── Monto: solo con "$"; sin "$" únicamente si dice COP/pesos o miles con punto/k/mil ── */
  let monto = 0;
  const m = t.match(/\$\s?([\d.,]+)/);
  if(m){
    monto = +m[1].replace(/[.,]$/, '').replace(/[.,]\d{1,2}$/, '').replace(/[.,]/g, '') || 0;
  } else if(/\bcop\b|pesos|\d{1,3}(?:\.\d{3})+|\d\s*(?:k|mil|millones?|m)\b/i.test(t)){
    monto = extractMonto(t).monto;
  }

  /* ── Dirección ── */
  let dir = '?';
  if(PENDING.test(low)) dir = '?';
  else if(IN_STRONG.test(low)) dir = 'in';
  else if(OUT_STRONG.test(low)) dir = 'out';
  else if(OUT_WEAK.test(low) && !PROMO.test(low)) dir = 'out';

  // Promo sin verbo fuerte de movimiento → no es un movimiento
  if(!IN_STRONG.test(low) && !OUT_STRONG.test(low) && !PENDING.test(low) && PROMO.test(low)) monto = 0;
  // Aviso de SALDO ("Tu saldo en Nequi es $1.234.567"): no es un movimiento (agregado por QA; si trae verbo de movimiento se respeta)
  if(/\bsaldo\b/.test(low) && !IN_STRONG.test(low) && !OUT_STRONG.test(low) && !OUT_WEAK.test(low) && !PENDING.test(low)) monto = 0;
  if(!monto) return {monto: 0, dir, quien: ''};

  /* ── Quién ── */
  let quien = '';
  const BL = /^(nequi|tu |su |el |la |los |las |un |una |bancolombia|daviplata|cuenta|colombia|forma|manera)/i;
  const NOT_NAME = /^(nequi|alguien|tu|te|la|el)$/i;
  let q;

  // (a) "JUAN PEREZ te envió/mandó/pidió …"  (nombre ANTES del verbo)
  if((q = t.match(/(?:^|[!¡?.:]\s*)(?:nequi\s+)?([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ' ]{1,40}?)\s+te\s+(?:envi|mand|transfiri|consign|pag|pidi|solicit|devolvi)\w*/i)) && !NOT_NAME.test(q[1].trim())){
    quien = q[1].trim();
  }
  // (b) llave Bre-B: "a la llave @luisgomez"
  if(!quien && (q = t.match(/\b(?:a|de|desde|para)\s+la\s+llave\s+(\S+?)(?=[\s.,;!?]|$)/i))) quien = q[1];
  // (c) celular de 10 dígitos: "a 3001234567"
  if(!quien && (q = t.match(/\b(?:a|de|desde|para)\s+(3\d{2}[ -]?\d{3}[ -]?\d{4})\b/i))) quien = q[1].replace(/[ -]/g, '');
  // (d) regla original: (a|de|en|desde|para) + nombre
  if(!quien){
    const re = /(?:^|\s)(?:a|de|en|desde|para)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][^$\n.,:;!?]{1,40})/g;
    while((q = re.exec(t))){
      const c = q[1].trim();
      if(!BL.test(c)){ quien = c; break; }
      re.lastIndex = q.index + q[0].indexOf(q[1]) + 1; // seguir buscando dentro del texto descartado
    }
  }
  // (e) bancos como origen/destino: "desde Bancolombia", "a Davivienda"
  if(!quien && (q = t.match(/\b(?:desde|de|a)\s+(Bancolombia|Davivienda|Daviplata|Bogot[aá]|Nu|Lulo(?: Bank)?|Dale!?|Movii|Banco [A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]+)(?=[\s.,;!?]|$)/))) quien = q[1];

  // recortar lo que sigue al nombre: "por/con/hoy/desde…", "el día 5", "el 05/10/2026", "a las 10:30"
  quien = quien.replace(/\s+(?:(?:por|con|hoy|exitosamente|desde)(?=\s|$)|el\s+d[ií]a(?=\s|$)|el\s+\d|a\s+las?\s+\d).*$/i, '').trim();
  return {monto, dir, quien};
}

/* ── Saldos: se CALCULAN desde los movimientos (nunca se descuadran) ── */
function balances(db){
  const b = {};
  L(db, 'bolsillos').forEach(p => b[p.id] = +p.ini || 0);
  const add = (id, v) => { if(id == null || id === '') return; if(!(id in b)) b[id] = 0; b[id] += +v || 0; };
  L(db, 'items').forEach(i => {
    add(i.buyPocket, -i.buyPrice);
    if(i.status === 'sold') add(i.sellPocket, i.sellPaid != null ? i.sellPaid : i.sellPrice);
  });
  L(db, 'gastos').forEach(g => add(g.bolsillo, -g.valor));
  L(db, 'ingresos').forEach(g => add(g.bolsillo, g.valor));
  L(db, 'abonos').forEach(a => add(a.bolsillo, a.monto));
  L(db, 'cobros').forEach(c => { if(c.bolsillo) add(c.bolsillo, -((+c.total || 0) - (+c.pagado || 0))); });
  L(db, 'transfers').forEach(t => { add(t.from, -t.monto); add(t.to, t.monto); });
  L(db, 'ajustes').forEach(a => add(a.bolsillo, a.delta));
  return b;
}

/* ── Apartados (fondos): PARA QUÉ es la plata ──
   fondoDe(col, rec, db) → id del apartado al que pertenece la plata de un registro.
   Orden: rec.fondo (si ese apartado existe y no está borrado; si no existe → 'personal')
   → items: 'negocio' → gastos: tipo 'negocio' ? 'negocio' : 'personal' → ingresos: 'personal'
   → cobros: con itemId 'negocio', si no 'personal' → abonos: el del cobro → ajustes: 'personal'.
   Si el apartado por defecto está borrado → 'personal'. transfers y repartos no tienen apartado → null. */
function fondoResolver(db){
  const vivos = new Set(L(db, 'fondos').map(f => f.id));
  const cobros = new Map();
  ((db && db.cobros) || []).forEach(c => { if(c && c.id != null && (!cobros.has(c.id) || !c.del)) cobros.set(c.id, c); });
  const valido = id => (id === 'personal' || vivos.has(id)) ? id : 'personal';
  const resolver = (col, rec) => {
    rec = rec || {};
    if(col === 'transfers' || col === 'repartos') return null;
    if(rec.fondo != null && rec.fondo !== '') return valido(rec.fondo);
    switch(col){
      case 'items': return valido('negocio');
      case 'gastos': return valido(rec.tipo === 'negocio' ? 'negocio' : 'personal');
      case 'cobros': return valido(rec.itemId ? 'negocio' : 'personal');
      case 'abonos': { const c = cobros.get(rec.cobroId); return c ? resolver('cobros', c) : 'personal'; }
      default: return 'personal'; // ingresos, ajustes y cualquier otro
    }
  };
  resolver.valido = valido;
  return resolver;
}
function fondoDe(col, rec, db){ return fondoResolver(db)(col, rec); }

/* Saldo por apartado: los MISMOS movimientos que balances() (mismas condiciones y montos), agrupados
   por apartado, más los repartos. Invariante: suma(balancesFondos) === suma(balances).
   El saldo inicial de cada bolsillo se reparte con iniFondos {fondoId: monto}; lo no repartido → 'personal'.
   Un apartado puede quedar negativo (p. ej. el negocio usó plata personal). */
function balancesFondos(db){
  const fdo = fondoResolver(db);
  const f = {};
  const has = k => Object.prototype.hasOwnProperty.call(f, k);
  const put = (k, v) => { if(!has(k)) f[k] = 0; f[k] += +v || 0; };
  L(db, 'fondos').forEach(x => { if(!has(x.id)) f[x.id] = 0; });
  if(!has('personal')) f.personal = 0;
  // como balances(): mismo bolsillo vivo repetido → cuenta el ini del último
  const ini = new Map();
  L(db, 'bolsillos').forEach(p => ini.set(String(p.id), p));
  ini.forEach(p => {
    let resto = +p.ini || 0;
    const parts = (p.iniFondos && typeof p.iniFondos === 'object' && !Array.isArray(p.iniFondos)) ? p.iniFondos : {};
    Object.keys(parts).forEach(k => {
      const v = +parts[k] || 0;
      if(!v) return;
      put(fdo.valido(k), v);
      resto -= v;
    });
    put('personal', resto);
  });
  // un movimiento solo cuenta si toca un bolsillo (igual que add() en balances)
  const add = (pocket, fondo, v) => { if(pocket == null || pocket === '') return; put(fondo, v); };
  L(db, 'items').forEach(i => {
    const k = fdo('items', i);
    add(i.buyPocket, k, -i.buyPrice);
    if(i.status === 'sold') add(i.sellPocket, k, i.sellPaid != null ? i.sellPaid : i.sellPrice);
  });
  L(db, 'gastos').forEach(g => add(g.bolsillo, fdo('gastos', g), -g.valor));
  L(db, 'ingresos').forEach(g => add(g.bolsillo, fdo('ingresos', g), g.valor));
  L(db, 'abonos').forEach(a => add(a.bolsillo, fdo('abonos', a), a.monto));
  L(db, 'cobros').forEach(c => { if(c.bolsillo) add(c.bolsillo, fdo('cobros', c), -((+c.total || 0) - (+c.pagado || 0))); });
  // transfers: cambian DÓNDE está la plata, no PARA QUÉ es → su neto en apartados es 0. Se recorren igual que
  // en balances() para que un transfer cojo (sin "desde" o sin "hacia") cuadre también: esa plata va a 'personal'.
  L(db, 'transfers').forEach(t => { add(t.from, 'personal', -t.monto); add(t.to, 'personal', t.monto); });
  L(db, 'ajustes').forEach(a => add(a.bolsillo, fdo('ajustes', a), a.delta));
  L(db, 'repartos').forEach(r => {
    const m = +r.monto || 0;
    if(!m) return;
    put(fdo.valido(r.from), -m);
    put(fdo.valido(r.to), m);
  });
  return f;
}

function cobroPagado(db, c){
  return (+c.pagado || 0) + sum(L(db, 'abonos').filter(a => a.cobroId === c.id), 'monto');
}
function cobrosPend(db){
  return L(db, 'cobros').map(c => {
    const pag = cobroPagado(db, c);
    return Object.assign({}, c, {pag, pend: Math.max(0, (+c.total || 0) - pag)});
  }).filter(c => c.pend > 0);
}

/* Utilidad del mes: se reconoce cuando VENDES (precio venta − costo − gastos de negocio) */
function monthStats(db, ym){
  const inM = d => !ym || String(d || '').slice(0, 7) === ym;
  const sold = L(db, 'items').filter(i => i.status === 'sold' && inM(i.sellDate));
  const ventas = sum(sold, 'sellPrice'), costo = sum(sold, 'buyPrice'), bruta = ventas - costo;
  const g = L(db, 'gastos').filter(x => inM(x.fecha));
  const gN = sum(g.filter(x => x.tipo === 'negocio'), 'valor');
  const gP = sum(g.filter(x => x.tipo !== 'negocio'), 'valor');
  const neta = bruta - gN;
  const compras = sum(L(db, 'items').filter(i => inM(i.buyDate)), 'buyPrice');
  const ing = sum(L(db, 'ingresos').filter(x => inM(x.fecha)), 'valor');
  const diasProm = sold.length ? Math.round(sold.reduce((a, i) => a + daysBetween(i.buyDate, i.sellDate), 0) / sold.length) : null;
  const cats = {};
  g.forEach(x => { const k = (x.tipo === 'negocio' ? '🏢 ' : '👤 ') + (x.cat || 'Otro'); cats[k] = (cats[k] || 0) + (+x.valor || 0); });
  return {sold, nVentas: sold.length, ventas, costo, bruta, gN, gP, neta, margen: ventas ? neta / ventas * 100 : 0, compras, ing, diasProm, cats};
}

/* ── Textos para notificaciones (MacroDroid) ── */
function summaryText(db){
  const t = today(), from = shiftDate(t, -6), inR = d => d && d >= from && d <= t;
  const sold = L(db, 'items').filter(i => i.status === 'sold' && inR(i.sellDate));
  const ventas = sum(sold, 'sellPrice'), bruta = ventas - sum(sold, 'buyPrice');
  const g = L(db, 'gastos').filter(x => inR(x.fecha));
  const gN = sum(g.filter(x => x.tipo === 'negocio'), 'valor'), gP = sum(g.filter(x => x.tipo !== 'negocio'), 'valor');
  const b = balances(db), caja = Object.keys(b).reduce((a, k) => a + b[k], 0);
  const st = L(db, 'items').filter(i => i.status === 'stock');
  const quietos = st.filter(i => daysBetween(i.buyDate, t) >= 30);
  const cp = cobrosPend(db), np = L(db, 'pend').length;
  const lines = [];
  lines.push(sold.length ? `📊 ${sold.length} venta${sold.length > 1 ? 's' : ''} por ${fmt(ventas)} · utilidad ${fmt(bruta - gN)}` : '📊 Sin ventas esta semana');
  lines.push(`💸 Gastos ${fmt(gN + gP)} (negocio ${fmt(gN)} · personal ${fmt(gP)})`);
  lines.push(`💵 Caja ${fmt(caja)} · 📦 Stock ${fmt(sum(st, 'buyPrice'))} (${st.length})`);
  const lf = fondosLinea(db);
  if(lf) lines.push(lf);
  if(cp.length) lines.push(`🤝 Te deben ${fmt(sum(cp, 'pend'))}: ` + cp.slice(0, 3).map(c => String(c.nombre).split(' ')[0] + ' ' + fmt(c.pend)).join(', '));
  if(quietos.length) lines.push(`⚠️ ${quietos.length} producto${quietos.length > 1 ? 's' : ''} con +30 días: ` + quietos.slice(0, 2).map(i => i.desc).join(', '));
  if(np) lines.push(`📲 ${np} movimiento${np > 1 ? 's' : ''} por clasificar`);
  return lines.join('\n');
}

function remindersText(db){
  const t = today(), lines = [];
  cobrosPend(db).filter(c => c.compromiso && c.compromiso <= t).forEach(c =>
    lines.push(`🤝 ${c.nombre} ${c.compromiso === t ? 'prometió pagarte hoy' : 'debía pagarte el ' + fd(c.compromiso)}: ${fmt(c.pend)}`));
  const np = L(db, 'pend').length;
  if(np) lines.push(`📲 Tienes ${np} movimiento${np > 1 ? 's' : ''} por clasificar`);
  // Empujón de hábito: si lleva 3+ días sin registrar nada, recordárselo
  const lastU = ['items','gastos','ingresos','abonos','transfers','cobros']
    .reduce((mx, c) => L(db, c).reduce((m, x) => Math.max(m, +x.u || 0), mx), 0);
  if(lastU > 1){
    const dias = Math.floor((Date.now() - lastU) / 864e5);
    if(dias >= 3) lines.push(`📝 Llevas ${dias} días sin registrar nada. ¿Compraste, vendiste o gastaste algo?`);
  }
  // Cuadre: si hace 15+ días no registra un ajuste (o, si nunca lo ha hecho, desde su primer movimiento)
  const fechasMov = [];
  L(db, 'items').forEach(i => { fechasMov.push(i.buyDate); if(i.status === 'sold') fechasMov.push(i.sellDate); });
  ['gastos','ingresos','abonos','transfers','cobros','repartos'].forEach(c => L(db, c).forEach(x => fechasMov.push(x.fecha)));
  const validas = fechasMov.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))).sort();
  if(validas.length){
    const ultAjuste = L(db, 'ajustes').map(a => String(a.fecha || '')).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop();
    const desde = ultAjuste || validas[0];
    if(desde <= t && daysBetween(desde, t) >= 15) lines.push('🧮 Hace rato no cuadras: compara tus saldos con Nequi y el efectivo real');
  }
  return lines.join('\n');
}

/* Apartados vivos en orden (orden, luego nombre). */
function fondosOrdenados(db){
  return L(db, 'fondos').slice().sort((a, b) => ((+a.orden || 0) - (+b.orden || 0)) || String(a.nombre || '').localeCompare(String(b.nombre || '')));
}
/* "💼 Negocio $1.2M · 👤 Personal $300K · 🏠 Arriendo $0" ('' si no hay apartados) */
function fondosLinea(db){
  const bf = balancesFondos(db), lista = fondosOrdenados(db);
  const ids = lista.map(f => f.id);
  Object.keys(bf).forEach(k => { if(ids.indexOf(k) < 0 && bf[k]) ids.push(k); });
  const nombre = id => { const f = lista.find(x => x.id === id); return f ? ((f.emoji ? f.emoji + ' ' : '') + (f.nombre || id)) : (id === 'personal' ? '👤 Personal' : id); };
  return ids.map(id => nombre(id) + ' ' + fmt(bf[id] || 0)).join(' · ');
}

if(typeof module !== 'undefined') module.exports = {COLS, emptyDB, mergeDB, L, sum, ymd, today, shiftDate, daysBetween, MESES, fmt, full, fd, monthLabel, extractMonto, parseMoney, parseNoti, balances, cobroPagado, cobrosPend, monthStats, summaryText, remindersText,
  SEED_BOLSILLOS, SEED_FONDOS, ensureSeeds, fondoDe, balancesFondos, fondosOrdenados, fondosLinea};
