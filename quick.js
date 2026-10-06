/* ═══════════════════════════════════════════════
   quick.js — registro rápido en una frase (texto o voz)
   Puro: sin DOM. Navegador: <script src="quick.js"> después de core.js (globales).
   Node: const Q = require('./app/quick.js')
═══════════════════════════════════════════════ */
const QK_CORE = (typeof module !== 'undefined' && module.exports && typeof require === 'function') ? require('./core.js') : null;
const qkExtract = s => (QK_CORE ? QK_CORE.extractMonto : extractMonto)(s);
const qkToday = () => (QK_CORE ? QK_CORE.today : today)();
const qkShift = (s, n) => (QK_CORE ? QK_CORE.shiftDate : shiftDate)(s, n);

const CATS = ['Celulares','Consolas','Computadores','Accesorios','Ropa','Calzado','Coleccionables','Moto/Auto','Otro'];
const GCATS = ['Envíos','Empaques','Comisiones','Publicidad','Transporte','Comida','Mantenimiento','Servicios','Entretenimiento','Personal','Otro'];
const NEG_CATS = ['Envíos','Empaques','Comisiones','Publicidad'];

/* minúsculas, sin tildes, solo letras/números separados por un espacio */
function normKey(s){
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/* Palabras clave por categoría. Se elige la que aparece PRIMERO en el texto
   ("ps5 con 2 controles" → Consolas; "control ps5" → Accesorios).
   Prefijo de palabra por defecto; terminada en "." = palabra completa. */
const QK_PCAT = [
  ['Accesorios', 'audifono|airpod|buds|cargador|cable|funda|forro|estuche|protector|vidrio|templado|control|mando|joystick|mouse|teclado|smartwatch|reloj|watch|parlante|bafle|power bank|powerbank|bateria externa|memoria|usb|micro sd|sd.|diadema|adaptador|soporte|tripode|aro de luz|gafas|lentes'],
  ['Celulares', 'iphone|celular|cel.|telefono|smartphone|samsung|galaxy|xiaomi|redmi|poco.|motorola|moto g|moto e|moto edge|huawei|pixel|oppo|realme|honor|tecno|infinix|vivo.|nokia|zte'],
  ['Consolas', 'ps5|ps4|ps3|ps2|playstation|play.|xbox|nintendo|switch|consola|wii|steam deck|psp|vita.|game boy|gameboy|sega|atari|videojuego'],
  ['Computadores', 'computador|portatil|laptop|pc.|macbook|imac|mac.|ipad|tablet|notebook|lenovo|asus|acer|dell|hp.|chromebook|monitor|torre|cpu|tarjeta de video|grafica|rtx|gtx|ryzen|intel|ram.|ssd|disco duro|impresora'],
  ['Calzado', 'tenis|zapato|zapatilla|bota.|botas.|botin|sandalia|chancla|crocs|jordan|yeezy|air force|air max|dunk|vans|converse|guayo|tacon|mocasin'],
  ['Ropa', 'camisa|camiseta|buzo|chaqueta|pantalon|jean|blusa|vestido|gorra|sudadera|hoodie|short|pantaloneta|chompa|saco|falda|media.|medias|ropa|jersey|polo.|sueter|conjunto|pijama|bermuda|chaleco|bolso|morral|mochila|cartera|correa'],
  ['Coleccionables', 'funko|figura|carta|pokemon|lego|coleccion|hot wheels|hotwheels|comic|album|lamina|vinilo|moneda|peluche|anime|manga|yugioh|magic'],
  ['Moto/Auto', 'moto|carro|casco|llanta|rin.|rines|repuesto|auto.|bicicleta|bici.|patineta|scooter|exosto|farola']
];
const QK_GCAT = [
  ['Envíos', 'envio|domicilio|servientrega|interrapidisimo|inter rapidisimo|coordinadora|envia.|tcc.|deprisa|472|mensajer|flete|guia|encomienda|transportadora'],
  ['Empaques', 'empaque|caja|bolsa|cinta|burbuja|sticker|etiqueta|papel|sobre.|sobres'],
  ['Comisiones', 'comision|mercadolibre|mercado libre|datafono|wompi|bold.|payu|tarifa|4x1000|cuatro por mil|gmf|cuota de manejo|retencion'],
  ['Publicidad', 'publicidad|pauta|anuncio|ads.|facebook|instagram|tiktok|promocion|impulsar|boost|volante|marketing'],
  ['Transporte', 'transporte|taxi|uber|didi|indriver|indrive|cabify|picap|bus.|buseta|metro|civica|pasaje|gasolina|tanque|parqueadero|parqueo|peaje|mototaxi|colectivo|tiquete'],
  ['Comida', 'almuerzo|desayuno|cena.|comida|restaurante|mercado|hamburguesa|pizza|perro|salchipapa|cafe|tinto|onces|mecato|empanada|arepa|pollo|fruta|snack|gaseosa|bebida|jugo|helado|panaderia|pan.|rappi|ifood|mcdonald|kfc|frisby|d1.|ara.|exito|olimpica|tienda|supermercado|leche|huevo|carne'],
  ['Mantenimiento', 'mantenimiento|reparacion|arreglo|taller|repuesto|aceite|lavada|lavado|llanta|revision|tecnico|tecnomecanica|pintura'],
  ['Servicios', 'servicio|luz.|agua.|gas.|internet|plan.|recarga|datos|arriendo|alquiler|epm.|claro.|movistar|tigo.|wom.|une.|administracion|soat|seguro|factura'],
  ['Entretenimiento', 'cine.|netflix|spotify|disney|hbo.|prime.|youtube|rumba|fiesta|cerveza|pola.|polas.|trago|guaro|aguardiente|ron.|concierto|boleta|partido|futbol|salida|paseo|viaje|bar.|discoteca|videojuego|apuesta|billar|bolos'],
  ['Personal', 'ropa|corte|peluqueria|barberia|barbero|gimnasio|gym.|farmacia|drogueria|medicina|medicamento|regalo|aseo|shampoo|crema|perfume|mama.|papa.|novia|familia|cumpleanos|zapato|tenis']
];

function qkGuess(table, desc){
  const t = ' ' + normKey(desc) + ' ';
  let best = 'Otro', bi = Infinity, bl = 0;
  table.forEach(([cat, list]) => list.split('|').forEach(kw => {
    const whole = kw.endsWith('.');
    if(whole) kw = kw.slice(0, -1);
    const i = t.indexOf(' ' + kw + (whole ? ' ' : ''));
    if(i >= 0 && (i < bi || (i === bi && kw.length > bl))){ best = cat; bi = i; bl = kw.length; }
  }));
  return best;
}
const guessCat = desc => qkGuess(QK_PCAT, desc);
const guessGCat = desc => qkGuess(QK_GCAT, desc);

const QK_FILL = new Set('de del el la los las un una unos unas en por con a al para mi mis me le les lo y e que su sus tu tus se peso pesos pesito pesitos hice'.split(' '));
const qkFill = w => QK_FILL.has(w);

/* Busca q en la lista por palabras. Devuelve el elemento o null.
   Acepta si alguna palabra coincide exacta o si cubre la mitad de la búsqueda. */
function bestMatch(q, lista, getTexto){
  const qt = normKey(q).split(' ').filter(t => t && !QK_FILL.has(t));
  if(!qt.length || !lista || !lista.length) return null;
  let best = null, bs = 0;
  lista.forEach(it => {
    const tt = normKey(getTexto ? getTexto(it) : it).split(' ').filter(Boolean);
    if(!tt.length) return;
    const joined = tt.join('');
    let hit = 0, exact = 0;
    qt.forEach(w => {
      if(tt.includes(w)){ hit += 1; exact++; }
      else if(w.length >= 3 && tt.some(x => x.startsWith(w) || (x.length >= 3 && w.startsWith(x)))) hit += 0.8;
      else if(w.length >= 3 && joined.includes(w)) hit += 0.6;
    });
    if(!hit || (!exact && hit / qt.length < 0.5)) return;
    const score = hit / qt.length + 0.5 * Math.min(1, hit / tt.length);
    if(score > bs){ bs = score; best = it; }
  });
  return best;
}

/* Disparadores por tipo, en orden de prioridad (§6.3).
   Sufijo "~" = sustantivo o verbo genérico (2ª pasada); "*" = 2ª pasada y se queda en la descripción.
   Con tilde = debe venir con tilde ("pagó" es abono, "pago" es gasto). */
const QK_RULES = [
  ['transfer', 0, 'retire|saque|pase|movi|transferi|traslade|retiro~'],
  ['abono', 0, 'abonó|abonaron|abono~|abonar~'],
  ['abono', 1, 'me pago|me dio|me consigno|pagó|consignó'],
  ['cobro', 0, 'me quedo debiendo|quedo debiendo|me debe|me deben|le preste|preste|fie|fiado|fiada|fiados|fiadas|debe~|prestamo~'],
  ['venta', 0, 'vendi|vendido|vendida|vendimos|venta~'],
  ['compra', 0, 'compre|compramos|compra~'],
  ['ingreso', 0, 'me pagaron|me consignaron|me transfirieron|gane|recibi~|me entro~|entro~|me enviaron~|me mandaron~|ingreso~|sueldo*|salario*|quincena*|prima*'],
  ['gasto', 0, 'gaste|pague|pagamos|gasto~|pago~|pagar~']
];
const QK_CREDIT = /^(fie|fiado|fiada|fiados|fiadas|me debe|me deben|debe|me quedo debiendo|quedo debiendo)$/;

const qkTokens = s => String(s || '').split(/\s+/)
  .map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+]+$/gu, '')).filter(Boolean);

/* tokens de orig (con mayúsculas) que siguen presentes en rest (sin el monto) → [{w, i}] */
function qkAlign(orig, rest){
  const out = []; let j = 0;
  orig.forEach((w, i) => {
    if(j >= rest.length) return;
    const lw = w.toLowerCase();
    if(lw === rest[j]){ out.push({w, i}); j++; }
    else if(lw.includes(rest[j])){ out.push({w: rest[j], i}); j++; }
  });
  return out;
}

function qkFind(nw, low, used, ph){
  const acc = ph !== normKey(ph);
  const seq = ph.split(' '), arr = acc ? low : nw;
  outer: for(let i = 0; i + seq.length <= arr.length; i++){
    for(let k = 0; k < seq.length; k++) if(used[i + k] || arr[i + k] !== seq[k]) continue outer;
    return i;
  }
  return -1;
}

const qkCap = s => {
  s = String(s || '').trim();
  if(!s) return '';
  return /[A-ZÁÉÍÓÚÑ]/.test(s.split(' ')[0].slice(1)) ? s : s[0].toUpperCase() + s.slice(1);
};
const qkName = s => String(s || '').trim().split(/\s+/).filter(Boolean)
  .map((w, i) => i && qkFill(normKey(w)) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)).join(' ');
const qkIsEfe = p => p.id === 'efectivo' || normKey(p.nombre) === 'efectivo';
const qkEfeId = bols => (bols.find(qkIsEfe) || bols[0] || {id: 'efectivo'}).id;
const qkNequiId = bols => (bols.find(p => p.id === 'nequi') || bols.find(p => normKey(p.nombre).includes('nequi'))
  || bols.find(p => !qkIsEfe(p)) || {id: 'nequi'}).id;

/* parseQuick("compré ps5 1.2M nequi", ctx) → {kind:'compra', d:{desc:'Ps5', buyPrice:1200000, buyPocket:'nequi', cat:'Consolas'}}
   ctx = {bolsillos:[{id,nombre}], stock:[{id,desc}], cobros:[{id,nombre}]} */
function parseQuick(texto, ctx){
  ctx = ctx || {};
  const bols = ctx.bolsillos || [], stock = ctx.stock || [], cobros = ctx.cobros || [];
  const src = String(texto || '').replace(/\s+/g, ' ').trim();
  const em = qkExtract(src), monto = em.monto || 0;
  const toks = qkAlign(qkTokens(src), qkTokens(em.rest)).map(x => x.w);
  const low = toks.map(w => w.toLowerCase());
  const nw = toks.map(w => normKey(w).replace(/ /g, ''));
  const used = toks.map(() => false);
  const mark = (i, n) => { for(let k = 0; k < n; k++) used[i + k] = true; };
  const find = ph => qkFind(nw, low, used, ph);
  const d = {};

  // 1) tipo: primero verbos claros, luego sustantivos y verbos genéricos
  let kind = 'gasto', weak = false, trig = '', at = -1;
  search: for(const pass of [1, 2]){
    for(const [k, w, list] of QK_RULES){
      for(const raw of list.split('|')){
        if((pass === 1) === /[~*]$/.test(raw)) continue;
        const ph = raw.replace(/[~*]$/, ''), i = find(ph);
        if(i < 0) continue;
        kind = k; weak = !!w; trig = ph; at = i;
        if(!raw.endsWith('*')) mark(i, ph.split(' ').length);
        break search;
      }
    }
  }
  // "vendí ps5 fiado a juan" → venta a crédito
  let credito = false;
  if(kind === 'cobro' && QK_CREDIT.test(trig)){
    for(const ph of ['vendi', 'vendido', 'vendida', 'vendimos', 'venta']){
      const i = find(ph);
      if(i >= 0){ mark(i, 1); kind = 'venta'; credito = true; break; }
    }
  }
  // las demás palabras clave tampoco van en la descripción
  QK_RULES.forEach(r => r[2].split('|').forEach(raw => {
    if(raw.endsWith('*')) return;
    if(raw.endsWith('~') && r[0] !== kind && !(kind === 'venta' && r[0] === 'cobro')) return; // "pagué el préstamo" → "Préstamo" queda en la descripción
    const ph = raw.replace(/~$/, ''); let i;
    while((i = find(ph)) >= 0) mark(i, ph.split(' ').length);
  }));
  // 2) bolsillos mencionados
  const ments = [];
  bols.forEach(p => {
    const phs = [normKey(p.nombre)].concat(qkIsEfe(p) ? ['efectivo', 'cash', 'fisico', 'billete', 'billetes'] : []);
    phs.forEach(ph => {
      if(!ph) return;
      let i;
      while((i = find(ph)) >= 0){ const n = ph.split(' ').length; ments.push({id: p.id, i, n}); mark(i, n); }
    });
  });
  ments.sort((a, b) => a.i - b.i);
  const pocket = ments.length ? ments[0].id : undefined;
  // 3) negocio/personal y fecha
  let tipo, fecha;
  nw.forEach((w, i) => {
    if(used[i]) return;
    if(w === 'negocio' || w === 'personal'){ tipo = w; used[i] = true; }
    else if(w === 'hoy'){ fecha = qkToday(); used[i] = true; }
    else if(w === 'ayer'){ fecha = qkShift(qkToday(), -1); used[i] = true; }
    else if(w === 'anteayer' || w === 'antier'){ fecha = qkShift(qkToday(), -2); used[i] = true; }
  });
  // 4) lo que queda = descripción / nombre
  const free = () => toks.map((_, i) => i).filter(i => !used[i]);
  const isWord = i => !QK_FILL.has(nw[i]) && !/^\d/.test(toks[i]);
  const text = idx => idx.map(i => toks[i]).join(' ');
  const descIdx = () => free().filter(i => !QK_FILL.has(nw[i]));
  const isLetter = i => /^\p{L}/u.test(toks[i]);
  // nombre: el relleno se quita SOLO en los bordes ("Luis del Río", "Juan de Dios"); máx. 3 palabras de verdad
  const trimName = idx => {
    let a = 0, b = idx.length;
    while(a < b && !isWord(idx[a])) a++;
    while(b > a && !isWord(idx[b - 1])) b--;
    const out = []; let n = 0;
    for(const i of idx.slice(a, b)){ if(isWord(i)){ if(++n > 3) break; } out.push(i); }
    while(out.length && !isWord(out[out.length - 1])) out.pop();
    return out;
  };
  const runFrom = (j, stop) => { // tokens libres y contiguos con letras desde j
    const run = [];
    for(; j < stop && !used[j] && isLetter(j) && run.length < 6; j++) run.push(j);
    return trimName(run);
  };
  const nameAfterA = () => {
    for(let i = 0; i < toks.length - 1; i++){
      if(used[i] || (nw[i] !== 'a' && nw[i] !== 'al')) continue;
      const run = runFrom(i + 1, toks.length);
      if(run.length) return run;
    }
    return [];
  };
  const nameBefore = () => { // el último tramo libre antes de la palabra clave ("doña rosa me debe")
    const run = [];
    for(let j = at - 1; j >= 0 && !used[j] && isLetter(j) && run.length < 6; j--) run.unshift(j);
    return trimName(run);
  };
  const nameIdx = (aFirst) => {
    let idx = aFirst ? nameAfterA() : [];
    if(!idx.length && at > 0) idx = nameBefore();
    if(!idx.length) idx = trimName(free().filter(i => i < at && isLetter(i)));
    if(!idx.length) idx = nameAfterA();
    if(!idx.length){
      const f = free().filter(i => i > at), s = f.findIndex(isWord);
      if(s >= 0){ const run = [f[s]]; for(let k = s + 1; k < f.length && f[k] === f[k - 1] + 1 && isLetter(f[k]); k++) run.push(f[k]); idx = trimName(run); }
    }
    return idx;
  };
  const desc = qkCap(text(descIdx()));

  if(kind === 'compra'){
    if(desc){ d.desc = desc; d.cat = guessCat(desc); }
    if(monto) d.buyPrice = monto;
    if(pocket) d.buyPocket = pocket;
    if(fecha) d.buyDate = fecha;
  } else if(kind === 'venta'){
    let cli = credito ? nameAfterA() : [];
    if(credito){ // un segundo monto = lo que quedó debiendo
      const em2 = qkExtract(em.rest);
      if(em2.monto){
        const kept = new Set(qkAlign(toks, qkTokens(em2.rest)).map(x => x.i));
        toks.forEach((_, i) => { if(!kept.has(i)) used[i] = true; });
        if(monto && em2.monto < monto) d.sellPaid = monto - em2.monto;
      }
    }
    const qIdx = descIdx().filter(i => !cli.includes(i));
    const q = text(qIdx);
    const item = q ? bestMatch(q, stock, it => it.desc) : null;
    if(item){
      d.itemId = item.id;
      const itT = normKey(item.desc).split(' ');
      if(credito && !cli.length) cli = qIdx.filter(i => !itT.includes(nw[i]) && isWord(i));
    } else if(q){ d.itemId = '__nuevo'; d.desc = qkCap(q); d.cat = guessCat(q); }
    else d.itemId = '';
    if(monto) d.sellPrice = monto;
    if(pocket) d.sellPocket = pocket;
    if(fecha) d.sellDate = fecha;
    if(credito){
      d.completo = 'no';
      if(d.sellPaid == null) d.sellPaid = 0;
      if(cli.length) d.cliente = qkName(text(cli));
    }
  } else if(kind === 'cobro'){
    const ni = nameIdx(/^(le preste|preste|prestamo|fie|fiado|fiada|fiados|fiadas)$/.test(trig));
    const notas = free().filter(i => !ni.includes(i) && isWord(i));
    if(ni.length) d.nombre = qkName(text(ni));
    if(monto) d.total = monto;
    d.bolsillo = /^(le preste|preste|prestamo)$/.test(trig) ? (pocket || qkEfeId(bols)) : '';
    if(notas.length) d.notas = qkCap(text(notas));
    if(fecha) d.fecha = fecha;
  } else if(kind === 'abono'){
    const ni = nameIdx(), nombre = qkName(text(ni));
    const c = nombre ? bestMatch(nombre, cobros, x => x.nombre) : null;
    if(c || !weak){
      d.cobroId = c ? c.id : '';
      if(!c && nombre) d._nombre = nombre;
      if(monto) d.monto = monto;
      if(pocket) d.bolsillo = pocket;
      if(fecha) d.fecha = fecha;
    } else { // "mi mamá me dio 50k" sin cobro de esa persona → ingreso
      kind = 'ingreso';
      if(desc) d.desc = desc;
      if(monto) d.valor = monto;
      if(pocket) d.bolsillo = pocket;
      if(fecha) d.fecha = fecha;
    }
  } else if(kind === 'transfer'){
    let from, to;
    ments.forEach(m => {
      const prev = m.i > 0 ? nw[m.i - 1] : '';
      if(/^(de|del|desde)$/.test(prev) && from === undefined) from = m.id;
      else if(/^(a|al|para|hacia)$/.test(prev) && to === undefined) to = m.id;
    });
    ments.forEach(m => {
      if(m.id === from || m.id === to) return;
      if(from === undefined) from = m.id; else if(to === undefined) to = m.id;
    });
    const neq = qkNequiId(bols), efe = qkEfeId(bols);
    if(from === undefined) from = to === neq ? efe : neq;
    if(to === undefined) to = from === efe ? neq : efe;
    if(from === to){ const o = bols.find(p => p.id !== from); to = o ? o.id : to; }
    d.from = from; d.to = to;
    if(monto) d.monto = monto;
    if(fecha) d.fecha = fecha;
  } else if(kind === 'ingreso'){
    if(desc) d.desc = desc;
    if(monto) d.valor = monto;
    if(pocket) d.bolsillo = pocket;
    if(fecha) d.fecha = fecha;
  } else { // gasto (por defecto)
    if(desc){ d.desc = desc; d.cat = guessGCat(desc); }
    if(monto) d.valor = monto;
    d.tipo = tipo || (d.cat && NEG_CATS.includes(d.cat) ? 'negocio' : 'personal');
    if(pocket) d.bolsillo = pocket;
    if(fecha) d.fecha = fecha;
  }
  return {kind, d};
}

if(typeof module !== 'undefined') module.exports = {parseQuick, CATS, GCATS, NEG_CATS, guessCat, guessGCat, normKey, bestMatch};
