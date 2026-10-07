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
  ['Calzado', 'new balance|nb.|adidas|nike|puma|reebok|tenis|zapato|zapatilla|bota.|botas.|botin|sandalia|chancla|crocs|jordan|yeezy|air force|air max|dunk|vans|converse|guayo|tacon|mocasin'],
  ['Ropa', 'camisa|camiseta|buzo|chaqueta|pantalon|jean|blusa|vestido|gorra|sudadera|hoodie|short|pantaloneta|chompa|saco|falda|media.|medias|ropa|jersey|polo.|sueter|conjunto|pijama|bermuda|chaleco|bolso|morral|mochila|cartera|correa'],
  ['Coleccionables', 'funko|figura|carta|pokemon|lego|coleccion|hot wheels|hotwheels|comic|album|lamina|vinilo|moneda|peluche|anime|manga|yugioh|magic'],
  ['Moto/Auto', 'moto|carro|casco|llanta|rin.|rines|repuesto|auto.|bicicleta|bici.|patineta|scooter|exosto|farola']
];
const QK_GCAT = [
  ['Envíos', 'domi.|motorizado|domiciliario|envio|domicilio|servientrega|interrapidisimo|inter rapidisimo|coordinadora|envia.|tcc.|deprisa|472|mensajer|flete|guia|encomienda|transportadora'],
  ['Empaques', 'empac|empaque|caja|bolsa|cinta|burbuja|sticker|etiqueta|papel|sobre.|sobres'],
  ['Comisiones', 'fees|fee.|mercado pago|mercadopago|comision|mercadolibre|mercado libre|datafono|wompi|bold.|payu|tarifa|4x1000|cuatro por mil|gmf|cuota de manejo|retencion'],
  ['Publicidad', 'publicidad|pauta|impuls|destacad|publicacion|marketplace|olx|anuncio|ads.|facebook|instagram|tiktok|promocion|impulsar|boost|volante|marketing'],
  ['Transporte', 'civica|transporte|taxi|uber|didi|indriver|indrive|cabify|picap|bus.|buseta|metro|civica|pasaje|gasolina|tanque|parqueadero|parqueo|peaje|mototaxi|colectivo|tiquete'],
  ['Comida', 'tamal|helad|pastel|torta|almuerzo|comer|bandeja|corrientazo|chuzo|sancocho|frijoles|chicharron|tintico|tinto|pandebono|bunuelo|empanadas|desayuno|cena.|comida|restaurante|mercado|hamburguesa|pizza|perro|salchipapa|cafe|tinto|onces|mecato|empanada|arepa|pollo|fruta|snack|gaseosa|bebida|jugo|helado|panaderia|pan.|rappi|ifood|mcdonald|kfc|frisby|d1.|ara.|exito|olimpica|tienda|supermercado|leche|huevo|carne'],
  ['Mantenimiento', 'motorepuesto|desbloqueo|icloud|liberacion|pantalla|bateria|mantenimiento|reparacion|arreglo|taller|repuesto|aceite|lavada|lavado|llanta|revision|tecnico|tecnomecanica|pintura'],
  ['Servicios', 'energia|servicio|renta|saldo|luz.|agua.|gas.|internet|plan.|recarga|datos|arriendo|alquiler|epm.|claro.|movistar|tigo.|wom.|une.|administracion|soat|seguro|factura'],
  ['Entretenimiento', 'juego|juegos|cine.|netflix|spotify|disney|hbo.|prime.|youtube|rumba|fiesta|cerveza|pola.|polas.|trago|guaro|aguardiente|ron.|concierto|boleta|partido|futbol|salida|paseo|viaje|bar.|discoteca|videojuego|apuesta|billar|bolos'],
  ['Personal', 'gafas|lentes de|acetaminofen|vitamina|pastilla|ibuprofeno|remedio|droga|ropa|corte|peluqueria|barberia|barbero|gimnasio|gym.|farmacia|drogueria|medicina|medicamento|regalo|aseo|shampoo|crema|perfume|mama.|papa.|novia|familia|cumpleanos|zapato|tenis']
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
const guessGCat = desc => /(^| )civica( |$)/.test(normKey(desc)) ? 'Transporte' : qkGuess(QK_GCAT, desc);

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
  ['abono', 1, 'me pago|me dio|me consigno|me paso|pagó|consignó|pasó'],
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
const QK_SPLIT_1 = new Set('compre compramos compro vendi vendimos gaste gastamos pague pagamos retire saque pase movi transferi preste fie recibi gane cambie aparte separe guarde reserve meti consigne cargue recargue devolvi ahorre abono'.split(' '));
const QK_SPLIT_2 = new Set(['le preste', 'le meti', 'me pague', 'le pague', 'le gaste', 'se lo', 'se la', 'lo consigne', 'la consigne', 'lo pase', 'lo meti', 'los consigne', 'me pagaron', 'me consignaron', 'lo vendi', 'la vendi', 'los vendi', 'las vendi', 'lo cambie', 'la cambie', 'lo entregue', 'la entregue']);
const QK_CONN = new Set(['y', 'luego', 'despues', 'entonces', 'e']);
const QK_PRON = /^(?:se\s+)?(?:lo|la|los|las)\s+(?=vend|cambi|entregu)/i;
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
const QK_RECV = '(?:recibiendo|(?:me\\s+|nos\\s+)?(?:dio|dieron|dej[oó]|dejaron|entreg[oó]|entregaron|pas[oó]|pasaron)|recib[ií]|recibimos|me\\s+l[oa]s?\\s+pagaron\\s+con|me\\s+l[oa]s?\\s+pag[oó]\\s+con)';
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
  pats.push({re: `(?:^|\\s)por\\s+(?<art>${QK_ART}\\s+)${D}\\s+(?:de|en|valorad[oa]s?\\s+en|avaluad[oa]s?\\s+en)\\s+${A}`});
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
let QK_SEG_CTX = {};
function qkSegments(src, ctx){
  QK_SEG_CTX = ctx || {};
  const toks = src.split(' ');
  const segs = []; let cur = [];
  const isConn = j => QK_CONN.has(normKey(toks[j]));
  const skipConn = j => { while(j < toks.length && isConn(j)) j++; return j; };
  const startsAction = j => {
    j = skipConn(j);
    while(j < toks.length && /^(el|mismo|ese|dia|de|una|tambien|ademas|ahi|luego|despues|con|eso|esa|esta|plata|de paso|hoy|ayer|antier|anoche|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|pasado|y)$/.test(normKey(toks[j])) && j < toks.length - 1 && !/^\d/.test(toks[j])){
      const look = toks.slice(j, j + 4).map(normKey);
      if(!look.some((x, k) => QK_SPLIT_1.has(x) || QK_SPLIT_2.has(x + ' ' + (look[k + 1] || '')))) break;
      j++;
    }
    if(j >= toks.length) return false;
    const a = normKey(toks[j]), b = j + 1 < toks.length ? a + ' ' + normKey(toks[j + 1]) : '';
    if(a === 'recibi' && qkHasVenta(cur.join(' '))) return false;          // "vendí… y recibí un X de N" = parte de pago
    // "vendí el 16 en 4.2, me pagaron 2 en nequi" / "…, abonó 2 por nequi": es el pago de ESA venta
    if(qkHasVenta(cur.join(' ')) && /^(me pagaron|me pago|me pagó|me dio|me dieron|me consignaron|me consigno|me consignó|me paso|me pasó|abono|abonó|me abono|me dejo|me dejó|me transfirio|me quedo|me quedó|quedo|queda|me debe)$/.test(b || a) ) return false;
    if(qkHasVenta(cur.join(' ')) && /^(abono|pago|consigno|quedo)$/.test(a)) return false;
    return QK_SPLIT_1.has(a) || QK_SPLIT_2.has(b);
  };
  const otro = j => { j = skipConn(j); return j < toks.length && /^otr[oa]s?$/.test(normKey(toks[j])) ? j : -1; };
  // ¿se parte por montos? devuelve el verbo a anteponer ('' si no hace falta) o null si no se parte
  const amountSplit = (leftToks, j) => {
    j = skipConn(j);
    if(j >= toks.length) return null;
    if(/^[$\d+]/.test(toks[j])){
      if(qkHasVenta(leftToks.join(' ')) || !qkExtract(leftToks.join(' ')).monto) return null;
      let e2 = j; while(e2 < toks.length && !(e2 > j && isConn(e2)) && !/[,;]$/.test(toks[e2])) e2++;
      const r2 = toks.slice(j, Math.min(e2 + 1, toks.length)).join(' ').replace(/[,;]+$/, '');
      if(!qkExtract(r2).monto || !/\p{L}{3,}/u.test(qkExtract(r2).rest)) return null;
      if(qkHasVerb(r2)) return '';
      const lw = leftToks.map(normKey);
      for(let k = 0; k < Math.min(lw.length, 4); k++){
        if(QK_SPLIT_2.has(lw[k] + ' ' + (lw[k + 1] || ''))) return leftToks[k] + ' ' + leftToks[k + 1];
        if(QK_SPLIT_1.has(lw[k])) return leftToks[k];
      }
      return '';
    }
    let e = j;
    while(e < toks.length && !(e > j && isConn(e)) && !/[,;]$/.test(toks[e])) e++;
    const right = toks.slice(j, Math.min(e + 1, toks.length)).join(' ').replace(/[,;]+$/, '');
    const left = leftToks.join(' ');
    // "vendí los jordan en 450 y los air force en 320": otra venta (artículo definido + producto del stock)
    if(qkHasVenta(left) && QK_SEG_CTX.stock && /^(el|la|los|las)$/.test(normKey(toks[j])) && qkExtract(right).monto && !/(me |mas |valorad|avaluad|recib)/.test(normKey(right))){
      const m = qkMatchStock(right, QK_SEG_CTX.stock);
      if(m.item || m.amb) return 'vendí';
    }
    if(/^(abono|cobro)$/.test(parseQuick(left, QK_SEG_CTX).kind) && /^(abono|cobro)$/.test(parseQuick(right, QK_SEG_CTX).kind) && qkExtract(left).monto && qkExtract(right).monto && /(^| )(me debe|me abono|abono|le preste|preste|me pago|me consigno)( |$)/.test(normKey(right))) return '';
    // "vendí el 13 en 1.6 y el mono me abonó 50": otra persona abona → operación aparte
    if(qkHasVenta(left) && qkExtract(right).monto && /(^| )(me abono|abono|me pago|me consigno|me paso|me debe)( |$)/.test(normKey(right)) && /^(el|la|don|dona|doña|\p{L})/u.test(normKey(toks[j])) && !/^(me|y|abono)$/.test(normKey(toks[j]))) return '';
    if(qkHasVenta(left) || !qkExtract(left).monto || !qkExtract(right).monto) return null;
    if(!/\p{L}/u.test(qkExtract(right).rest.replace(/[^\p{L}\s]/gu, ''))) return null;
    const lk = parseQuick(left, QK_SEG_CTX).kind, rk = parseQuick(right, QK_SEG_CTX).kind;
    if((lk === 'abono' || lk === 'cobro') && rk === 'gasto' && !qkHasVerb(right)) return lk === 'abono' ? 'abonó' : 'me debe';
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
      if(j >= 0){ if(!QK_CONN.has(n)) cur.push(t.replace(/[,;]+$/, '')); segs.push(cur.join(' ')); cur = [cur0Verb(verb), 'otro']; i = j; continue; }
    }
    if(cur.length && QK_CONN.has(n)){
      if(startsAction(i)){ segs.push(cur.join(' ')); cur = []; i = skipConn(i) - 1; continue; }
      const v = amountSplit(cur, i);
      if(v !== null){ segs.push(cur.join(' ')); cur = v ? [v] : []; i = skipConn(i) - 1; continue; }
    }
    if(comma){
      const left = cur.concat([t.replace(/[,;]+$/, '')]);
      const restAll = toks.slice(i + 1);
      if(restAll.length === 1 && QK_SPLIT_1.has(normKey(restAll[0])) && qkExtract(left.join(' ')).monto){ cur = left.concat(restAll); i = toks.length; continue; }
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
  const m = seg.match(/(?:^|\s)(\d{1,2})\s+(?!mil|k\b|m\b|mill|lucas?|palos?|pesos)(?=\p{L}|\d{1,2}\s)/u);
  return m && +m[1] >= 2 ? +m[1] : 0;
}

/* ═══════════════════════════════════════════════
   §12–13 — Capas de robustez del lenguaje
   texto → limpiar → verbos canónicos → números en palabras → montos explícitos a pesos
         → montos sueltos según el producto (cláusula) → segmentos
         → por segmento: reparto · fechas · bolsillos (alias) · apartado · fiado · parte de pago
         → parseQuick → producto contra el stock · gasto vs compra · negocio/personal · reglas aprendidas
═══════════════════════════════════════════════ */
const QK_TL = {a: '[aáàâ]', e: '[eéèê]', i: '[iíìî]', o: '[oóòô]', u: '[uúùüû]'};
const qkTl = s => { // vocales → clase con tildes (sin tocar lo que ya está dentro de [...] ni secuencias \p{..}, \s…)
  let out = '', cls = false;
  for(let i = 0; i < s.length; i++){
    const c = s[i];
    if(c === '\\'){ out += c + (s[i + 1] || ''); i++; if(s[i] === 'p' && s[i + 1] === '{'){ const j = s.indexOf('}', i); out += s.slice(i + 1, j + 1); i = j; } continue; }
    if(c === '[') cls = true; else if(c === ']') cls = false;
    out += !cls && QK_TL[c] ? QK_TL[c] : c;
  }
  return out;
};
const QB0 = '(?<![\\p{L}\\p{N}])', QB1 = '(?![\\p{L}\\p{N}])';
/* regex de palabra completa, sin importar tildes ni mayúsculas */
const qkRx = (p, f) => new RegExp(QB0 + '(?:' + qkTl(p) + ')' + QB1, f || 'giu');
const qkSp = s => String(s || '').replace(/\s+/g, ' ').trim();
const qkHas = (s, p) => qkRx(p, 'iu').test(s);

/* ── 1. Limpieza: emojis, letras repetidas, typos, muletillas, "pa/pal" ── */
const QK_TYPOS = {
  bendi: 'vendí', bendí: 'vendí', vendy: 'vendí', bemdi: 'vendí', vndi: 'vendí', vendii: 'vendí',
  conpre: 'compré', compr: 'compré', compe: 'compré', cmpre: 'compré',
  neki: 'nequi', neky: 'nequi', nequy: 'nequi', nekui: 'nequi', nequii: 'nequi', nekii: 'nequi', nequ: 'nequi',
  efetivo: 'efectivo', efectibo: 'efectivo', efecivo: 'efectivo', efectvo: 'efectivo', efetibo: 'efectivo',
  aifon: 'iphone', ayfon: 'iphone', aifone: 'iphone', iphon: 'iphone', ifon: 'iphone', iphnoe: 'iphone', iphpne: 'iphone',
  almuerso: 'almuerzo', almorze: 'almuerzo', almuerzoo: 'almuerzo', gasolna: 'gasolina', gasolia: 'gasolina',
  domisilio: 'domicilio', domicilo: 'domicilio', envio: 'envío', embio: 'envío', enbio: 'envío',
  samsun: 'samsung', ply: 'play', neque: 'nequi', nekk: 'nequi', nek: 'nequi', lks: 'lucas', lk: 'luca', gsolina: 'gasolina', gasolin: 'gasolina', vndi: 'vendí', compre1: 'compré', swich: 'switch', swicht: 'switch', suich: 'switch', promax: 'pro max', lukas: 'lucas', luka: 'luca', melos: 'millones', varas: 'mil', barritas: 'mil', samgung: 'samsung', plei: 'play', pley: 'play', plai: 'play', samsumg: 'samsung', sansung: 'samsung', samnsung: 'samsung', samgsung: 'samsung',
  xiomi: 'xiaomi', xiaomy: 'xiaomi', shaomi: 'xiaomi', parquiadero: 'parqueadero', parqeadero: 'parqueadero',
  interrapidismo: 'interrapidísimo', interapidisimo: 'interrapidísimo', servientraga: 'servientrega', sevientrega: 'servientrega',
  arriendoo: 'arriendo', ariendo: 'arriendo', mercadoo: 'mercado', presté: 'presté', preste: 'presté', abono: 'abonó',
  q: 'que', k: 'k', xq: 'porque', pq: 'porque', tmb: 'también', tb: 'también', dl: 'del'
};
const QK_INTERJ = '(?:para\\s+q\\s+quede|para\\s+que\\s+quede|pa\\s+q\\s+quede|mmm+|xfa|porfa|por\\s+favor|anota\\s+q|anota\\s+que|anotame\\s+q|anotame\\s+que|q\\s+mas|que\\s+mas|por\\s+fin|eh+|ave\\s+maria|avemaria|juepucha|hijuepucha|uy+|q\\s+hubo|que\\s+hubo|quiubo|quihubo|oiga|oigan|ey\\s+parce|oe|oye|ey|hey|ola|hola|bueno|pues|pues nada|nada|parce|parcero|parcera|mano|ome|home|uy|uf|uff|ve|vea|listo|jaja\\p{L}*|jeje\\p{L}*|jsjs\\p{L}*|ojo|anotame|anota|apunta|apuntame|registra|registrame|mira)';
function qkClean(t){
  t = String(t || '')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, ' ')
    .replace(/[“”"«»]/g, ' ').replace(/\s*:\s+/g, ', ')
    .replace(/(\p{L})\1{2,}/gu, '$1')                       // gasolinaaa → gasolina
    .replace(/(\p{L}{3,}?)([aeiou])\2(?![\p{L}])/giu, '$1$2') // gasolinaa → gasolina
    .replace(/\bpa['’]?l\b/giu, 'para el').replace(/(?<![\p{L}])pa['’]?(?![\p{L}])/giu, 'para')
    .replace(/(\d)\s*'\s*(\d{3})(?:[.,](\d{3}))?/g, (m, a, b, c) => a + b + (c || ''))   // 1'600.000
    .replace(/(\d+)\s+(?:punto|coma)\s+(\d+)/giu, '$1.$2')                                // 1 punto 8
    .replace(/\$\s+(?=\d)/g, '$');
  t = t.split(/\s+/).map(w => {
    const m = w.match(/^([^\p{L}\p{N}$]*)([\p{L}]+)([^\p{L}\p{N}]*)$/u);
    if(!m) return w;
    const k = normKey(m[2]);
    return QK_TYPOS[k] && !/^(abono|k|q)$/.test(k) ? m[1] + QK_TYPOS[k] + m[3] : w;
  }).join(' ');
  // muletillas al inicio ("oe parce", "bueno pues", "pues nada,") y sueltas
  t = t.replace(/(?<=\s)x(?=\s+(?:nequi|efectivo|transferencia|el|la|un|una))/giu, 'por');
  t = t.replace(/((?:^|\s)(?:el|la|un|una|galaxy|samsung)\s+)([sa])\s+(\d{2})(?!\d)/giu, '$1$2$3');
  t = t.replace(/(?<![\p{L}\d])(\d{2})\s?pm(?![\p{L}])/giu, '$1 pro max').replace(/(?<![\p{L}\d])(\d)[oO]{2}(?![\p{L}\d])/g, '$100');   // "el s 23" → s23
  // "en ochocientos y pico, 830": si hay una cifra exacta después, el aproximado sobra
  t = t.replace(/(\S+)\s+y\s+pico\b,?(?=.*\d)/giu, ' ').replace(/\s+y\s+pico\b/giu, '');
  t = t.replace(new RegExp('^\\s*(?:' + qkTl(QK_INTERJ) + '[\\s,.:!;-]+)+', 'iu'), '');
  t = t.replace(qkRx('parce|parcero|parcera|ome|jaja\\p{L}*|jeje\\p{L}*'), ' ').replace(/\s+pues\s*$/iu, '');
  return qkSp(t.replace(/\s+([,;.])/g, '$1'));
}

/* ── 2. Verbos y jerga a una forma canónica que entiende el motor ── */
const QK_CANON = [
  // "el 16 pro max lo vendí en 2.5" / "el 15 pro se lo vendí a juan" → "vendí el …"
  [new RegExp('^\\s*((?:el|la|los|las)\\s+[^,;]+?)\\s+(?:se\\s+)?(?:lo|la|los|las)\\s+' + qkTl('(?:vendi|vendimos|cambie)') + QB1, 'iu'), (m, o) => 'vendí ' + o],
  [qkRx('(?:me\\s+)?cambi(?:aron|e|é)\\s+((?:el|la|los|las)\\s+.+?)\\s+por\\s+(un|una|unos|unas)'), (m, a, b) => `vendí ${a} y me dieron ${b}`],
  [qkRx('(?:que\\s+)?(?:se\\s+)?(?:estima|calculo|creo|digamos)(?:\\s+que)?\\s+(?:vale|valdra|esta|anda)(?:\\s+en)?|que\\s+(?:se\\s+)?estima\\s+en|estimad[oa]s?\\s+en|estimad[oa]s?|tasad[oa]s?\\s+en|que\\s+vale|que\\s+valdra|que\\s+cuesta|que\\s+anda\\s+en|recibid[oa]s?\\s+en|tomad[oa]s?\\s+en'), 'valorado en'],
  [qkRx('me\\s+compraron|me\\s+compro|mi\\s+socio\\s+vendio|vendio|vendieron|vendimos'), 'vendí'],
  [qkRx('que\\s+(?:compre|vendi|tengo|tenia)(?=\\s*[,;]|\\s*$|\\s+\\$?\\d)'), ' '],
  [qkRx('le\\s+cambie\\s+(?:la|el|los|las)\\s+(pantalla|bateria|tapa|camara|puerto|display|vidrio|modulo|pin|flex)'), (m, x) => 'gasté arreglo ' + x],
  [qkRx('me\\s+toco\\s+pagar|me\\s+toco\\s+poner'), 'pagué'],
  [qkRx('le\\s+volvi\\s+a\\s+prestar|le\\s+adelante|le\\s+hice\\s+el\\s+favor\\s+(?:a\\s+)?'), 'le presté '],
  [qkRx('qued[oó]\\s+en\\s+deberme|quedo\\s+debiendome|me\\s+queda\\s+debiendo'), 'me debe'],
  [qkRx('me\\s+solto|me\\s+cuadro|me\\s+puso|me\\s+tiro|me\\s+hizo\\s+llegar|me\\s+dejo\\s+(?=\\$?\\d)|me\\s+deposito|cancelo\\s+todo|cancelo'), 'me consignó'],
  [qkRx('me\\s+depositaron|propinas?'), 'recibí'],
  [qkRx('baje|bajé'), 'saqué'],
  [qkRx('(\\$?\\d[\\d.,]*\\s*(?:mil|k|lucas?|palos?|millones?)?)\\s+retirad[oa]s'), (m, a) => 'retiré ' + a],
  [qkRx('inyecte|aporte|le\\s+meti|meti'), 'metí'],
  [qkRx('cojo|tome|me\\s+pago\\s+un\\s+sueldo\\s+de|me\\s+pague\\s+un\\s+sueldo\\s+de'), m => /sueldo/i.test(m) ? 'me pagué' : 'tomé'],
  [qkRx('(?:con|de)\\s+lo\\s+apartado(?:\\s+(?:para|pa)\\s+eso)?|(?:con|de)\\s+la\\s+plata\\s+apartada'), ' de lo apartado '],
  [qkRx('apartad[oa]s'), 'aparté'],
  [new RegExp('^\\s*((?:el|la|los|las)\\s+[^,;]+?)\\s+me\\s+(?:lo|la|los|las)\\s+(pagaron|pago|pagó|compraron|compro|compró)', 'iu'), (m, o, v) => 'vendí ' + o + ' y me lo ' + v],
  [qkRx('le\\s+solte|solte|cerre\\s+(?:el\\s+)?negocio\\s+con|negocie|despachamos|despache|ya\\s+tiene\\s+(?:dueño|dueno)|tiene\\s+(?:dueño|dueno)'), 'vendí'],
  [qkRx('(?<!me\\s)salio(?=\\s+(?:en|por|a)\\s+\\$?\\d)'), 'vendí'],
  [qkRx('se\\s+me\\s+fue(?=\\s+(?:el|la|los|las|un|una))'), 'vendí'],
  [qkRx('cace|pille|levante|me\\s+quede\\s+con(?=\\s+(?:un|una|el|la|unos|unas))|me\\s+hice(?=\\s+(?:un|una|unos|unas))|me\\s+cayo(?=\\s+(?:un|una|unos|unas)\\s+(?!plata|platica|billete|liquidacion|prima))'), 'compré'],
  [qkRx('(?:lo|la|los|las)\\s+saque\\s+fiad[oa]s?|(?:lo|la|los|las)\\s+deje\\s+fiad[oa]s?|se\\s+(?:lo|la|los|las)\\s+deje'), 'fié'],
  [qkRx('pagarmel[oa]s?|pagarmela|me\\s+va\\s+abonando|va\\s+abonando'), ' fiado '],
  [qkRx('se\\s+(?:lo|la|los|las)\\s+llev(?:o|aron)'), 'lo vendí'],
  [qkRx('(?:lo|la|los|las)\\s+(?:saque|tome|cogi)(?=\\s+(?:de|del|de\\s+la)\\s)'), 'lo pagué'],
  [qkRx('(?:tengo|tenia|esta|estan|puse|tengo\\s+puesto)\\s+en\\s+venta'), 'para vender'],
  [qkRx('me\\s+(?:lo|la|los|las)\\s+gaste'), 'gasté eso'],
  [qkRx('me\\s+lleve|me\\s+traje|me\\s+hice\\s+con|cogi|agarre|consegui|me\\s+consegui|me\\s+traje|traje|adquiri|encargue|me\\s+encargue|pedi|compramos|compro'), 'compré'],
  [qkRx('me\\s+salio|me\\s+salieron'), 'costó'],
  [qkRx('se\\s+fue(?=\\s+(?:el|la|los|las|un|una)\\s+(?!plata|platica|billete|sueldo|quincena))|salio(?=\\s+(?:el|la|los|las|un|una|otro|otra))|salieron(?=\\s+(?:el|la|los|las|unos|unas))|se\\s+fueron|se\\s+vendio|se\\s+vendieron|entregue|despache|coloque|remate|me\\s+compraron|me\\s+compro|le\\s+vendi|les\\s+vendi|vendimos|logre\\s+vender|ya\\s+vendi'), 'vendí'],
  [qkRx('sali\\s+(?=del|de\\s+la|de\\s+los)'), 'vendí '],
  [qkRx('se\\s+me\\s+fueron|se\\s+me\\s+fue|me\\s+cobraron|me\\s+costo|costo|me\\s+gaste|invert[ií]\\s+en|bote'), 'gasté'],
  [qkRx('tanquee|tanque[eé]'), 'gasté gasolina'],
  [qkRx('le\\s+eche|eche'), 'gasté'],
  [qkRx('almorce|almorcé'), 'almuerzo'], [qkRx('desayune'), 'desayuno'], [qkRx('cene'), 'cena'],
  [qkRx('me\\s+tome|nos\\s+tomamos'), 'gasté'],
  [qkRx('me\\s+mando|me\\s+mandaron|me\\s+envio|me\\s+enviaron|me\\s+trajo|me\\s+trajeron'), 'me consignó'],
  [qkRx('me\\s+cayeron|me\\s+cayo\\s+(?:una\\s+)?(?=plata|platica|billete|liquidacion|prima)|me\\s+cayo|me\\s+reembolsaron|me\\s+reembolso|me\\s+encontre|salio\\s+mi\\s+numero|me\\s+salio\\s+el\\s+chance|ingrese|reembolso|cashback|devolucion|me\\s+dieron(?=\\s+\\$?\\d)'), 'recibí'],
  [qkRx('me\\s+regalo|me\\s+regalaron|me\\s+entraron|me\\s+entro|me\\s+llegaron|me\\s+llego|me\\s+devolvieron|me\\s+devolvio|me\\s+gane|me\\s+prestaron|me\\s+presto|cobre'), 'recibí'],
  [qkRx('le\\s+(?:pase|di|mande|consigne|gire|transferi|deje)(?=.*' + qkTl('prestad') + ')'), 'le presté'],
  [qkRx('prestad[oa]s?'), ' '],
  [qkRx('le\\s+fie|fie'), 'fié'],
  [qkRx('qued[oó]\\s+de\\s+pagarme|queda\\s+de\\s+pagarme|me\\s+(?:lo|la|los|las)\\s+paga|me\\s+paga\\s+(?:el|la|en|mañana|manana|despues|luego)|a\\s+credito|de\\s+fiado|fiao'), m => ' fiado ' + (/\s(el|la|en)$/i.test(m) ? '' : '')],
  [qkRx('me\\s+abono|me\\s+giro|me\\s+transfirio|me\\s+cancelo|me\\s+hizo\\s+un\\s+nequi'), 'me consignó'],
  [qkRx('abono\\s+de'), 'abonó'],
  [qkRx('ganancia|ganancias|utilidad|utilidades'), 'ganancia']
];
function qkCanon(t){
  QK_CANON.forEach(([re, rep]) => { t = t.replace(re, rep); });
  return qkSp(t);
}

/* ── 3. Números en palabras ("un millón doscientos", "veinte lucas", "dos palos y medio") ── */
const QK_NW = {cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21,
  veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200,
  doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, quinientos: 500, quinientas: 500, seiscientos: 600, setecientos: 700,
  ochocientos: 800, novecientos: 900};
const QK_MUL_M = /^(millon|millones|palo|palos|melon|melones|melo|melos|m)$/;
const QK_MUL_K = /^(mil|luca|lucas|barra|barras|k)$/;
function qkNumWords(t){
  const toks = t.split(' ');
  const out = [];
  for(let i = 0; i < toks.length; i++){
    const n0 = normKey(toks[i]);
    if(!(n0 in QK_NW) && !(n0 === 'medio' || n0 === 'media') && !/^(palo|millon|luca|mil)$/.test(n0)){ out.push(toks[i]); continue; }
    if(/^(palo|palos|millon|millones|luca|lucas|mil|medio|media)$/.test(n0) && /\d[.,]?$/.test(out.length ? out[out.length - 1] : '')){ out.push(toks[i]); continue; }
    // recoger la corrida
    let j = i, total = 0, cur = 0, words = 0, lastMul = '', mult = false, half = false, trail = '';
    const isNum = k => k in QK_NW;
    for(; j < toks.length; j++){
      const raw = toks[j], k = normKey(raw);
      if(isNum(k)){ cur += QK_NW[k]; words++; lastMul = lastMul === 'M' ? 'M+' : lastMul; }
      else if(k === 'y' && j > i && j + 1 < toks.length && (isNum(normKey(toks[j + 1])) || /^medi[oa]$/.test(normKey(toks[j + 1])))) continue;
      else if(/^(mil)$/.test(k)){ cur = (cur || 1) * 1000; lastMul = 'K'; mult = true; words++; }
      else if(QK_MUL_K.test(k) && k !== 'k'){ cur = (cur || 1) * 1000; total += cur; cur = 0; lastMul = 'K!'; mult = true; words++; j++; break; }
      else if(QK_MUL_M.test(k) && k !== 'm'){ total += (cur || 1) * 1e6; cur = 0; lastMul = 'M'; mult = true; words++; }
      else if(/^medi[oa]$/.test(k)){
        const nx = normKey(toks[j + 1] || '');
        if(QK_MUL_M.test(nx) && nx !== 'm'){ total += 500000; j += 2; mult = true; words++; break; }
        if(/^(luca|barra)$/.test(nx)){ total += 500; j += 2; mult = true; words++; break; }
        if(lastMul === 'M'){ total += 500000; half = true; words++; j++; break; }
        break;
      }
      else break;
      if(/[,;.]$/.test(raw)){ trail = raw.match(/[,;.]+$/)[0]; j++; break; }
    }
    // "un/una/uno" solos no son números ("una ps4"), tampoco palabras sin nada más ("cien" sí)
    const onlyArticle = words === 1 && /^(un|una|uno)$/.test(n0) && !mult;
    if(!words || onlyArticle){ out.push(toks[i]); continue; }
    // "un millón 250 mil": deja la unidad para que qkUnits arme el compuesto
    if(lastMul === 'M' && !cur && /^\d/.test(toks[j] || '')){ out.push(String(total / 1e6) + ' millones' + trail); i = j - 1; continue; }
    // pares paisas en productos caros: "uno cuatro" = 1,4 · "dos cien" = 2,1 · "uno cincuenta" = 1,5 (millones)
    const run = toks.slice(i, j).map(normKey).filter(x => x !== 'y');
    if(!mult && run.length === 2 && QK_NW[run[0]] >= 1 && QK_NW[run[0]] < 10 && QK_NW[run[1]] != null && !/^(un|una)$/.test(run[0])){
      const b = QK_NW[run[1]], a = QK_NW[run[0]];
      out.push(String(a + (b < 10 ? b / 10 : b < 100 ? b / 100 : b / 1000)) + trail); i = j - 1; continue;
    }
    if(cur){ total += (lastMul === 'M+' && cur < 1000) ? cur * 1000 : cur; }   // "tres millones doscientos" → 3.200.000
    out.push(String(Math.round(total)) + (mult && (total >= 10000 || lastMul === 'K!' || lastMul === 'M' || half) ? '§' : '') + trail);
    i = j - 1;
  }
  return out.join(' ');
}

/* ── 4. Montos con unidad → pesos ("1.2M", "50k", "380 lucas", "2 millones y 500 mil", "$ 1.200.000,00") ── */
const QK_UM = '(?:m|millones|mill[oó]n|palos?|mel[oó]n(?:es)?|melos?)';
const QK_UK = '(?:k|mil|lucas?|barras?)';
const qkNum = s => parseFloat(String(s).replace(',', '.'));
const qkMark = v => (v >= 1000 ? String(Math.round(v)) : '$' + Math.round(v)) + '§';
function qkUnits(t){
  const B = '(?=[\\s,;.!?)]|$)';
  return t
    .replace(/(?<![\d.,])\$?\s?(\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?(?![\d.])/g, (m, a) => ' ' + qkMark(+a.replace(/\./g, '')))
    .replace(/(?<![\d.,])\$?\s?(\d{1,3}(?:,\d{3}){2,})(?!\d)/g, (m, a) => ' ' + qkMark(+a.replace(/,/g, '')))
    .replace(new RegExp('(\\d+(?:[.,]\\d+)?)\\s*' + QK_UM + '\\s+y\\s+medio' + B, 'giu'), (m, a) => qkMark((qkNum(a) + 0.5) * 1e6))
    .replace(new RegExp('(\\d+(?:[.,]\\d+)?)\\s*' + QK_UM + '\\s+(?:y\\s+)?(\\d{1,3}(?:[.,]\\d+)?)\\s*(?:' + QK_UK + ')?' + B + '(?!\\s*(?:controles|juegos|unidades))', 'giu'),
      (m, a, b) => qkMark(qkNum(a) * 1e6 + qkNum(b) * 1e3))
    .replace(new RegExp('\\$?(\\d+(?:[.,]\\d+)?)\\s*' + QK_UM + B, 'giu'), (m, a) => qkMark(qkNum(a) * 1e6))
    .replace(new RegExp('\\$?(\\d+(?:[.,]\\d+)?)\\s*' + QK_UK + B, 'giu'), (m, a) => qkMark(qkNum(a) * 1e3))
    .replace(/\$?(\d+)§?\s*pesos?(?![\p{L}])/giu, (m, a) => qkMark(+a))
    .replace(/(\d+)§(?=\s*§)/g, '$1');
}

/* ── 5. Montos sueltos según el producto de la cláusula ── */
const QK_MODELW = new Set(('flip fold z rx gt iphone ipad ps play playstation series serie xbox galaxy note redmi poco pixel watch switch mac macbook gtx rtx core ryzen ' +
  'pro max plus ultra mini lite slim jordan air force balance dunk yeezy talla nmax pulsar fz duke ns akt cbr gen generacion version modelo edicion ' +
  'numero no nro capitulo temporada').split(' '));
const QK_SPECU = /^(gb|g|tb|cc|hp|mah|w|pulgadas|pulg|mm|cm|dias?|semanas?|meses|mes|anos?|años?|horas?|h|%|unidades|unid|uds|pares?|veces|cuotas|personas|controles|juegos|fundas|cajas|bolsas|pantallas|cargadores|camisetas|tenis|piezas|kilos|kg|litros|cuadras|min|minutos)$/;
const QK_NEXT_OK = new Set('en por a al de del y e con para nequi efectivo cash fisico pesos mas pero que q x via o mil k lucas luca palos palo millones millon desde hoy ayer'.split(' '));
const QK_ARTS = new Set('el la los las un una unos unas del al lo otro otra este esta ese esa'.split(' '));
const QK_STORAGE = new Set([16, 32, 64, 128, 256, 512, 1024]);
function qkBare(t, caro){
  const toks = t.split(' ');
  if(/§/.test(t)) return t;
  let fallback = -1;
  const res = toks.map((w, i) => {
    const m = w.match(/^(\$?)(\d+(?:[.,]\d+)?)([,;.!?)]*)$/);
    if(!m || /§/.test(w)) return w;
    const raw = m[2], dec = /[.,]/.test(raw), v = qkNum(raw);
    const prev = normKey(toks[i - 1] || ''), prev2 = normKey(toks[i - 2] || ''), next = normKey(toks[i + 1] || '');
    if(QK_SPECU.test(next)) return w;
    if(!dec && v < 100 && /^\p{L}/u.test(next) && !QK_NEXT_OK.has(next) && !/^(c u|cada)/.test(next)) return w;   // 3 fundas, 2 iphone, 16 pro max
    if(!dec && v >= 1000 && v < 10000 && QK_MODELW.has(prev)) return w + '\u2060';             // rtx 3060, new balance 9060
    if(!dec && v <= 31 && (/^(lunes|martes|miercoles|jueves|viernes|sabado|domingo|dia)$/.test(prev) || (next === 'de' && /^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)$/.test(normKey(toks[i + 2] || ''))))) return w;
    if(!dec && v < 100 && (/^\d{1,2}$/.test(prev) || /^\d/.test(next))) return w;              // "dos 13", "1 14 pro"
    if(!dec && (QK_MODELW.has(prev) && !(prev.length === 1 && v >= 100) || /^\p{L}+\d+$/u.test(prev))){ if(v >= 100 && i === toks.length - 1 - (m[3] ? 0 : 0)) fallback = i; return w; }   // iphone 13, jordan 11, s23 256
    if(!dec && QK_ARTS.has(prev) && v < 100) return w;                                           // el 15, un 13 (producto o fecha)
    if(!dec && prev === 'de' && QK_STORAGE.has(v) && (/^\d+$/.test(prev2) || QK_MODELW.has(prev2))) return w;   // el 13 de 128
    if(!dec && /^(hace|cada|los|las|unos|unas|como|tipo)$/.test(prev) && v < 100) return w;
    let r;
    if(dec) r = v < 100 ? (caro || v < 10 ? v * 1e6 : v * 1e3) : v;
    else if(v < 100) r = caro ? v * 1e6 : v * 1e3;
    else if(v < 1000) r = v * 1e3;
    else if(v < 10000) r = caro ? v * 1e3 : v;
    else r = v;
    return qkMark(r).replace('§', '') + '§' + m[3];
  });
  if(!res.some(w => /§/.test(w)) && fallback >= 0){   // "salieron los jordan 450": no hubo otro monto
    const m = toks[fallback].match(/^(\$?)(\d+)([,;.!?)]*)$/); const v = +m[2];
    res[fallback] = qkMark(v < 1000 ? v * 1e3 : (caro && v < 10000 ? v * 1e3 : v)).replace('§', '') + '§' + m[3];
  }
  return res.join(' ');
}
/* cláusulas: lo que hay entre comas / "y" / "luego" */
const QK_CL_SPLIT = /(\s*[,;](?!\d)\s*|\s+(?:y|e|luego|despues|después|entonces|pero|mas|más|\+)\s+)/iu;
const QK_GVERB = /(^| )(me abono|abono|me pago|me consigno|me paso|me debe|le preste|preste|gaste|pague|pagamos|retire|saque|pase|movi|consigne|meti|cargue|recargue|aparte|separe|guarde|reserve|recibi|me pagaron)( |$)/;
const QK_TRADE_V = /(^| )(compre|vendi|venta|vendido|vendida|valorad[oa]|avaluad[oa]|cambie|recibiendo|inicial|parte de pago|en plata|de plata)( |$)/;
const QK_PAY_V = /(^| )(gaste|pague|le pague|le di|cobro|me cobro|me pago|me pagaron|recibi|me consigno|costo|gasolina|eso)( |$)/;
function qkClauseCat(cl, ctx, prevCat){
  const n = normKey(cl);
  if(!QK_TRADE_V.test(n) && (QK_PAY_V.test(n) || guessGCat(cl) !== 'Otro') && !(prevCat && QK_CAROS.includes(prevCat) && /^(me abono|abono|me pago|pago|me consigno|consigno|me dio|me paso|me dieron|me pagaron|quedo|me quedo|me debe|recibi)( |$)/.test(n))) return 'Otro';
  let c = /^\s*\$?[\d.,]+\s*$/.test(cl) ? 'Otro' : guessCat(cl);
  if(c === 'Otro' && /(^| )(un|una|el|del|al|otro|este)\s+1[1-7]( pro| max| plus| mini|$| )/.test(n)) c = 'Celulares';
  if(c === 'Otro' && /(^| )(vendi|venta|vendido|vendida)( |$)/.test(n)){
    const r = qkMatchStock(n, (ctx && ctx.stock) || []);
    if(r.item && r.item.cat) c = r.item.cat;
    else if(r.cands.length && r.cands.every(x => QK_CAROS.includes(x.cat))) c = r.cands[0].cat;
  }
  if(c === 'Otro' && prevCat && QK_CAROS.includes(prevCat) && guessGCat(cl) === 'Otro' && (!QK_GVERB.test(n) || /^(me abono|abono|me pago|pago|me consigno|consigno|me dio|me paso|me dieron|me pagaron|quedo|me quedo|me debe|recibi)( |$)/.test(n))) c = prevCat;
  return c;
}
function qkScaleText(t, ctx){
  const parts = t.split(QK_CL_SPLIT);
  let prevCat = '';
  for(let k = 0; k < parts.length; k += 2){
    const cat = qkClauseCat(parts[k], ctx, prevCat);
    parts[k] = qkBare(parts[k], QK_CAROS.includes(cat));
    prevCat = cat !== 'Otro' ? cat : prevCat;
  }
  return parts.join('');
}
const qkUnmark = t => t.replace(/§/g, '');

/* ── 6. Producto contra el stock: apodos, modelo exacto, ambigüedad ── */
const QK_SYN = {
  play: ['ps5', 'ps4', 'playstation', 'ps'], playstation: ['ps5', 'ps4', 'play', 'ps'], plei: ['ps5', 'ps4'], ps: ['ps5', 'ps4', 'ps3'],
  mac: ['macbook', 'imac'], macbook: ['mac'], portatil: ['@Computadores'], laptop: ['@Computadores'], computador: ['@Computadores'],
  compu: ['@Computadores'], pc: ['@Computadores'], celular: ['@Celulares'], cel: ['@Celulares'], telefono: ['@Celulares'], equipo: ['@Celulares'],
  tenis: ['@Calzado'], zapatillas: ['@Calzado'], zapatos: ['@Calzado'], moto: ['@Moto/Auto'], consola: ['@Consolas'], galaxy: ['samsung'],
  samsung: ['galaxy'], iphone: ['iphone'], audifonos: ['airpods', 'buds', '@Accesorios'], reloj: ['watch', '@Accesorios'], watch: ['reloj'],
  nintendo: ['switch'], switch: ['nintendo'], buzo: ['hoodie', 'saco'], saco: ['buzo'], jordan: ['jordan'], af1: ['air', 'force'], tablet: ['ipad']
};
const QK_QUAL = new Set('pro max plus mini ultra slim lite oled digital se air fe retro'.split(' '));
const QK_NOISE = new Set(('vendi venta vendido vendida compre fiado credito cambie en por de del el la los las un una unos unas a al para con mi me le lo y que ' +
  'ya hoy ayer pesos plata nequi efectivo cash todo completo encima original nuevo nueva usado usada negro negra blanco blanca azul rojo gris ' +
  'mitad resto debiendo debe me dio dieron pago paso consigno quedo').split(' '));
function qkItemToks(it){
  const base = normKey(it.desc).split(' ').filter(Boolean);
  const out = new Set(base);
  base.forEach(w => { const m = w.match(/^([a-z]+)(\d+)([a-z]*)$/); if(m){ out.add(m[1]); out.add(m[2]); } });
  return out;
}
function qkMatchStock(q, stock, strict){
  const res = {item: null, amb: false, cands: []};
  if(!stock || !stock.length) return res;
  const vocab = new Set();
  const items = stock.map(it => { const t = qkItemToks(it); t.forEach(w => vocab.add(w)); return {it, t}; });
  normKey(stock.map(x => x.desc).join(' ')).split(' ').forEach(w => vocab.add(w));
  const q0 = [];
  normKey(q).split(' ').forEach(w => { const m = w.match(/^([a-z]+)(\d{1,3})$/); if(m && !vocab.has(w)){ q0.push(m[1] === 'i' ? 'iphone' : m[1], m[2]); } else q0.push(w); });
  const qt = q0.filter((w, i) => w && !QK_NOISE.has(w) && !(/^\d/.test(w) && (+w >= 100 || !(QK_ARTS.has(q0[i - 1] || '') || QK_MODELW.has(q0[i - 1] || '') || QK_SYN[q0[i - 1] || '']))));
  const req = qt.filter(w => vocab.has(w) || QK_SYN[w] || /^\d+$/.test(w) && +w < 100);
  if(!req.length) return res;
  const scored = [];
  items.forEach(({it, t}) => {
    let ok = true, hit = 0;
    req.forEach(w => {
      const syn = QK_SYN[w] || [];
      if(t.has(w) || syn.some(s => s[0] === '@' ? s.slice(1) === it.cat : t.has(s)) || (w.length >= 4 && [...t].some(x => x.length >= 4 && (x.startsWith(w) || w.startsWith(x))))) hit++;
      else ok = false;
    });
    if(!ok) return;
    let pen = 0;
    t.forEach(x => { if(QK_QUAL.has(x) && !qt.includes(x)) pen++; });
    scored.push({it, hit, pen});
  });
  if(!scored.length) return res;
  const onlyCat = req.every(w => (QK_SYN[w] || []).length && (QK_SYN[w] || []).every(x => x[0] === '@') && !vocab.has(w));
  if(onlyCat && (scored.length > 1 || strict)){ res.cands = scored.map(s => s.it); res.amb = scored.length > 1; return res; }
  const best = Math.min(...scored.map(s => s.pen));
  const top = scored.filter(s => s.pen === best);
  res.cands = scored.map(s => s.it);
  if(top.length === 1) res.item = top[0].it; else res.amb = true;
  return res;
}

/* ── 7. Fechas relativas ── */
const QK_MESES = {enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12};
const QK_DOW = {domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6};
const qkYmd = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
function qkDate(seg){
  const hoy = qkToday(), [Y, M, D] = hoy.split('-').map(Number);
  const dow = new Date(Date.UTC(Y, M - 1, D)).getUTCDay();
  let fecha, s = ' ' + seg + ' ';
  const take = (re, fn) => { if(fecha) return; s = s.replace(re, (...a) => { const f = fn(...a); if(f){ fecha = f; return ' '; } return a[0]; }); };
  const fixDay = (d, m, y) => {
    if(d < 1 || d > 31) return null;
    if(m){ let yy = y || Y; let f = qkYmd(yy, m, d); if(!y && f > hoy) f = qkYmd(yy - 1, m, d); return f; }
    let mm = M, yy = Y; if(d > D){ mm--; if(!mm){ mm = 12; yy--; } }
    return qkYmd(yy, mm, d);
  };
  const MES = '(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|jun|jul|ago|sept?|oct|nov|dic)';
  take(qkRx('(?:el\\s+)?(?:dia\\s+)?(\\d{1,2})\\s+de\\s+' + MES + '(?:\\s+(?:de\\s+)?(\\d{4}))?'), (m, d, mes, y) => fixDay(+d, QK_MESES[normKey(mes)], y ? +y : 0));
  take(qkRx('(?:el\\s+)?(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?'), (m, d, mm, y) => fixDay(+d, +mm, y ? (+y < 100 ? 2000 + +y : +y) : 0));
  take(qkRx('antes\\s+de\\s+ayer|anteayer|antier|antenoche'), () => qkShift(hoy, -2));
  take(qkRx('ayer|anoche'), () => qkShift(hoy, -1));
  take(qkRx('hoy(?:\\s+en\\s+la\\s+(?:manana|mañana|tarde|noche))?|esta\\s+(?:manana|mañana|tarde|noche)|ahorita|ahora|hace\\s+un\\s+rato|en\\s+la\\s+manana|en\\s+la\\s+mañana'), () => hoy);
  take(qkRx('hace\\s+(?:como\\s+|unos\\s+|unas\\s+|mas\\s+o\\s+menos\\s+)?(\\d+|un|una)\\s+(dias?|semanas?)'), (m, n, u) => {
    const k = /^\d+$/.test(n) ? +n : 1; return qkShift(hoy, -(k * (/^sem/.test(normKey(u)) ? 7 : 1)));
  });
  take(qkRx('la\\s+semana\\s+pasada'), () => qkShift(hoy, -7));
  take(qkRx('(?:el|este|esta|en\\s+el)?\\s*(domingo|lunes|martes|miercoles|jueves|viernes|sabado)(?:\\s+(?:pasado|\\d{1,2}(?!\\d|\\s*(?:mil|k|lucas|palos|millones))))?'), (m, d) => {
    let diff = (dow - QK_DOW[normKey(d)] + 7) % 7; if(!diff) diff = 7; return qkShift(hoy, -diff);
  });
  take(qkRx('el\\s+dia\\s+(\\d{1,2})'), (m, d) => fixDay(+d));
  take(qkRx('el\\s+primero(?:\\s+de\\s+' + MES + ')?'), (m, mes) => fixDay(1, mes ? QK_MESES[normKey(mes)] : 0));
  // "el arriendo lo pagué el 1": verbo con pronombre + "el N"
  if(!fecha){ const re = new RegExp(qkTl('((?:lo|la|los|las)\\s+(?:pague|compre|vendi|gaste|saque|recibi|consigne))\\s+el\\s+(\\d{1,2})') + '(?!\\d|\\s*(?:mil|k|lucas|palos|millones|pro|max|plus|mini))', 'iu');
    const m = s.match(re); if(m){ const f = fixDay(+m[2]); if(f){ fecha = f; s = s.replace(m[0], ' ' + m[1] + ' '); } } }
  // "el 5 pagué la luz": "el N" al inicio, seguido de un verbo → fecha (si no, "el 15" es un iPhone 15)
  take(new RegExp('^\\s*el\\s+(?!1[1-7]\\s+(?:vend|compr))(\\d{1,2})\\s+(?=' + qkTl('(?:pague|compre|vendi|gaste|recibi|saque|retire|pase|consigne|aparte|envio|envío|preste|fie|abono|abonó)') + ')', 'iu'), (m, d) => fixDay(+d));
  return {seg: qkSp(s), fecha};
}

/* ── 8. Bolsillos por alias (gana el más largo; personas solo junto a "nequi") ── */
const QK_PERS = '(?:mi\\s+)?(?:novia|pareja|esposa|mujer|amor|vieja|senora|señora|negra|gorda|nena)|ella';
function qkPockets(seg, bols){
  const pers = bols.find(p => (p.alias || []).some(a => /(novia|pareja|esposa|mujer|ella)/.test(normKey(a))));
  const base = p => normKey(p.nombre).split(' ')[0];
  const own = bols.find(p => p.id === 'nequi') || bols.find(p => base(p) === 'nequi' && p !== pers);
  const ments = [];
  let s = ' ' + seg + ' ';
  const put = (re, id, role) => { s = s.replace(re, (...a) => { const idx = a[a.length - 2]; ments.push({id, i: idx, role, prep: normKey(a[1] || '')}); return ' ' + '¤'.repeat(1) + ' '; }); };
  if(pers){
    const pb = base(pers);
    // "el nequi de mi novia", "su nequi" (si la persona aparece), "al de mi novia", "lo pagó mi novia (por nequi)"
    put(qkRx('(de|del|desde|por|con|a|al|en|para)?\\s*(?:el\\s+|la\\s+|mi\\s+)?' + pb + '\\s+de\\s+(?:' + QK_PERS + ')'), pers.id);
    if(new RegExp(qkTl(QK_PERS), 'iu').test(s)) put(qkRx('(de|del|desde|por|con|a|al|en|para)?\\s*su\\s+' + pb), pers.id);
    put(qkRx('(de|del|desde|a|al|en|para)\\s+(?:el\\s+|la\\s+)?de\\s+(?:' + QK_PERS + ')'), pers.id);
    put(qkRx('()(?:lo|la|los|las)\\s+pag[oó]\\s+(?:' + QK_PERS + ')(?:\\s+(?:por|con|de|desde)\\s+(?:el\\s+|su\\s+)?' + pb + ')?'), pers.id, 'payer');
    put(qkRx('()pag[oó]\\s+(?:' + QK_PERS + ')(?:\\s+(?:por|con|de|desde)\\s+(?:el\\s+|su\\s+)?' + pb + ')?'), pers.id, 'payer');
    put(qkRx('()(?:' + QK_PERS + ')\\s+(?:lo|la|los|las)\\s+pag[oó](?:\\s+(?:por|con|de|desde)\\s+(?:el\\s+|su\\s+)?' + pb + ')?'), pers.id, 'payer');
    // "mi novia me pasó 200 de su nequi al mío"
    put(qkRx('(a|al|en|para)\\s+(?:el\\s+)?mio'), own ? own.id : 'nequi');
  }
  // alias explícitos (más largos primero), sin las palabras de persona sueltas
  const al = [];
  bols.forEach(p => [p.nombre].concat(p.alias || []).forEach(a => {
    const k = normKey(a).replace(/^(mi|el|la)\s+/, '');
    if(!k || (p === pers && !k.includes(base(p)))) return;
    if(p === pers && k === base(p)) return;
    al.push({k, id: p.id});
  }));
  if(bols.some(p => p.id === 'efectivo' || normKey(p.nombre) === 'efectivo')){
    const e = bols.find(p => p.id === 'efectivo' || normKey(p.nombre) === 'efectivo').id;
    ['efectivo', 'cash', 'fisico', 'billete', 'billetes', 'plata en mano', 'en mano', 'contante'].forEach(k => al.push({k, id: e}));
  }
  al.sort((a, b) => b.k.length - a.k.length);
  al.forEach(({k, id}) => put(qkRx('(de|del|desde|por|con|a|al|en|para|hacia)?\\s*(?:el\\s+|la\\s+|mi\\s+|mis\\s+)?' + k.split(' ').map(qkTl).join('\\s+')), id));
  ments.sort((a, b) => a.i - b.i);
  s = s.replace(/\s*¤\s*/g, ' ');
  return {seg: qkSp(s), ments};
}

/* ── 9. Apartados (fondos) ── */
function qkFondoAlias(fondos){
  const al = [];
  const extra = {personal: ['plata mia', 'mi plata', 'lo mio', 'mi bolsillo'], negocio: ['capital', 'plata del negocio', 'caja del negocio']};
  (fondos || []).forEach(f => (extra[f.id] || []).forEach(k => al.push({k, id: f.id})));
  (fondos || []).forEach(f => [f.nombre].concat(f.alias || []).forEach(a => {
    const k = normKey(a).replace(/^(el|la|los|las|lo|del|de)\s+/, '');
    if(k && k.length >= 3 && !/^(para mi|mi)$/.test(k)) al.push({k, id: f.id});
  }));
  return al.sort((a, b) => b.k.length - a.k.length);
}
function qkFondo(seg, fondos){
  let fondo, s = ' ' + seg + ' ';
  const al = qkFondoAlias(fondos);
  const alt = al.map(a => a.k.split(' ').map(qkTl).join('\\s+')).join('|');
  if(!alt) return {seg, fondo};
  const re = new RegExp(QB0 + '(?:(?:con|de|del|desde)\\s+)?(?:(?:la|el|mi)\\s+)?(?:plata|capital|platica|billete)\\s+(?:del|de\\s+la|de\\s+el|de\\s+los|de\\s+mi|de|pal|para\\s+el|para\\s+la)\\s+(' + alt + ')' + QB1
    + '|' + QB0 + '(?:del|de\\s+la|de\\s+lo|de\\s+mi|de\\s+mis|de\\s+los|de|con\\s+el|con\\s+la|con\\s+los|con\\s+mis|con)\\s+(?:lo\\s+|la\\s+|el\\s+|los\\s+|mis\\s+)?(' + alt + ')' + QB1
    + '|' + QB0 + '(?:va\\s+|es\\s+)?(?:para\\s+el|para\\s+la|para\\s+lo|para)\\s+(' + alt + ')' + QB1
    + '|' + QB0 + '(?:la\\s+|lo\\s+|los\\s+)?(?:dejo|deje|guardo|guarde|meto|pongo|va|queda|mando|paso)\\s+(?:en|para|a|al|pal)?\\s*(?:el\\s+|la\\s+|lo\\s+|los\\s+|mis\\s+)?(' + alt + ')' + QB1, 'iu');
  let m = s.match(re);
  // "con lo apartado": el apartado cuyo nombre aparece en la frase ("pagué la renta con lo apartado")
  if(!m && /(^| )de lo apartado( |$)/.test(normKey(s))){ const f = al.find(a => (' ' + normKey(s) + ' ').includes(' ' + a.k + ' ')); if(f){ fondo = f.id; s = s.replace(qkRx('de\\s+lo\\s+apartado'), ' '); } }
  if(!m){ const pm = s.match(qkRx('plata\\s+mia|lo\\s+mio')); if(pm && al.find(a => a.id === 'personal')){ fondo = 'personal'; s = s.replace(pm[0], ' '); } }
  if(m){
    const k = normKey(m[1] || m[2] || m[3] || m[4]);
    const f = al.find(a => a.k === k) || al.find(a => k.includes(a.k));
    // "pagué el arriendo …": el alias justo después de pagar/gasté es el GASTO, no el apartado (§13 criterio 13)
    if(f && !(m[2] && /^(de|del)\s/.test(normKey(m[0])) && false)){ fondo = f.id; s = s.replace(m[0], ' '); }
  }
  return {seg: qkSp(s), fondo};
}
/* Reparto entre apartados: "aparté 300 para el arriendo", "saqué 1 palo de ganancia", "pasé 500 del negocio a lo personal" */
const QK_REP_V = '(?:me\\s+quede\\s+con|retire|retiro|aparte|separe|guarde|reserve|ahorre|meti|le\\s+meti|pase|movi|saque|tome|me\\s+pague|devolvi|deje|puse|traslade|asigne|reparti)';
function qkReparto(seg, ctx){
  const n = normKey(seg);
  if(!qkHas(seg, QK_REP_V)) return null;
  if(/(^| )(q|que) me pague( |$)/.test(n) && !/(^| )(aparte|separe|guarde|reserve|ahorre|meti|saque|ganancia)( |$)/.test(n)) return null;
  if(/(^| )(cajero|corresponsal|banco)( |$)/.test(n)) return null;
  if(/(^| )(vendi|compre|recibi|me pagaron|venta|gaste)( |$)/.test(n) || (/(^| )pague( |$)/.test(n) && !/(^| )me pague( |$)/.test(n))) return null;
  if(/(^| )(lo|la|los|las) (saque|tome|pague)( |$)/.test(n)) return null;
  const fondos = ctx.fondos || [];
  if(!fondos.length) return null;
  const al = qkFondoAlias(fondos);
  const alt = al.map(a => a.k.split(' ').map(qkTl).join('\\s+')).join('|');
  const re = new RegExp(QB0 + '(de|del|desde|a|al|para|para\\s+el|para\\s+la|en|en\\s+el|en\\s+la|hacia)?\\s*(?:el\\s+|la\\s+|lo\\s+|los\\s+|mi\\s+)?(?:plata\\s+(?:del|de\\s+la|de)\\s+)?(' + alt + ')' + QB1, 'giu');
  const ments = []; let m;
  while((m = re.exec(seg))) ments.push({prep: normKey(m[1] || ''), id: (al.find(a => a.k === normKey(m[2])) || {}).id, i: m.index, len: m[0].length});
  const gan = /(^| )ganancia( |$)/.test(n) || (/(^| )me pague( |$)/.test(n) && !/(^| )(q|que) me pague( |$)/.test(n));
  // un bolsillo mencionado → es transfer, no reparto (salvo que también haya apartado y el bolsillo no sea destino/origen claro)
  const guardar = /(^| )(aparte|separe|reserve|ahorre|guarde)( |$)/.test(n);
  if(!ments.length && !gan && !guardar) return null;
  const bolsHit = (ctx.bolsillos || []).some(p => [p.nombre].concat(p.alias || []).some(a => { const k = normKey(a); return k && k.length > 3 && !/(novia|pareja|esposa|mujer|ella|amor)/.test(k) && (' ' + n + ' ').includes(' ' + k + ' '); }));
  if(bolsHit && !ments.length) return null;
  let from, to;
  ments.forEach(x => {
    if(/^(de|del|desde)$/.test(x.prep)){ if(from === undefined) from = x.id; }
    else if(x.prep){ if(to === undefined) to = x.id; }
    else if(to === undefined && /(aparte|separe|guarde|reserve|ahorre|meti|devolvi|puse|asigne)/.test(n)) to = x.id;
    else if(from === undefined) from = x.id;
  });
  if(from !== undefined && from === to) from = undefined;                       // "metí 1.5 de capital al negocio"
  if(ments.length === 1 && from !== undefined && to === undefined && /(aparte|separe|guarde|reserve|ahorre|meti|devolvi|puse|asigne)/.test(n)){ to = from; from = undefined; }
  if(gan){ if(from === undefined) from = 'negocio'; if(to === undefined) to = 'personal'; }
  if(/(^| )(saque|tome)( |$)/.test(n) && from !== undefined && to === undefined) to = 'personal';
  if(to === undefined && /(^| )ahorre( |$)/.test(n) && fondos.some(f => f.id === 'ahorro')) to = 'ahorro';
  if(from === undefined) from = to === 'personal' ? 'negocio' : 'personal';
  if(to === undefined) to = '';
  if(from === to) to = '';
  let rest = seg; ments.slice().reverse().forEach(x => { rest = rest.slice(0, x.i) + ' ' + rest.slice(x.i + x.len); });
  const amt = qkExtract(qkUnmark(rest)).monto;
  const d = {from, to};
  if(amt) d.monto = amt;
  return {kind: 'reparto', d};
}

/* ── 10. Transferencias entre bolsillos ── */
const QK_TR_OUT = /(^| )(saque|retire|retiro|sacar|retirar)( |$)/;
const QK_TR_IN = /(^| )(consigne|deposite|meti|cargue|recargue|pase|movi|transferi|consignar|meter|pasar|depositar)( |$)/;
function qkTransfer(seg, pk, bols){
  const n = normKey(seg);
  const out = QK_TR_OUT.test(n), inn = QK_TR_IN.test(n);
  const cajero = /(^| )(cajero|corresponsal|atm)( |$)/.test(n);
  const ments = pk.ments;
  const two = ments.length >= 2 && ments[0].id !== ments[1].id;
  if(!out && !(inn && (ments.length || cajero)) && !(two && /(^| )(me paso|me consigno|paso)( |$)/.test(n))) return null;
  if(!out && inn && !ments.length && !cajero) return null;
  const efe = qkEfeId(bols), neq = qkNequiId(bols);
  let from, to;
  ments.forEach(x => {
    if(/^(de|del|desde)$/.test(x.prep)){ if(from === undefined) from = x.id; }
    else if(inn && !out && x.prep === 'en' && x.id === efe && ments.some(y => y.id !== efe)){ if(from === undefined) from = x.id; }
    else if(/^(a|al|en|para|hacia)$/.test(x.prep)){ if(to === undefined) to = x.id; }
  });
  ments.forEach(x => {
    if(x.id === from || x.id === to) return;
    if(out){ if(from === undefined) from = x.id; else if(to === undefined) to = x.id; }
    else { if(to === undefined) to = x.id; else if(from === undefined) from = x.id; }
  });
  if(out){ if(from === undefined) from = to === neq ? efe : neq; if(to === undefined) to = from === efe ? neq : efe; }
  else { if(to === undefined) to = from === neq ? efe : neq; if(from === undefined) from = to === efe ? neq : efe; }
  if(from === to){ const o = bols.find(p => p.id !== from); to = o ? o.id : to; }
  const d = {from, to};
  const amt = qkExtract(qkUnmark(pk.seg)).monto;
  if(amt) d.monto = amt;
  return {kind: 'transfer', d};
}

/* ── 11. Fiado dentro de una venta: cuánto pagó de verdad ── */
function qkCredit(seg){
  let s = ' ' + seg + ' ', paid, debt, half = false;
  const flag = qkHas(seg, 'fiado|fiada|fiados|fie|fié|debiendo|me\\s+debe|me\\s+deben|que\\s+me\\s+debe|credito|el\\s+resto|lo\\s+demas|a\\s+fin\\s+de\\s+mes|en\\s+cuotas|cuotas|a\\s+pagar|quincenas|la\\s+otra\\s+semana|despues\\s+me\\s+paga|una\\s+parte');
  s = s.replace(qkRx('con\\s+(\\$?\\d+§?)\\s+de\\s+(?:cuota\\s+)?(?:inicial|entrada|adelanto|anticipo)'), (m, a) => { paid = qkExtract(qkUnmark(a)).monto || +a.replace(/\D/g, ''); return ' '; });
  s = s.replace(qkRx('(\\$?\\d+§?)\\s+que\\s+me\\s+deben?|me\\s+deben\\s+(\\$?\\d+§?)'), (m, a, b) => { const x = a || b; debt = qkExtract(qkUnmark(x)).monto || +x.replace(/\D/g, ''); return ' fiado '; });
  s = s.replace(qkRx('de\\s+(?:cuota\\s+)?inicial\\s+(\\$?\\d+§?)'), (m, a) => { paid = qkExtract(qkUnmark(a)).monto || +a.replace(/\D/g, ''); return ' fiado '; });
  s = s.replace(qkRx('(?:y\\s+|pero\\s+)?(?:(?:me|nos)\\s+(?:dio|dieron|pago|pagaron|paso|pasaron|abono|abonaron|consigno|consignaron|adelanto|dejo)|recibi|abono|abonaron|pago|consigno|me\\s+consigno)\\s+(?:solo\\s+|apenas\\s+)?(la\\s+mitad|\\$?\\d+§?)'), (m, a) => {
    if(/mitad/.test(a)) half = true; else paid = qkExtract(qkUnmark(a.startsWith('$') ? a : a)).monto || +a.replace(/\D/g, '');
    return ' ';
  });
  s = s.replace(qkRx('(?:y\\s+|pero\\s+)?(?:me\\s+)?(?:qued[oó]|queda|quedaron|quedo|quedan)\\s+debiendo\\s+(el\\s+resto|lo\\s+demas|\\$?\\d+§?)|(?:y\\s+|pero\\s+)?me\\s+debe\\s+(\\$?\\d+§?)'), (m, a, b) => {
    const x = a || b; if(!/resto|demas/.test(normKey(x))) debt = qkExtract(qkUnmark(x)).monto || +x.replace(/\D/g, '');
    return ' fiado ';
  });
  s = s.replace(qkRx('(?:y\\s+)?(?:el\\s+resto|lo\\s+demas)(?:\\s+(?:a|en|para|el|la)\\s+[^,;]*)?|a\\s+fin\\s+de\\s+mes|en\\s+cuotas|a\\s+pagar\\s+en\\s+[^,;]*|la\\s+otra\\s+semana|despues\\s+me\\s+paga'), ' fiado ');
  const credit = flag || paid != null || debt != null || half;
  if(!credit) return null;
  s = qkSp(s);
  if(!qkHas(s, 'fiado|fiada|fiados|fie|fié|debiendo|me\\s+debe|credito')) s += ' fiado';
  return {seg: s, paid, debt, half};
}

/* ── 12. Parte de pago sin valor: "me cambiaron el s23 por un 13 y me dieron 300 encima" ── */
function qkTradeInNoValue(seg){
  const re = qkRx('(?:y\\s+)?(?:(?:me\\s+|nos\\s+)?(?:dieron|dio|dejaron|dejo|entregaron|entrego|pasaron|recibi|recibiendo)|por)\\s+((?:un|una|unos|unas)\\s+(?!\\d{3,})[^,;$§\\s]+(?:\\s+(?!\\d{3,}|y\\s|me\\s|m[aá]s\\s)[^,;$§\\s]+)*?)(?=\\s+y\\s|\\s+m[aá]s\\s|\\s*[,;]|\\s+me\\s|\\s*$)', 'iu');
  const m = seg.match(re);
  if(!m) return null;
  const desc = qkSp(m[1].replace(/^(un|una|unos|unas)\s+/i, ''));
  if(guessCat(desc) === 'Otro' && !/^1[1-7]( |$)/.test(normKey(desc))) return null;
  return {rest: qkSp(seg.replace(m[0], ' ')), tradeIn: {desc, rawValor: ''}};
}

/* ── 13. Reglas aprendidas de las correcciones (§12.3) ── */
function qkApplyRules(r, seg, reglas, saidPocket){
  if(!reglas || !reglas.length) return r;
  const n = ' ' + normKey(seg) + ' ';
  const hit = reglas.filter(x => x && !x.del && x.kind === 'quick' && x.palabra && n.includes(' ' + normKey(x.palabra) + ' '))
    .sort((a, b) => normKey(b.palabra).length - normKey(a.palabra).length)[0];
  if(!hit) return r;
  const d = r.d;
  if(hit.gkind && hit.gkind !== r.kind && /^(gasto|ingreso|compra)$/.test(hit.gkind) && /^(gasto|ingreso|compra)$/.test(r.kind)){
    const monto = d.valor || d.buyPrice, pocket = d.bolsillo || d.buyPocket, fecha = d.fecha || d.buyDate, desc = d.desc;
    const nd = {};
    if(desc) nd.desc = desc;
    if(hit.gkind === 'compra'){ if(monto) nd.buyPrice = monto; if(pocket) nd.buyPocket = pocket; if(fecha) nd.buyDate = fecha; nd.cat = guessCat(desc || ''); }
    else { if(monto) nd.valor = monto; if(pocket) nd.bolsillo = pocket; if(fecha) nd.fecha = fecha; if(hit.gkind === 'gasto'){ nd.cat = guessGCat(desc || ''); nd.tipo = NEG_CATS.includes(nd.cat) ? 'negocio' : 'personal'; } }
    if(d.fondo) nd.fondo = d.fondo;
    r = {kind: hit.gkind, d: nd};
  }
  const dd = r.d;
  if(hit.cat && (r.kind === 'gasto' || r.kind === 'compra')){ dd.cat = hit.cat; if(r.kind === 'gasto' && !hit.tipo) dd.tipo = NEG_CATS.includes(hit.cat) ? 'negocio' : dd.tipo; }
  if(hit.tipo && r.kind === 'gasto') dd.tipo = hit.tipo;
  if(hit.fondo && !dd.fondo) dd.fondo = hit.fondo;
  const pf = QK_POCKET_FIELD[r.kind];
  if(hit.bolsillo && pf && !saidPocket) dd[pf] = hit.bolsillo;
  return r;
}

/* ── 14. Ajustes de sentido común después de interpretar ── */
const QK_FOOD = /(^| )(hamburguesa|pizza|perro|salchipapa|almuerzo|comida|pollo|arepa|empanada|sushi|frisby|kfc|mcdonald|cena|desayuno|helado|postre|bandeja|tinto|cafe|pan|pandebono|bunuelo)( |$)/;
const QK_NEG_CUE = /(^| )(productos|producto|paquete|paquetes|surtir|para venderlos|para venderlo|para venderla|venderlos|fotos|comprar un celular|comprar mercancia|para entregar|entregar|pedido|cliente|clientes|para vender|vender|del negocio|negocio|de la venta|para la venta|mercancia|inventario|para el local|local)( |$)/;
const QK_SELF_CUE = /(^| )(para mi|pa mi|regalo|regale|de regalo|a mi (?:novia|mama|papa|esposa|hijo|hija|hermano|hermana|pareja|amor|mujer|abuela|abuelo|tia|tio|primo|prima|sobrino|sobrina|familia|suegra|suegro))( |$)/;
const QK_SERV = /(^| )(arreglo|arreglar|reparar|reparacion|revisar|revision|limpieza|pulida|cambio|cambie|cambiarle|bateria|pantalla|vidrio|repuesto|llanta|aceite|lavada|tecnico|taller|cuota|forro|templado|entregar|envio|para venderlo|para venderla|antes de venderlo|clavaron|cobro|para la|para el)( |$)/;
function qkToVenta(r, ctx, item){
  const d = r.d, nd = {itemId: item ? item.id : ''};
  const a = d.valor || d.monto || d.total || d.buyPrice; if(a) nd.sellPrice = a;
  const pk = d.bolsillo || d.buyPocket; if(pk) nd.sellPocket = pk;
  const f = d.fecha || d.buyDate; if(f) nd.sellDate = f;
  if(d.fondo) nd.fondo = d.fondo;
  return {kind: 'venta', d: nd};
}
function qkFix(r, seg, ctx, info){
  const n0 = ' ' + normKey(info.seg0 || seg) + ' ';
  const stock = ctx.stock || [];
  // sin verbo de compra/venta pero con un producto del STOCK y plata → es una venta ("4.3 palos por el 16 pro max")
  // y "me pagaron los jordan" / "me consignaron el 13" también
  const gastoSinVerbo = r.kind === 'gasto' && !QK_GVERB.test(n0) && !/(^| )(pague|gaste|costo)( |$)/.test(n0) && guessGCat(r.d.desc || '') === 'Otro' && !QK_SERV.test(n0);
  const pagoDeProducto = (r.kind === 'ingreso' || (r.kind === 'abono' && !r.d.cobroId)) && /(^| )(me pagaron|me consignaron|me compraron|me transfirieron|me pago|me consigno)\s+(el|la|los|las)\s/.test(n0) && !QK_SERV.test(n0);
  if(gastoSinVerbo || pagoDeProducto){
    const sm = qkMatchStock(n0, stock, true);
    const amt = r.d.valor || r.d.monto;
    if(sm.item && amt) r = qkToVenta(r, ctx, sm.item);
  }
  // "pagué 4.6 millones por un iPhone 17 Pro": gasto de un producto caro = compra de mercancía
  if(r.kind === 'gasto' && r.d.desc && QK_CAROS.includes(guessCat(r.d.desc)) && guessGCat(r.d.desc) === 'Otro' && !QK_SELF_CUE.test(n0) && !/(^| )(arreglo|arreglar|reparar|revisar|para mi|cliente|cuota|plan)( |$)/.test(n0) && !QK_SERV.test(n0)){
    const g = r.d, nd = {desc: g.desc, cat: guessCat(g.desc)};
    if(g.valor) nd.buyPrice = g.valor; if(g.bolsillo) nd.buyPocket = g.bolsillo; if(g.fecha) nd.buyDate = g.fecha; if(g.fondo) nd.fondo = g.fondo;
    r = {kind: 'compra', d: nd};
  }
  // "del ahorro salió el mercado": una "venta" de algo que es un gasto
  if(r.kind === 'venta' && r.d.itemId === '__nuevo' && r.d.desc && guessCat(r.d.desc) === 'Otro' && guessGCat(r.d.desc) !== 'Otro'){
    const v = r.d, nd = {desc: v.desc, cat: guessGCat(v.desc)};
    nd.tipo = NEG_CATS.includes(nd.cat) ? 'negocio' : 'personal';
    if(v.sellPrice) nd.valor = v.sellPrice; if(v.sellPocket) nd.bolsillo = v.sellPocket; if(v.sellDate) nd.fecha = v.sellDate; if(v.fondo) nd.fondo = v.fondo;
    r = {kind: 'gasto', d: nd};
  }
  const n = n0, d = r.d;
  // compra de algo que no es mercancía ("compré mercado", "compré unos tenis pa mí") → gasto
  if(r.kind === 'compra' && d.desc){
    d.desc = qkCap(d.desc.replace(/\s+(?:a|al)\s+(?:un|una|el|la|mi|don|doña|dona|los|las)?\s*\p{L}+(?:\s+(?:de|del)\s+\p{L}+)?\s*$/u, '').trim()) || d.desc;
    if((!d.cat || d.cat === 'Otro') && /^1[1-7]( |$)/.test(normKey(d.desc))) d.cat = 'Celulares';
  }
  if(r.kind === 'compra'){
    const desc = d.desc || '';
    const pc = guessCat(desc), gc = guessGCat(desc);
    const self = QK_SELF_CUE.test(n) || /(^| )me compre( |$)/.test(n);
    if((pc === 'Otro' && gc !== 'Otro') || self){
      const nd = {};
      if(desc) nd.desc = desc;
      nd.cat = gc !== 'Otro' ? gc : 'Personal';
      if(d.buyPrice) nd.valor = d.buyPrice;
      if(d.buyPocket) nd.bolsillo = d.buyPocket;
      if(d.buyDate) nd.fecha = d.buyDate;
      nd.tipo = self ? 'personal' : (NEG_CATS.includes(nd.cat) ? 'negocio' : 'personal');
      if(d.fondo) nd.fondo = d.fondo;
      r = {kind: 'gasto', d: nd};
    }
  }
  if(r.kind === 'gasto'){
    const g = r.d, desc = g.desc || '';
    if(g.cat === 'Envíos' && QK_FOOD.test(' ' + normKey(desc) + ' ') && !QK_NEG_CUE.test(n)){ g.cat = 'Comida'; g.tipo = 'personal'; }
    if(g.cat === 'Comida' && /(^| )(rappi|domicilio|domi|llevara|llevar|mandar)( |$)/.test(n) && QK_NEG_CUE.test(n)){ g.cat = 'Envíos'; g.tipo = 'negocio'; }
    if(!info.tipoDicho){
      const sm = qkMatchStock(n.replace(/(^| )(moto|carro|celular|cel|telefono|tenis|portatil|computador|consola|reloj)( |$)/g, ' '), ctx.stock || []); const prod = /(^| )(del|el|al|la)\s+1[1-7]( |$)/.test(n) || !!sm.item || sm.cands.length > 0;
      if(QK_NEG_CUE.test(n) || (prod && /^(Mantenimiento|Envíos|Transporte|Otro|Empaques|Publicidad)$/.test(g.cat || 'Otro'))) g.tipo = 'negocio';
      if(QK_SELF_CUE.test(n) && !/(^| )(cliente|clientes|pedido)( |$)/.test(n)) g.tipo = 'personal';
      if(g.fondo === 'negocio' && !QK_SELF_CUE.test(n)) g.tipo = 'negocio';
      if(g.cat === 'Otro' && prod && g.tipo === 'negocio') g.cat = 'Mantenimiento';
    }
  }
  // venta: producto contra el stock con apodos y ambigüedad
  if(r.kind === 'venta' && d.itemId !== '__prev'){
    const q = info.ventaQ != null ? info.ventaQ : n;
    const m = qkMatchStock(q, ctx.stock || []);
    const indef = /(^| )(vendi|venta)\s+(un|una|unos|unas)\s/.test(n);
    const voc = new Set(normKey((ctx.stock || []).map(x => x.desc).join(' ')).split(' '));
    const extra = normKey(q).split(' ').filter(w => w.length > 3 && !QK_NOISE.has(w) && !voc.has(w) && !QK_SYN[w] && !/^\d/.test(w) && guessCat(w) !== 'Otro');
    if(m.item && indef && extra.length){ d.itemId = '__nuevo'; d.desc = qkCap(qkSp(normKey(q).split(' ').filter(w => !QK_NOISE.has(w) && !/^\d{4,}/.test(w)).join(' '))); d.cat = guessCat(d.desc); }
    else if(m.item){ d.itemId = m.item.id; delete d.desc; delete d.cat; }
    else if(m.amb){ d.itemId = ''; delete d.desc; delete d.cat; }
    else if(d.itemId && d.itemId !== '__nuevo' && !m.cands.length && d.desc == null){
      // bestMatch del motor encontró algo que el emparejador estricto no confirma → mejor que el usuario elija
      const it = (ctx.stock || []).find(x => x.id === d.itemId);
      if(it && !qkMatchStock(normKey(it.desc), ctx.stock).item) d.itemId = '';
    }
  }
  return r;
}


/* parseQuickMulti(texto, ctx) → [{kind, d}, …]   (§11 + §12 + §13)
   ctx = {bolsillos:[{id,nombre,alias}], fondos:[{id,nombre,alias}], stock:[{id,desc,cat}], cobros:[{id,nombre}], reglas:[…]} */
const QK_COLORES = 'negro|negra|blanco|blanca|azul|rojo|roja|verde|morado|morada|lila|rosado|rosada|dorado|dorada|plateado|plateada|gris|grafito|titanio|natural|amarillo|amarilla|naranja|beige|crema|cafe|purpura|medianoche|blue|black|white|gold|silver';
function qkEquipo(t){
  const eq = {};
  t = t.replace(qkRx('(?:con\\s+)?(?:la\\s+)?bater[ií]a\\s+(?:al|en|de|del)?\\s*(\\d{2,3})\\s*%?|(?:con\\s+)?(?:el\\s+)?(\\d{2,3})\\s*%\\s*(?:de\\s+)?(?:bater[ií]a|pila|salud)?|(?:con\\s+)?(\\d{2,3})\\s+de\\s+(?:bater[ií]a|pila|salud)'), (m, a, b, c) => {
    const v = +(a || b || c); if(v > 100 || v < 30) return m; eq.bateria = v; return ' '; });
  t = t.replace(qkRx('(?:de\\s+)?(64|128|256|512|1024|1)\\s*(gb|gigas|g|tb|teras?)'), (m, a, u) => { eq.almac = a + (/^t/i.test(u) ? 'TB' : 'GB'); return ' '; });
  if(!eq.almac) t = t.replace(qkRx('de\\s+(64|128|256|512)(?!\\s*(?:mil|k|lucas|barras))'), (m, a) => { eq.almac = a + 'GB'; return ' '; });
  t = t.replace(qkRx('imei\\s*:?\\s*(\\d{14,16})'), (m, a) => { eq.imei = a; return ' '; });
  const c = t.match(qkRx('(?:color\\s+)?(' + QK_COLORES + ')', 'iu'));
  if(c) eq.color = c[1].toLowerCase();
  return {t: qkSp(t), eq};
}
const QK_GENERIC_P = /^(man|pelao|pelado|senor|señor|senora|señora|cliente|amigo|amiga|muchacho|muchacha|tipo|chino|chica|chico|vecino|vecina|parcero|loco|socio)$/;
const QK_NOT_NAME = /^(nequi|efectivo|credito|cuotas|plazo|fin|pagar|consignar|transferencia|la|el|los|las|un|una|mitad|resto|nequi|cajero|precio|buen|mi)$/;
function qkPersona(seg0, kind){
  // venta: "a mateo", "al mono", "a la vecina"; compra: "a un man de bello", "a la vecina", "de un cliente"
  const re = kind === 'compra' ? /(?:^|\s)(?:a|al|de)\s+(?:(un|una|el|la|don|doña|dona|mi)\s+)?(\p{L}{3,})(?:\s+(?:de|del)\s+(\p{L}{3,}))?/u : /(?:^|\s)(?:a|al)\s+(?:(la|el|don|doña|dona|mi)\s+)?(\p{L}{3,})(?:\s+(\p{L}{3,}))?/u;
  const m = seg0.match(re);
  if(!m) return '';
  const w = normKey(m[2]);
  if(QK_NOT_NAME.test(w) || guessCat(m[2]) !== 'Otro' || /^\d/.test(w)) return '';
  if(QK_GENERIC_P.test(w)) return kind === 'compra' ? qkSp((m[2] + (m[3] ? ' de ' + m[3] : ''))) : '';
  const extra = m[3] && !QK_NOT_NAME.test(normKey(m[3])) && /^\p{Lu}/u.test(m[3]) ? ' ' + m[3] : '';
  return qkName((/^(don|doña|dona)$/i.test(m[1] || '') ? m[1] + ' ' : '') + m[2] + extra);
}

function parseQuickMulti(texto, ctx){
  ctx = ctx || {};
  const bols = ctx.bolsillos || [];
  let t = qkClean(texto);
  const EQ = qkEquipo(t); t = EQ.t;
  t = qkCanon(t);
  t = qkNumWords(t);
  t = qkUnits(t);
  t = qkUnmark(qkScaleText(t, ctx));
  if(!t) return [parseQuick('', ctx)];
  const segs = qkSegments(t, ctx);
  const out = [], said = [];
  let prev = null, lastFecha;               // última compra de la frase
  segs.forEach((seg0, si) => {
    let seg = seg0, pron = false, ti = null, qty = 0;
    const info = {seg0};
    if(QK_PRON.test(seg)){ pron = true; seg = seg.replace(QK_PRON, ''); }
    const dt = qkDate(seg); seg = dt.seg;
    if(dt.fecha) lastFecha = dt.fecha; else if(lastFecha) dt.fecha = lastFecha;
    const push = (r, pocketSaid) => { out.push(r); said.push(!!pocketSaid); if(r.kind === 'compra') prev = r; };
    // reparto entre apartados
    const rep = qkReparto(seg, ctx);
    if(rep){ if(dt.fecha) rep.d.fecha = dt.fecha; push(rep); return; }
    // bolsillos y transferencias
    const pk = qkPockets(seg, bols);
    const tr = qkTransfer(seg, pk, bols);
    if(tr){ if(dt.fecha) tr.d.fecha = dt.fecha; push(tr, true); return; }
    seg = pk.seg;
    const digital = qkHas(seg0, 'consign\\p{L}*|transf\\p{L}*|gir[oó]|giraron|me\\s+hizo\\s+un\\s+nequi');
    seg = qkSp(seg.replace(qkRx('(?:por\\s+|con\\s+)?transferencia'), ' '));
    // apartado ("con la plata del ahorro")
    const fo = qkFondo(seg, ctx.fondos); seg = fo.seg;
    info.tipoDicho = /(^| )(negocio|personal)( |$)/.test(normKey(seg));
    if(QK_CU.test(seg)){ seg = seg.replace(QK_CU, '$1').replace(/\s+/g, ' ').trim(); qty = qkQty(seg); }
    let cr = null;
    if(!qkHasVenta(seg) && !pron && qkHas(seg, 'fie|fié|fiado|fiada|fiados|le\\s+deje|sacaron|se\\s+llevo')){
      const sm = qkMatchStock(seg, ctx.stock || []);
      if(sm.item || sm.amb || QK_CAROS.concat(['Calzado', 'Ropa', 'Accesorios']).includes(guessCat(seg))) seg = 'vendí ' + seg.replace(qkRx('le\\s+deje|sacaron|se\\s+llevo'), ' ');
    }
    if(qkHasVenta(seg) || pron){
      const tt = qkTradeIn(seg);
      if(tt.tradeIn){ ti = tt.tradeIn; seg = tt.rest; }
      else { const t2 = qkTradeInNoValue(seg); if(t2){ ti = t2.tradeIn; seg = t2.rest; } }
      cr = qkCredit(seg); if(cr) seg = cr.seg;
      // "me dio 1M" dentro de una venta es la forma de pago, no un abono
      seg = seg.replace(/(^|\s)(?:y\s+)?me\s+(?:dio|dieron|dej[oó]|dejaron|pag[oó]|pagaron|consign[oó]|consignaron|pas[oó]|pasaron|transfiri[oó]|transfirieron)(?:\s+la\s+plata)?(?=\s|$)/giu, '$1').replace(/\s+/g, ' ').trim();
      seg = seg.replace(qkRx('encima|de\\s+contado|de\\s+una'), ' ').replace(/\s+/g, ' ').trim();
      info.ventaQ = seg;
    }
    let r = parseQuick(seg, ctx);
    const pv = r.kind === 'compra' || r.kind === 'venta';
    const cat = [pv && r.d.cat, qkClauseCat(seg, ctx, prev && prev.d.cat), ti && guessCat(ti.desc), prev && (pron || r.kind === 'venta') && prev.d.cat].find(c => c && c !== 'Otro') || 'Otro';
    const caro = QK_CAROS.includes(cat);
    const d = r.d;
    if(r.kind === 'venta'){
      const sameAsPrev = prev && (pron || !d.itemId || (d.itemId === '__nuevo' && d.desc && bestMatch(d.desc, [prev.d], x => x.desc)));
      if(sameAsPrev){ d.itemId = '__prev'; d.desc = prev.d.desc; d.cat = prev.d.cat; }
      else if(d.itemId === '__nuevo' && caro && (!d.cat || d.cat === 'Otro')) d.cat = cat;
      if(ti){
        const tcat = guessCat(ti.desc) !== 'Otro' ? guessCat(ti.desc) : (QK_CAROS.includes(cat) ? cat : 'Otro');
        const tv = ti.rawValor ? qkAmount(ti.rawValor, QK_CAROS.includes(tcat) || caro) : 0;
        d.tradeIn = {desc: qkModel(qkPretty(ti.desc)), cat: tcat};
        if(tv) d.tradeIn.valor = tv;
        const pl = seg0.match(/(\d{4,})§?\s+(?:en|de)\s+(?:plata|efectivo|cash|billete|billetes|nequi)/i);   // "… y 2.8 en plata": la plata es el precio
        if(pl) d.sellPrice = +pl[1];
      }
    } else if(r.kind === 'compra' && d.desc && (!d.cat || d.cat === 'Otro') && cat !== 'Otro') d.cat = cat;
    if(r.kind === 'compra' && d.desc) d.desc = qkCap(d.desc.replace(/^(?:otro|otra|otros|otras)\s+/i, '').replace(/^(?:igual|iguales|mismo|misma|parecido|parecida)(?:\s+|$)/i, '').trim());
    if(r.kind === 'compra' && prev && (!d.desc || /^(otro|otra|uno|una|igual|mismo)$/i.test(d.desc)) && /(^| )(otro|otra|otros|otras)( |$)/.test(normKey(seg0))){ d.desc = prev.d.desc; d.cat = prev.d.cat; }
    if(r.kind === 'compra' && d.desc) d.desc = qkCap(d.desc.replace(/\s+(?:uno|una)$/i, '').replace(/^(?:\d{1,2})\s+(?=\p{L})/u, m => m)) || d.desc;
    if(qty){
      const f = {compra: 'buyPrice', venta: 'sellPrice', gasto: 'valor', ingreso: 'valor'}[r.kind];
      if(f && d[f]){ const u = d[f]; d[f] = u * qty; d.notes = qty + ' × $' + String(u).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' c/u'; }
    }
    r = qkFix(r, seg, ctx, info);
    const D = r.d;
    // fiado: cuánto pagó de verdad
    if(r.kind === 'venta' && cr && !D.sellPrice && cr.paid && !cr.debt && !qkHas(seg0, 'fiado|fiada|fie|fié|debiendo|debe|credito|resto|cuotas|parte')){ D.sellPrice = cr.paid; cr = null; }
    if(r.kind === 'venta' && cr){
      const total = D.sellPrice || 0;
      D.completo = 'no';
      if(cr.half && total) D.sellPaid = Math.round(total / 2);
      else if(cr.paid != null) D.sellPaid = cr.paid;
      else if(cr.debt != null && total) D.sellPaid = Math.max(0, total - cr.debt);
      else D.sellPaid = 0;
      if(D.sellPaid >= total && total) { delete D.completo; delete D.sellPaid; }
    }
    // bolsillo dicho (alias) o deducido ("me consignó" → Nequi)
    const pf = r.kind === 'cobro' ? 'bolsillo' : QK_POCKET_FIELD[r.kind];
    const m0 = pk.ments.find(x => x.role === 'payer') || pk.ments[0];
    if(pf && m0) D[pf] = m0.id;
    else if(pf && digital && /^(venta|abono|ingreso|cobro)$/.test(r.kind)) D[pf] = qkNequiId(bols);
    else if(pf && qkHas(seg0, 'transferencia|transferi|por\\s+nequi')) D[pf] = qkNequiId(bols);
    if(fo.fondo && r.kind !== 'transfer') D.fondo = fo.fondo;
    if(dt.fecha){ const ff = {compra: 'buyDate', venta: 'sellDate'}[r.kind] || 'fecha'; D[ff] = dt.fecha; }
    if(r.kind === 'gasto' && !D.valor && out.length && /(^| )(eso|todo|esa plata)( |$)/.test(normKey(seg0))){
      const pv = out[out.length - 1].d; const a = pv.valor || pv.sellPrice || pv.monto || pv.total || pv.buyPrice; if(a) D.valor = a;
      if(D.desc) D.desc = qkCap(D.desc.replace(/^eso\s*/i, '')) || D.desc;
    }
    // "por fin cayó cliente pal pro max, se lo llevó en 4.4": el producto estaba en el segmento anterior
    if(r.kind === 'venta' && pron && !prev && (!D.itemId || D.itemId === '__prev' || D.itemId === '__nuevo') && si > 0){
      const sm = qkMatchStock(segs[si - 1], ctx.stock || []);
      if(sm.item){ D.itemId = sm.item.id; delete D.desc; delete D.cat; const lo = out[out.length - 1];
        if(lo && !(lo.d.valor || lo.d.buyPrice || lo.d.sellPrice || lo.d.monto || lo.d.total)){ out.pop(); said.pop(); } }
    }
    if(r.kind === 'compra'){
      Object.keys(EQ.eq).forEach(k => { if(D[k] == null) D[k] = EQ.eq[k]; });
      const pv = qkPersona(seg0, 'compra'); if(pv && !D.proveedor) D.proveedor = qkCap(pv);
      if(D.desc){ // la descripción no repite al vendedor ni el color
        let ds = ' ' + D.desc + ' ';
        if(D.proveedor) normKey(D.proveedor).split(' ').forEach(w => { if(w.length > 2) ds = ds.replace(new RegExp('\\s' + w + '(?=\\s)', 'iu'), ' '); });
        ds = ds.replace(qkRx('(?:color\\s+)?(?:' + QK_COLORES + ')'), ' ').replace(/\s(?:a|al|de|del|un|una|don|doña)(?=\s*$)/iu, ' ');
        D.desc = qkCap(qkSp(ds)) || D.desc;
      }
    }
    if(r.kind === 'venta' && !D.cliente){ const cl = qkPersona(seg0, 'venta'); if(cl) D.cliente = cl; }
    if(r.kind === 'gasto' && !D.itemId){
      const sm = qkMatchStock(normKey(seg0).replace(/(^| )(moto|carro|celular|cel|telefono|tenis|portatil|computador|consola|reloj)(?= |$)/g, ' '), ctx.stock || [], true);
      if(sm.item && (D.tipo === 'negocio' || /^(Envíos|Empaques|Comisiones|Publicidad)$/.test(D.cat || ''))){ D.itemId = sm.item.id; D.tipo = 'negocio'; }
    }
    r = qkApplyRules(r, seg0, ctx.reglas, !!m0);
    push(r, !!m0);
  });
  if(!out.length) return [parseQuick(texto, ctx)];
  const AMT = r => r.d.valor || r.d.monto || r.d.total || r.d.buyPrice || r.d.sellPrice;
  for(let i = out.length - 1; i >= 1; i--){
    const a = out[i - 1], b = out[i];
    const trivial = !b.d.desc || /^(yo|eso|todo|plata|la plata)$/i.test(b.d.desc || '');
    // "fui a comer con mi esposa y pagué yo, 70 mil": el monto va con lo anterior
    if(!AMT(a) && AMT(b) && trivial && b.kind === a.kind && (a.kind === 'gasto' || a.kind === 'ingreso')){ a.d.valor = AMT(b); const pf = QK_POCKET_FIELD[a.kind]; if(pf && b.d[pf] && !a.d[pf]) a.d[pf] = b.d[pf]; out.splice(i, 1); said.splice(i, 1); continue; }
    // "…, me consignaron": un segmento sin monto ni descripción solo aporta el bolsillo
    if(!AMT(b) && trivial && b.kind !== 'reparto' && b.kind !== 'transfer' && AMT(a)){
      const pa = QK_POCKET_FIELD[a.kind] || (a.kind === 'cobro' ? 'bolsillo' : ''), pb = QK_POCKET_FIELD[b.kind] || 'bolsillo';
      if(pa && b.d[pb] && !a.d[pa]) a.d[pa] = b.d[pb];
      out.splice(i, 1); said.splice(i, 1); continue;
    }
    if(!AMT(a) && (!a.d.desc || a.d.desc.length < 2) && AMT(b) && i === 1){
      const pa = QK_POCKET_FIELD[a.kind] || 'bolsillo', pb = QK_POCKET_FIELD[b.kind] || (b.kind === 'cobro' ? 'bolsillo' : '');
      if(pb && a.d[pa] && !b.d[pb]) b.d[pb] = a.d[pa];
      if(a.d.fondo && !b.d.fondo) b.d.fondo = a.d.fondo;
      out.splice(0, 1); said.splice(0, 1); continue;
    }
    // "vendí el s23 en 1.5 en efectivo y lo consigné en nequi": el transfer hereda el monto
    if(b.kind === 'transfer' && !b.d.monto && AMT(a)) b.d.monto = AMT(a);
  }
  out.forEach(r => { if(r.d.desc) r.d.desc = qkSp(r.d.desc.replace(/\u2060/g, '')); if(r.d.tradeIn && r.d.tradeIn.desc) r.d.tradeIn.desc = qkSp(r.d.tradeIn.desc.replace(/\u2060/g, '')); });
  if(out.length > 1){
    // el bolsillo dicho al final vale para los segmentos que no dijeron el suyo (solo listas sin verbo del mismo tipo)
    const last = out[out.length - 1], lf = QK_POCKET_FIELD[last.kind];
    if(lf && said[out.length - 1] && last.d[lf]) out.forEach((r, i) => {
      const f = QK_POCKET_FIELD[r.kind];
      if(f && r.d[f] === undefined && r.kind === last.kind && !qkHasVerb(segs[i] || '')) r.d[f] = last.d[lf];
    });
  }
  if(out.length > 1 && /(^| )(todo|todos|todas|ambos|ambas|los dos|las dos)( |$)/.test(normKey(segs[segs.length - 1] || ''))){
    const last = out[out.length - 1], lf = QK_POCKET_FIELD[last.kind] || (last.kind === 'cobro' ? 'bolsillo' : '');
    out.forEach(r => {
      const f = QK_POCKET_FIELD[r.kind] || (r.kind === 'cobro' ? 'bolsillo' : '');
      if(lf && said[out.length - 1] && f && r.d[f] === undefined) r.d[f] = last.d[lf];
      if(last.d.fondo && r.kind !== 'transfer' && r.kind !== 'reparto' && !r.d.fondo) r.d.fondo = last.d.fondo;
    });
  }
  if(out.length > 1 || out.some(r => r.d.tradeIn)) out.forEach(r => { if(r.d.desc && (r.kind === 'compra' || r.kind === 'venta')) r.d.desc = qkModel(qkPretty(r.d.desc)); });
  out.forEach((r, i) => { if(r.kind === 'venta' && r.d.itemId === '__prev'){ const c = out.slice(0, i).reverse().find(x => x.kind === 'compra'); if(c) r.d.desc = c.d.desc; } });
  return out;
}

if(typeof module !== 'undefined') module.exports = {parseQuick, parseQuickMulti, CATS, GCATS, NEG_CATS, guessCat, guessGCat, normKey, bestMatch, qkMatchStock, qkClean};
