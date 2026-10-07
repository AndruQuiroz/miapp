/* ═══════════════════════════════════════════════
   core.js — lógica compartida entre la app y Google Apps Script
   (sin DOM: funciona en el navegador y en el servidor)
═══════════════════════════════════════════════ */
const COLS = ['items','gastos','ingresos','cobros','abonos','transfers','ajustes','pend','bolsillos','reglas','fondos','repartos','contactos','topes'];

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
  const ins = monthInsight(db);
  if(ins) lines.push(ins);
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
  // Topes de gasto del mes (SPEC §14)
  topesEstado(db, t.slice(0, 7)).forEach(x => {
    if(x.estado === 'pasado') lines.push(`🚨 Te pasaste del ${nombreTope(x.tope)} por ${fmt(x.gastado - (+x.tope.limite || 0))}`);
    else if(x.estado === 'cerca') lines.push(`⚠️ Ya gastaste el ${x.pct}% de tu ${nombreTope(x.tope)}`);
  });
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

/* ═══════════════ Ronda 5 (SPEC §14): historial, referencia de precios, comentario del mes, topes y contactos ═══════════════ */

/* Texto comparable: minúsculas, sin tildes, solo letras/números separados por un espacio. */
function normNombre(s){
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/* Clave de MODELO para comparar productos entre sí ("iphone 15 pro 256gb azul" → "iphone 15 pro").
   Quita capacidad, RAM, colores, estado, tallas y relleno; une alias de marcas (iPhone, Samsung, PlayStation,
   Xbox, Switch, MacBook, tenis). Si no reconoce nada, devuelve el texto limpio. */
function normModelo(desc){
  let s = ' ' + normNombre(desc)
    .replace(/(\d)\s*(gb|tb|g|t)\b/g, '$1$2') + ' ';
  const R = (re, to) => { s = s.replace(re, to); };
  // capacidad / RAM / batería / talla
  R(/\s\d+\s?(?:gb|g|tb|t)(?=\s)/g, ' ');
  R(/\s\d+\s\d+(?=\s)/g, m => /^\s(?:4|6|8|12|16)\s(?:64|128|256|512|1024)$/.test(m) ? ' ' : m); // "8/256" (normNombre lo deja "8 256")
  R(/\s(?:de\s)?(?:32|64|128|256|512|1024)(?=\s)/g, ' ');
  R(/\s(?:con\s)?(?:la\s)?bateria(?:\sal)?(?:\s(?:de|en))?\s\d{1,3}(?:\s?%|\sporciento|\spor\sciento)?(?=\s)/g, ' ');
  R(/\s\d{1,3}\s(?:de\s)?bateria(?=\s)/g, ' ');
  R(/\stalla\s\d+(?:\s\d)?(?=\s)/g, ' ');
  R(/\st\d{2}(?=\s)/g, ' ');
  // marcas / alias multi-palabra
  R(/\s(?:i\s?phone|iph|ip)(?=\s)/g, ' iphone ');
  R(/\spro\s?max\s/g, ' pro max '); R(/\spromax\s/g, ' pro max '); R(/\spm(?=\s)/g, ' pro max ');
  R(/\s(?:play\s?station|play|psx?)\s?(\d)(?=\s)/g, ' ps$1 ');
  R(/\sps\s(\d)(?=\s)/g, ' ps$1 ');
  R(/\sseries?\s([sx])(?=\s)/g, ' series $1 ');
  R(/\smac\sbook(?=\s)/g, ' macbook ');
  R(/\sz\s?(flip|fold)\s?(\d)(?=\s)/g, ' z $1 $2 ');
  R(/\sair\sjordan(?=\s)/g, ' jordan ');
  R(/\saf\s?1(?=\s)/g, ' air force 1 ');
  // palabras que no cambian el modelo: estado, colores, relleno, marcas implícitas
  const FUERA = new Set(('de del el la los las un una en con sin y color caja cargador original originales usado usada nuevo nueva nuevecito ' +
    'sellado sellada generico generica replica bueno buena regular perfecto perfecta impecable estado condicion como detalle detalles ' +
    'liberado desbloqueado libre esim fisico dual sim version edicion estandar digital fat slim disco lector retro low high mid ' +
    'negro negra blanco blanca azul rojo roja verde morado morada lila rosado rosada rosa dorado dorada plateado plateada gris amarillo ' +
    'naranja coral grafito medianoche estelar titanio natural desierto ultramar black white blue red green purple pink gold silver gray grey ' +
    'graphite midnight starlight space espacial sierra alpine tenis zapatillas zapatos apple galaxy nintendo consola celular telefono ' +
    'portatil nike').split(' '));
  const fuera = w => FUERA.has(w) || (/s$/.test(w) && FUERA.has(w.slice(0, -1))) || (/es$/.test(w) && FUERA.has(w.slice(0, -2))); // plurales: blancos, azules
  let t = s.trim().split(/\s+/).filter(w => w && !fuera(w));
  // reglas por marca
  if(t.length && /^(?:\d{1,2}|x|xr|xs|se)$/.test(t[0]) && (t.length === 1 || /^(?:pro|max|plus|mini|e)$/.test(t[1]))){
    const n = +t[0];
    if(isNaN(n) || (n >= 6 && n <= 17)) t = ['iphone'].concat(t);       // "15 pro" → iphone 15 pro
  }
  if(t[0] !== 'samsung' && /^(?:s|a|m|note)\d{1,2}$/.test(t[0] || '') ) t = ['samsung'].concat(t);
  if(t[0] === 'z' && /^(?:flip|fold)$/.test(t[1] || '')) t = ['samsung'].concat(t);
  if(t[0] === 'series' && /^[sx]$/.test(t[1] || '')) t = ['xbox'].concat(t);
  if(t[0] === 'xbox' && t[1] === 'serie') t[1] = 'series';
  if(t[0] === 'oled' || t[0] === 'lite') t = ['switch'].concat(t);
  return t.join(' ');
}

/* Costo real de un producto = lo que pagaste (buyPrice) + sus gastos ligados (gastos vivos con itemId).
   Si el producto vino como PARTE DE PAGO (fromTradeOf), su buyPrice es el valor en que lo recibiste (estimado):
   ese es su costo, porque así se contó en la venta del otro producto. */
function costoItem(db, item, extras){
  extras = extras || L(db, 'gastos').filter(g => g.itemId != null && g.itemId === item.id);
  return (+item.buyPrice || 0) + sum(extras, 'valor');
}

function nombreContacto(db, id, texto){
  if(id){ const c = ((db && db.contactos) || []).find(x => x && x.id === id); if(c && c.nombre) return c.nombre; }
  return texto || '';
}

/* Historia completa de un producto (para la ficha). null si no existe. */
function itemHistory(db, itemId){
  const todos = (db && db.items) || [];
  const item = todos.find(i => i && i.id === itemId && !i.del) || todos.find(i => i && i.id === itemId);
  if(!item) return null;
  const costosExtra = L(db, 'gastos').filter(g => g.itemId != null && g.itemId === item.id)
    .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));
  const costoTotal = costoItem(db, item, costosExtra);
  const vendido = item.status === 'sold';
  const venta = vendido ? {
    precio: +item.sellPrice || 0,
    pagado: item.sellPaid != null ? (+item.sellPaid || 0) : (+item.sellPrice || 0),
    fecha: item.sellDate || '', bolsillo: item.sellPocket || '',
    cliente: nombreContacto(db, item.clienteId, item.cliente)
  } : null;
  const ganancia = vendido ? venta.precio - costoTotal : null;
  const margen = vendido && venta.precio ? ganancia / venta.precio * 100 : null;
  const dias = daysBetween(item.buyDate, vendido ? item.sellDate : today());
  const buscar = id => (id ? todos.find(i => i && i.id === id && !i.del) || null : null);
  const origen = buscar(item.fromTradeOf);
  const recibido = buscar(item.tradeInId) || L(db, 'items').find(i => i.fromTradeOf === item.id) || null;
  const c = L(db, 'cobros').find(x => x.itemId === item.id);
  const cobro = c ? (() => { const pag = cobroPagado(db, c); return Object.assign({}, c, {pag, pend: Math.max(0, (+c.total || 0) - pag)}); })() : null;
  return {item, costosExtra, costoTotal, venta, ganancia, margen, dias, origen, recibido, cobro,
    proveedor: nombreContacto(db, item.proveedorId, item.proveedor)};
}

const redondear10k = n => Math.round(n / 1e4) * 1e4;

/* Referencia de precios de un modelo: query = texto ("iphone 13 128") o un item. null si no hay datos. */
function priceRef(db, query){
  const modelo = normModelo(query && typeof query === 'object' ? query.desc : query);
  if(!modelo) return null;
  const items = L(db, 'items').filter(i => normModelo(i.desc) === modelo);
  if(!items.length) return null;
  const extrasDe = new Map();
  L(db, 'gastos').forEach(g => { if(g.itemId != null) extrasDe.set(g.itemId, (extrasDe.get(g.itemId) || 0) + (+g.valor || 0)); });
  const costo = i => (+i.buyPrice || 0) + (extrasDe.get(i.id) || 0);
  const resumen = (arr, precio, fecha) => {
    if(!arr.length) return {n: 0, prom: null, min: null, max: null, ultima: null};
    const v = arr.map(precio), u = arr.slice().sort((a, b) => String(fecha(b)).localeCompare(String(fecha(a))))[0];
    return {n: arr.length, prom: Math.round(sum(v) / v.length), min: Math.min.apply(null, v), max: Math.max.apply(null, v),
      ultima: {precio: precio(u), fecha: fecha(u) || ''}};
  };
  const comprados = items.filter(i => (+i.buyPrice || 0) > 0);
  const vendidos = items.filter(i => i.status === 'sold' && (+i.sellPrice || 0) > 0);
  const compras = resumen(comprados, i => +i.buyPrice || 0, i => i.buyDate);
  const ventas = resumen(vendidos, i => +i.sellPrice || 0, i => i.sellDate);
  const gananciaProm = vendidos.length ? Math.round(sum(vendidos.map(i => (+i.sellPrice || 0) - costo(i))) / vendidos.length) : null;
  const diasProm = vendidos.length ? Math.round(sum(vendidos.map(i => daysBetween(i.buyDate, i.sellDate))) / vendidos.length) : null;
  let sugeridoVenta = null;
  if(vendidos.length){
    const rec = vendidos.slice().sort((a, b) => String(b.sellDate || '').localeCompare(String(a.sellDate || ''))).slice(0, 3);
    sugeridoVenta = redondear10k(sum(rec, 'sellPrice') / rec.length);
  } else if(compras.n){
    // margen de ganancia sobre el costo de TODO lo que has vendido (si no hay o es ≤ 0: 15 %)
    const todo = L(db, 'items').filter(i => i.status === 'sold');
    const c = sum(todo.map(costo)), v = sum(todo, 'sellPrice');
    const m = c > 0 && v > c ? (v - c) / c : 0.15;
    sugeridoVenta = redondear10k(compras.prom * (1 + m));
  }
  const orden = items.slice().sort((a, b) => String(b.sellDate || b.buyDate || '').localeCompare(String(a.sellDate || a.buyDate || '')));
  return {modelo, compras, ventas, gananciaProm, diasProm, sugeridoVenta, items: orden};
}

/* Estado de los topes de gasto del mes. cat '__personal' = todo lo personal (tipo ≠ negocio). */
function topesEstado(db, ym){
  ym = ym || today().slice(0, 7);
  const g = L(db, 'gastos').filter(x => String(x.fecha || '').slice(0, 7) === ym);
  return L(db, 'topes').map(tope => {
    const gastado = sum(g.filter(x => tope.cat === '__personal' ? x.tipo !== 'negocio' : x.cat === tope.cat), 'valor');
    const lim = +tope.limite || 0;
    const pct = lim > 0 ? Math.round(gastado / lim * 100) : 0;
    const estado = lim > 0 && gastado > lim ? 'pasado' : (lim > 0 && pct >= 80 ? 'cerca' : 'ok');
    return {tope, gastado, pct, estado};
  });
}
const nombreTope = t => (t.cat === '__personal' ? 'tope personal' : 'tope de ' + t.cat);

/* Base "como iba" al cierre de `hasta` (YYYY-MM-DD): sin ventas ni gastos posteriores. */
function statsHasta(db, ym, hasta){
  const d = Object.assign({}, db, {
    items: L(db, 'items').filter(i => !(i.status === 'sold' && String(i.sellDate || '') > hasta)),
    gastos: L(db, 'gastos').filter(x => String(x.fecha || '') <= hasta)
  });
  return monthStats(d, ym);
}

/* Comentario del mes (≤ 90 caracteres, tono amable). '' si no hay datos suficientes. */
function monthInsight(db, ym){
  const hoy = today(), ymHoy = hoy.slice(0, 7);
  ym = ym || ymHoy;
  if(L(db, 'items').filter(i => i.status === 'sold').length < 2) return '';
  const [y, m] = ym.split('-').map(Number);
  const prevYm = m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0');
  const enCurso = ym === ymHoy;
  let cur, prev;
  if(enCurso){
    const dia = +hoy.slice(8, 10);
    const [py, pm] = prevYm.split('-').map(Number);
    const finPrev = new Date(py, pm, 0).getDate();
    cur = statsHasta(db, ym, hoy);
    prev = statsHasta(db, prevYm, prevYm + '-' + String(Math.min(dia, finPrev)).padStart(2, '0'));
  } else {
    cur = monthStats(db, ym); prev = monthStats(db, prevYm);
  }
  const hayCur = cur.nVentas > 0 || cur.gN + cur.gP > 0;
  if(!hayCur) return '';
  const C = []; // {s: frase, p: peso}
  // 1) utilidad
  if(prev.nVentas > 0 || cur.nVentas > 0){
    const d = cur.neta - prev.neta;
    const rel = Math.min(1.5 * Math.abs(d) / Math.max(Math.abs(prev.neta), 1), 2); // la utilidad pesa más que lo demás
    if(prev.nVentas > 0 && Math.abs(d) < Math.max(1000, Math.abs(prev.neta) * 0.05)){ /* casi igual: nada que contar */ }
    else if(prev.nVentas === 0) C.push({s: `💰 ${enCurso ? 'Llevas' : 'Hiciste'} ${fmt(cur.neta)} de utilidad este mes`, p: 0.4});
    else if(enCurso) C.push({s: d >= 0
      ? `📈 Llevas ${fmt(cur.neta)} de utilidad, ${fmt(d)} más que a esta altura del mes pasado`
      : (cur.nVentas === 0
        ? `🌱 Mes arrancando: a esta altura del mes pasado llevabas ${fmt(prev.neta)} de utilidad`
        : `📉 Llevas ${fmt(cur.neta)}; a esta altura del mes pasado llevabas ${fmt(prev.neta)}`), p: rel});
    else C.push({s: d >= 0
      ? `📈 Utilidad de ${fmt(cur.neta)}, ${fmt(d)} más que el mes anterior`
      : `📉 Utilidad de ${fmt(cur.neta)}, ${fmt(-d)} menos que el mes anterior`, p: rel});
  }
  // 2) margen
  if(cur.ventas > 0 && prev.ventas > 0){
    const a = Math.round(cur.margen), b = Math.round(prev.margen);
    if(Math.abs(a - b) >= 5) C.push({s: a > b ? `💹 Tu margen subió a ${a}% (antes ${b}%)` : `🔎 Tu margen bajó a ${a}% (antes ${b}%)`, p: Math.abs(a - b) / 20});
  }
  // 3) producto más rentable
  if(cur.sold.length){
    const best = cur.sold.map(i => ({i, g: (+i.sellPrice || 0) - costoItem(db, i)})).sort((a, b) => b.g - a.g)[0];
    if(best.g > 0){
      const n = String(best.i.desc || 'un producto');
      C.push({s: `🏆 Lo más rentable: ${n.length > 28 ? n.slice(0, 27) + '…' : n} (+${fmt(best.g)})`, p: 0.5});
    }
  }
  // 4) gasto personal que más subió (misma altura del mes si va en curso)
  const per = st => { const o = {}; Object.keys(st.cats).forEach(k => { if(k.indexOf('👤 ') === 0) o[k.slice(3)] = st.cats[k]; }); return o; };
  const pc = per(cur), pp = per(prev);
  let peor = null;
  Object.keys(pc).forEach(k => {
    const d = pc[k] - (pp[k] || 0);
    if(k !== 'Otro' && d >= 20000 && (!pp[k] || d / pp[k] >= 0.5) && (!peor || d > peor.d)) peor = {k, d, v: pc[k]};
  });
  if(peor) C.push({s: `👀 ${peor.k} va en ${fmt(peor.v)}, ${fmt(peor.d)} más que el mes pasado`, p: Math.min(peor.d / Math.max(pp[peor.k] || 0, peor.d), 1) * 0.6});
  // 5) días promedio para vender
  if(cur.diasProm != null && prev.diasProm != null && Math.abs(cur.diasProm - prev.diasProm) >= 3){
    C.push({s: cur.diasProm < prev.diasProm
      ? `⚡ Vendes más rápido: ${cur.diasProm} días en promedio (antes ${prev.diasProm})`
      : `⏳ Estás tardando un poco más en vender: ${cur.diasProm} días (antes ${prev.diasProm})`,
      p: Math.abs(cur.diasProm - prev.diasProm) / Math.max(prev.diasProm, 1)});
  }
  if(!C.length) return '';
  C.sort((a, b) => b.p - a.p);
  const uno = C[0].s.length <= 90 ? C[0].s : C[0].s.slice(0, 89) + '…';
  if(C[1] && C[1].p >= 0.5 && (uno + ' · ' + C[1].s).length <= 90) return uno + ' · ' + C[1].s;
  return uno;
}

/* Resumen de un contacto: por proveedorId/clienteId o, si el registro no tiene id, por nombre normalizado. */
function contactoStats(db, contactoId){
  const c = L(db, 'contactos').find(x => x.id === contactoId);
  if(!c) return null;
  const n = normNombre(c.nombre);
  const es = (id, texto) => (id ? id === c.id : (!!n && normNombre(texto) === n));
  const compras = L(db, 'items').filter(i => es(i.proveedorId, i.proveedor));
  const ventas = L(db, 'items').filter(i => i.status === 'sold' && es(i.clienteId, i.cliente));
  const cobros = cobrosPend(db).filter(x => es(x.contactoId, x.nombre));
  const ev = [];
  compras.forEach(i => ev.push({fecha: i.buyDate || '', tipo: 'compra', desc: i.desc, itemId: i.id}));
  ventas.forEach(i => ev.push({fecha: i.sellDate || '', tipo: 'venta', desc: i.desc, itemId: i.id}));
  L(db, 'cobros').filter(x => es(x.contactoId, x.nombre)).forEach(x => ev.push({fecha: x.fecha || '', tipo: 'cobro', desc: x.notas || '', cobroId: x.id}));
  ev.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  return {
    contacto: c,
    compras: {n: compras.length, total: sum(compras, 'buyPrice')},
    ventas: {n: ventas.length, total: sum(ventas, 'sellPrice'), ganancia: sum(ventas.map(i => (+i.sellPrice || 0) - costoItem(db, i)))},
    debe: sum(cobros, 'pend'),
    ultimo: ev[0] || null
  };
}

if(typeof module !== 'undefined') module.exports = {COLS, emptyDB, mergeDB, L, sum, ymd, today, shiftDate, daysBetween, MESES, fmt, full, fd, monthLabel, extractMonto, parseMoney, parseNoti, balances, cobroPagado, cobrosPend, monthStats, summaryText, remindersText,
  SEED_BOLSILLOS, SEED_FONDOS, ensureSeeds, fondoDe, balancesFondos, fondosOrdenados, fondosLinea,
  normModelo, normNombre, costoItem, itemHistory, priceRef, topesEstado, monthInsight, contactoStats};
