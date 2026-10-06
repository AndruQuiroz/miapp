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
  ['Celulares', 'iphone|celular|cel.|telefono|smartphone|samsung|galaxy|pro max|promax|plus.|xiaomi|redmi|poco.|motorola|moto g|moto e|moto edge|huawei|pixel|oppo|realme|honor|tecno|infinix|vivo.|nokia|zte'],
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
/* §11.3: modelos de celular sin marca ("17 pro max", "15 pro", "s23", "a54", "note 13") */
const QK_CEL_RE = /(^| )(\d{1,2} ?pro( ?max)?|\d{1,2} plus|\d{1,2} mini|s\d{2}( ultra| plus| fe)?|a\d{2}|note \d{1,2})( |$)/;
const guessCat = desc => { const c = qkGuess(QK_PCAT, desc), n = normKey(desc); return c === 'Otro' && (QK_CEL_RE.test(n) || /^1[1-7]$/.test(n)) ? 'Celulares' : c; };
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

/* ═══════════════════════════════════════════════
   §11 — Varias operaciones en una frase y parte de pago
   parseQuickMulti("compre un 17 pro max en 3 y lo vendi en 2M y un 16 pro max valorado como compra en 2,1", ctx)
   → [{kind:'compra', d:{desc:'17 Pro Max', cat:'Celulares', buyPrice:3000000}},
      {kind:'venta',  d:{itemId:'__prev', desc:'17 Pro Max', cat:'Celulares', sellPrice:2000000,
                         tradeIn:{desc:'16 Pro Max', valor:2100000, cat:'Celulares'}}}]
═══════════════════════════════════════════════ */
const QK_CAROS = ['Celulares', 'Consolas', 'Computadores', 'Moto/Auto'];
/* verbos que abren una operación nueva (sin tildes, como normKey) */
const QK_SPLIT_1 = new Set('compre compramos compro vendi vendimos gaste gastamos pague pagamos retire saque pase movi transferi preste fie recibi gane cambie'.split(' '));
const QK_SPLIT_2 = new Set(['le preste', 'me pagaron', 'me consignaron', 'lo vendi', 'la vendi', 'los vendi', 'las vendi', 'lo cambie', 'la cambie', 'lo entregue', 'la entregue']);
const QK_CONN = new Set(['y', 'luego', 'despues', 'entonces', 'e']);
const QK_PRON = /^(?:lo|la|los|las)\s+(?=vend|cambi|entregu)/i;
const QK_AMT = '(\\$?\\s?\\d+(?:[.,]\\d+)*(?:\\s*(?:millones|mill[oó]n|palos?|mil|lucas?|k|m)(?=[\\s,;.!?]|$))?)';
const QK_DESC = '((?:(?!\\s(?:y|en|por|de|a)\\s)[^,;])+?)';

/* números sueltos < 100 en productos caros = millones ("en 3", "2,1", "por 2.5") */
function qkShortM(seg){
  return seg
    .replace(/(^|\s)(en|por|a|de|valorad[oa]s?|avaluad[oa]s?|compra|plata)\s+\$?(\d{1,2}(?:[.,]\d{1,2})?)(?=[\s,;!?]|$)(?!\s*(?:mill|mel[oó]n|pesos?|lucas?|palos?|d[ií]as?|mes(?:es)?|a[nñ]os?|horas?|%|(?:mil|k|m)(?=[\s,;.!?]|$)))/gi,
      (m, a, p, n) => `${a}${p} ${n}M`)
    .replace(/\s(\d{1,2}[.,]\d{1,2})\s*$/, ' $1M');
}
function qkAmount(raw, caro){
  raw = String(raw || '').trim();
  if(caro && /^\$?\s?\d{1,2}(?:[.,]\d{1,2})?$/.test(raw)) return Math.round(parseFloat(raw.replace(/[$\s]/g, '').replace(',', '.')) * 1e6);
  const r = qkExtract(raw).monto;
  if(r) return r;
  return /^\d+$/.test(raw) ? +raw : 0;
}
/* nombre de producto legible: "17 pro max" → "17 Pro Max", "ps5" → "PS5" */
const qkPretty = s => String(s || '').trim().split(/\s+/).filter(Boolean).map((w, i) => {
  const n = normKey(w);
  if(i && QK_FILL.has(n)) return w.toLowerCase();
  if(/^(ps|s|a|rtx|gtx)\d+$/i.test(w)) return w.toUpperCase();
  if(/^iphone$/i.test(w)) return 'iPhone';
  return w[0].toUpperCase() + w.slice(1);
}).join(' ');

/* Parte de pago dentro de una venta → {rest, tradeIn:{desc, rawValor}} */
/* Formas de "recibir" un producto como parte de pago */
const QK_RECV = '(?:(?:me\\s+|nos\\s+)?(?:dio|dieron|dej[oó]|dejaron|entreg[oó]|entregaron|pas[oó]|pasaron)|recib[ií]|recibimos|me\\s+l[oa]s?\\s+pagaron\\s+con|me\\s+l[oa]s?\\s+pag[oó]\\s+con)';
const QK_ART = '(?:un|una|el|la|unos|unas)';
const QK_VAL = '(?:valorad[oa]s?(?:\\s+en)?|avaluad[oa]s?(?:\\s+en)?|tasad[oa]s?(?:\\s+en)?|de|en|por|a)';

/* Parte de pago dentro de una venta → {rest, tradeIn:{desc, rawValor}} */
function qkTradeIn(seg){
  const D = '(?<desc>(?:(?!\\s(?:y|en|por|de|a)\\s)[^,;])+?)', A = `(?<amt>${QK_AMT.slice(1, -1)})`;
  const pats = [
    // "y un 16 pro max valorado (como compra) en 2,1" · "me dio un X como parte de pago en N"
    {re: `(?:^|\\s)(?:(?:(?:y|m[aá]s|con|\\+)\\s+|${QK_RECV}\\s+)+(?<art>${QK_ART}\\s+)?|(?<art2>${QK_ART}\\s+))${D}\\s+(?:valorad[oa]s?|avaluad[oa]s?|tasad[oa]s?|recibid[oa]s?|tomad[oa]s?|(?:como|en|de)\\s+parte\\s+de\\s+pago)(?:\\s+como\\s+(?:compra|parte\\s+de\\s+pago))?(?:\\s+(?:en|por|a|de))?\\s+${A}`},
    // "me lo cambiaron por un X de N" · "lo cambié por un X de N"
    {re: `(?:^|\\s)(?:y\\s+)?(?:me\\s+l[oa]s?\\s+cambiaron|l[oa]s?\\s+cambi[eé])\\s+por\\s+(?<art>${QK_ART}\\s+)?${D}\\s+${QK_VAL}\\s+${A}`, swap: 1},
    // "y me dieron/dejaron/entregaron un X de N" · "recibí un X en N" · "me lo pagaron con un X de N"
    {re: `(?:^|\\s)(?:y\\s+)?(?:adem[aá]s\\s+)?${QK_RECV}\\s+(?:adem[aá]s\\s+)?(?<art>${QK_ART}\\s+)?${D}\\s+${QK_VAL}\\s+${A}`},
    // "… 2M y un 15 pro de 1.8" · "más un X en N" · "+ un X de N" (solo si antes ya hay plata)
    {re: `(?:^|\\s)(?:y|m[aá]s|con|\\+)\\s+(?:me\\s+dio\\s+)?(?<art>${QK_ART}\\s+)${D}\\s+${QK_VAL}\\s+${A}`, money: 1}
  ];
  for(const p of pats){
    const m = seg.match(new RegExp(p.re, 'i'));
    if(!m) continue;
    const g = m.groups, before = seg.slice(0, m.index);
    if(p.money && !/\d/.test(before)) continue;
    const desc = g.desc.trim();
    const art = g.art || g.art2;
    if(!desc || /^\$?\d+([.,]\d+)*\s*(m|k|mil|millones?)?$/i.test(desc) && !art) continue;   // "me dio 1M" es plata, no un producto
    if(!art && /^\d/.test(desc)) continue;
    const rest = (before + ' ' + seg.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    return {rest: p.swap ? rest + ' vendi' : rest, tradeIn: {desc, rawValor: g.amt}};
  }
  return {rest: seg, tradeIn: null};
}

const cur0Verb = v => /^vend/.test(v) ? 'vendí' : 'compré';
const qkHasVenta = s => /(^| )(vendi|vendimos|vendido|vendida|venta|cambie|cambiaron)( |$)/.test(normKey(s));

/* Parte la frase en segmentos:
   · donde lo que sigue empieza con una acción ("y lo vendí", ", luego gasté")
   · o donde AMBOS lados tienen su propio monto y el izquierdo ya es una operación ("almuerzo 18 mil y envío 12k nequi")
   Nunca: "funda y vidrio 30k", "2 millones y 500 mil", "vendí ps5 2M y me dieron un xbox de 1.5" */
function qkSegments(src){
  const toks = src.split(' ');
  const segs = []; let cur = [];
  const isConn = j => QK_CONN.has(normKey(toks[j]));
  const skipConn = j => { while(j < toks.length && isConn(j)) j++; return j; };
  const startsAction = j => {
    j = skipConn(j);
    if(j >= toks.length) return false;
    const a = normKey(toks[j]), b = j + 1 < toks.length ? a + ' ' + normKey(toks[j + 1]) : '';
    if(a === 'recibi' && qkHasVenta(cur.join(' '))) return false;          // "vendí… y recibí un X de N" = parte de pago
    return QK_SPLIT_1.has(a) || QK_SPLIT_2.has(b);
  };
  const otro = j => { j = skipConn(j); return j < toks.length && /^otr[oa]s?$/.test(normKey(toks[j])) ? j : -1; };
  // ¿se parte por montos? devuelve el verbo a anteponer ('' si no hace falta) o null si no se parte
  const amountSplit = (leftToks, j) => {
    j = skipConn(j);
    if(j >= toks.length || /^[$\d+]/.test(toks[j])) return null;
    let e = j;
    while(e < toks.length && !(e > j && isConn(e)) && !/[,;]$/.test(toks[e])) e++;
    const right = toks.slice(j, Math.min(e + 1, toks.length)).join(' ').replace(/[,;]+$/, '');
    const left = leftToks.join(' ');
    if(qkHasVenta(left) || !qkExtract(left).monto || !qkExtract(right).monto) return null;
    if(!/\p{L}/u.test(qkExtract(right).rest.replace(/[^\p{L}\s]/gu, ''))) return null;
    const lk = parseQuick(left, {}).kind, rk = parseQuick(right, {}).kind;
    if(lk !== 'gasto' && lk !== 'compra') return null;
    if(lk === 'compra' && rk === 'gasto' && !/^(compre|compramos|gaste|pague)$/.test(normKey(toks[j])) && guessGCat(right) === 'Otro') return 'compré';
    return '';
  };
  for(let i = 0; i < toks.length; i++){
    const t = toks[i], n = normKey(t), comma = /[,;]$/.test(t);
    // "compré X en 1.5 y otro Y en 1.1" → repite el verbo de la operación anterior
    const verb = cur.length ? normKey(cur[0]) : '';
    if((QK_CONN.has(n) || comma) && /^(compre|compramos|vendi|vendimos)$/.test(verb)){
      const j = otro(QK_CONN.has(n) ? i : i + 1);
      if(j >= 0){ if(!QK_CONN.has(n)) cur.push(t.replace(/[,;]+$/, '')); segs.push(cur.join(' ')); cur = [cur0Verb(verb)]; i = j; continue; }
    }
    if(cur.length && QK_CONN.has(n)){
      if(startsAction(i)){ segs.push(cur.join(' ')); cur = []; i = skipConn(i) - 1; continue; }
      const v = amountSplit(cur, i);
      if(v !== null){ segs.push(cur.join(' ')); cur = v ? [v] : []; i = skipConn(i) - 1; continue; }
    }
    if(comma){
      const left = cur.concat([t.replace(/[,;]+$/, '')]);
      if(startsAction(i + 1)){ segs.push(left.join(' ')); cur = []; i = skipConn(i + 1) - 1; continue; }
      const v = amountSplit(left, i + 1);
      if(v !== null){ segs.push(left.join(' ')); cur = v ? [v] : []; i = skipConn(i + 1) - 1; continue; }
    }
    cur.push(t);
  }
  if(cur.length) segs.push(cur.join(' '));
  return segs.map(s => s.trim()).filter(Boolean);
}

/* ¿el segmento trae su propio verbo de acción? (compré, vendí, gasté, pagué, lo vendí…) */
const qkHasVerb = seg => { const w = normKey(seg).split(' '); return w.some((x, i) => QK_SPLIT_1.has(x) || QK_SPLIT_2.has(x + ' ' + (w[i + 1] || '')) || /^vendid[oa]$/.test(x)); };
/* "11".."17" solo (sin marca) = iPhone, como habla el usuario ("me entregaron un 11") */
const qkModel = desc => /^1[1-7]$/.test(String(desc || '').trim()) ? 'iPhone ' + String(desc).trim() : desc;
const QK_POCKET_FIELD = {compra: 'buyPocket', venta: 'sellPocket', gasto: 'bolsillo', ingreso: 'bolsillo', abono: 'bolsillo'};
/* bolsillo dicho al FINAL de la frase ("… y envío 12k nequi") */
function qkTailPocket(src, bols){
  const t = ' ' + normKey(src);
  for(const p of bols){
    const names = [normKey(p.nombre)].concat(qkIsEfe(p) ? ['efectivo', 'cash', 'fisico', 'billete', 'billetes'] : []);
    if(names.some(nm => nm && t.endsWith(' ' + nm))) return p.id;
  }
  return undefined;
}
/* "2 controles a 150k c/u" → total = cantidad × precio por unidad */
const QK_CU = /(^|\s)(?:c\/\s?u|c\.\s?u\.?|cada\s+un[oa]|c\/u\.?)(?=[\s,;.!?]|$)/i;
function qkQty(seg){
  const m = seg.match(/(?:^|\s)(\d{1,2})\s+(?!mil|k\b|m\b|mill|lucas?|palos?|pesos)(?=\p{L})/u);
  return m && +m[1] >= 2 ? +m[1] : 0;
}

function parseQuickMulti(texto, ctx){
  ctx = ctx || {};
  const src = String(texto || '').replace(/\s+/g, ' ').trim();
  const segs = qkSegments(src);
  const out = [];
  let prev = null;                         // última compra de la frase
  segs.forEach(seg0 => {
    let seg = seg0, pron = false, ti = null, qty = 0;
    if(QK_PRON.test(seg)){ pron = true; seg = seg.replace(QK_PRON, ''); }
    if(QK_CU.test(seg)){ seg = seg.replace(QK_CU, '$1').replace(/\s+/g, ' ').trim(); qty = qkQty(seg); }
    if(qkHasVenta(seg) || pron){
      const t = qkTradeIn(seg);
      if(t.tradeIn){ ti = t.tradeIn; seg = t.rest; }
      // "me dio 1M" dentro de una venta es la forma de pago, no un abono
      seg = seg.replace(/(^|\s)(?:y\s+)?me\s+(?:dio|dieron|dej[oó]|dejaron|pag[oó]|pagaron|consign[oó])(?=\s)/gi, '$1').replace(/\s+/g, ' ').trim();
    }
    let r = parseQuick(seg, ctx);
    const seg2 = qkShortM(seg);
    const r2 = seg2 !== seg ? parseQuick(seg2, ctx) : r;
    const pv = r.kind === 'compra' || r.kind === 'venta';
    const cat = [pv && r.d.cat, pv && r2.d.cat, pv && r2.d.desc && guessCat(r2.d.desc), guessCat(seg), ti && guessCat(ti.desc),
      prev && (pron || r.kind === 'venta') && prev.d.cat].find(c => c && c !== 'Otro') || 'Otro';
    const caro = QK_CAROS.includes(cat);
    if(caro && pv && r2 !== r) r = r2;
    const d = r.d;
    if(r.kind === 'venta'){
      const sameAsPrev = prev && (pron || !d.itemId || (d.itemId === '__nuevo' && d.desc && bestMatch(d.desc, [prev.d], x => x.desc)));
      if(sameAsPrev){ d.itemId = '__prev'; d.desc = prev.d.desc; d.cat = prev.d.cat; }
      else if(d.itemId === '__nuevo' && caro && (!d.cat || d.cat === 'Otro')) d.cat = cat;
      if(ti){
        const tcat = guessCat(ti.desc) !== 'Otro' ? guessCat(ti.desc) : cat;
        d.tradeIn = {desc: qkModel(qkPretty(ti.desc)), valor: qkAmount(ti.rawValor, QK_CAROS.includes(tcat) || caro), cat: tcat};
      }
    } else if(r.kind === 'compra' && d.desc && (!d.cat || d.cat === 'Otro') && cat !== 'Otro') d.cat = cat;
    if(qty){
      const f = {compra: 'buyPrice', venta: 'sellPrice', gasto: 'valor', ingreso: 'valor'}[r.kind];
      if(f && d[f]){ const u = d[f]; d[f] = u * qty; d.notes = qty + ' × $' + String(u).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' c/u'; }
    }
    out.push(r);
    if(r.kind === 'compra') prev = r;
  });
  if(!out.length) return [parseQuick(src, ctx)];
  if(out.length > 1){
    // el bolsillo dicho al final vale para los segmentos que no dijeron el suyo
    const tail = qkTailPocket(src, ctx.bolsillos || []), last = out[out.length - 1], lf = QK_POCKET_FIELD[last.kind];
    // …solo entre segmentos SIN verbo propio y del mismo tipo ("gasolina 20 mil, parqueadero 5 mil y almuerzo 18 mil efectivo")
    if(tail && lf && last.d[lf] === tail) out.forEach((r, i) => {
      const f = QK_POCKET_FIELD[r.kind];
      if(f && r.d[f] === undefined && r.kind === last.kind && !qkHasVerb(segs[i])) r.d[f] = tail;
    });
  }
  // en frases compuestas o con parte de pago, nombres legibles
  if(out.length > 1 || out.some(r => r.d.tradeIn)) out.forEach(r => { if(r.d.desc && (r.kind === 'compra' || r.kind === 'venta')) r.d.desc = qkModel(qkPretty(r.d.desc)); });
  out.forEach((r, i) => { if(r.kind === 'venta' && r.d.itemId === '__prev'){ const c = out.slice(0, i).reverse().find(x => x.kind === 'compra'); if(c) r.d.desc = c.d.desc; } });
  return out;
}

if(typeof module !== 'undefined') module.exports = {parseQuick, parseQuickMulti, CATS, GCATS, NEG_CATS, guessCat, guessGCat, normKey, bestMatch};
