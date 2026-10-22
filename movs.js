/* ═══════════════════════════════════════════════
   movs.js — pantallazo de movimientos (Nequi, Bancolombia, Daviplata…) → lista de gastos y entradas
   · parseMovimientos(texto, {hoy}) es PURO: del texto leído por OCR saca {fecha, desc, quien, monto, dir}.
   · clasificarMovs(db, movs, {bolsillo}) decide qué es cada uno (gasto con categoría, abono, ingreso,
     por clasificar) y marca los que ya están registrados para no duplicarlos.
   Depende de core.js (L, cobrosPend, shiftDate, daysBetween) y quick.js (guessGCat, NEG_CATS, normKey).
═══════════════════════════════════════════════ */

const MV_MESES = {ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12};
const mvNorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const mvPad = n => String(n).padStart(2, '0');
function mvShift(f, d){ const x = new Date(f + 'T12:00:00'); x.setDate(x.getDate() + d); return x.getFullYear() + '-' + mvPad(x.getMonth() + 1) + '-' + mvPad(x.getDate()); }
function mvDias(a, b){ return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5); }

/* Fecha dentro de una línea: "Hoy", "Ayer", "16 de octubre de 2026", "16 oct", "Oct 16, 2026", "16/10/2026", "2026-10-16" */
function mvFecha(linea, hoy){
  const t = mvNorm(linea);
  if(/\bhoy\b|\btoday\b/.test(t)) return hoy;
  if(/\bayer\b|\byesterday\b/.test(t)) return mvShift(hoy, -1);
  if(/\bantier\b|\banteayer\b/.test(t)) return mvShift(hoy, -2);
  const yH = +hoy.slice(0, 4);
  const arma = (d, m, y) => {
    if(!(d >= 1 && d <= 31 && m >= 1 && m <= 12)) return null;
    let yy = y ? (+y < 100 ? 2000 + +y : +y) : yH;
    let f = yy + '-' + mvPad(m) + '-' + mvPad(d);
    if(!y && f > hoy) f = (yH - 1) + f.slice(4);   // "28 dic" leído en enero = del año pasado
    return f;
  };
  let m = t.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/);
  if(m) return arma(+m[3], +m[2], m[1]);
  m = t.match(/\b(\d{1,2})\s*(?:de\s+)?(ene|feb|mar|abr|apr|may|jun|jul|ago|aug|sep|set|oct|nov|dic|dec)[a-z]*\.?(?:\s*(?:de|del|,)?\s*(20\d\d|\d\d)\b)?/);
  if(m) return arma(+m[1], MV_MESES[m[2]], m[3] && (m[3].length === 4 || +m[3] > 12) ? m[3] : null);
  m = t.match(/\b(ene|feb|mar|abr|apr|may|jun|jul|ago|aug|sep|set|oct|nov|dic|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s*(20\d\d))?\b/);
  if(m) return arma(+m[2], MV_MESES[m[1]], m[3]);
  m = t.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d\d|\d\d)\b/);
  if(m) return arma(+m[1], +m[2], m[3]);
  return null;
}

/* Monto con signo: "-$ 45.000,00", "+ $1.600.000", "$45,000.00", "-S 12.500" (OCR lee $ como S) */
const MV_MONTO = /([+\-−–]\s*)?(?:\$|S(?=\s?\d)|COP\s?)\s*(\d{1,3}(?:[.,' ]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?!\d)/i;
const MV_MONTO_SIN = /([+\-−–]\s*)?(\d{1,3}(?:\.\d{3})+,\d{2})(?!\d)/;   // "45.000,00" sin $ (formato de banco)
function mvNum(s){
  s = String(s).replace(/[ ']/g, '');
  if(/[.,]\d{1,2}$/.test(s)) s = s.replace(/[.,]\d{1,2}$/, '');   // los miles van de a 3 cifras: ",00" / ".5" al final son centavos
  return +s.replace(/\D/g, '') || 0;
}

const MV_SALDO = /\b(saldo|disponible|total|colchon|bolsillo|meta|cupo|deuda|tarjeta de credito|limite)\b/;
const MV_IN = /^(de\s|desde\s|recib|te\s+(envi|pag|lleg|consign)|recarga\s+(desde|de\s+(bancolombia|banco|davivienda|daviplata|nequi|cuenta))|consignaci|deposito|abono\b|devoluci|reembolso|reverso|intereses|rendimient|ingreso|entrada|transferencia\s+(de|recibida|entrante)|lleg|pago\s+recibido|cobro\s+recibido|reintegro|bre-?b\s+recib)/;
const MV_OUT = /^(para\s|a\s|envi|enviaste|pag|compra|retiro|retiraste|transferencia\s+(a|enviada|saliente)|transf\s|recarga\s+(a\s|celular|de celular|claro|tigo|movistar|wom)|cobro\b|debito|cuota|comision|4\s?x\s?1000|gmf|impuesto|saliste|pse|avance|domiciliaci)/;
const MV_PREF = /^(?:envio\s+(?:a|de)|enviaste\s+a|te\s+envio|recibiste\s+de|recibi\s+de|transferencia\s+(?:a|de|enviada\s+a|recibida\s+de)|transf\.?\s+(?:a|de)|pago\s+(?:en|a|de|por)|pagaste\s+(?:en|a)|compra\s+(?:en|a)|compraste\s+en|recarga\s+(?:desde|de|a)|retiro\s+(?:en|de)|para|de|desde|a|en)\s+/;

function mvEsRuido(t){
  // horas, referencias, encabezados de la pantalla, botones
  if(/^\d{1,2}:\d{2}\s*(a\.?\s?m\.?|p\.?\s?m\.?)?$/.test(t)) return true;
  if(/^(movimientos|historial|tus movimientos|ultimos movimientos|ver mas|ver todo|filtrar|buscar|inicio|servicios|mas|transacciones|detalle|actividad|extractos?|cuenta de ahorros|ahorros|nequi|bancolombia|daviplata|ref(erencia)?\.?\s*\S*|comprobante.*|aprobad[ao]|exitos[ao]|en proceso)$/.test(t)) return true;
  if(!/[a-z]{2}/.test(t)) return true;
  return false;
}
/* El OCR lee la foto redonda del contacto como "O)", "0)", "©", "@"… delante del nombre */
const mvSinBasura = s => String(s || '').replace(/^\s*[^\p{L}\p{N}\s]{0,2}\s*[OoQ0@©®eéc]?\s*[)\]}>|:.]\s+(?=\p{L})/u, '').replace(/^\s*[@©®°•·*]\s*(?=\p{L})/u, '').trim();
/* Comercios colombianos comunes → categoría (antes que la adivinanza general) */
/* ═══ Comercios de Colombia/Medellín → categoría, para anotar los gastos SOLOS (sin preguntar) ═══
   Cada entrada: [categoría, palabras (texto normalizado: minúsculas, sin tildes, solo letras/números), nombre bonito opcional, monto máximo opcional].
   Va en orden: lo más específico primero. Las palabras se buscan como palabras completas. */
const COMERCIOS = [
  // Gasolina, parqueaderos, peajes, transporte
  ['Transporte', 'eds|distracom|estacion de servicio|estacion servicio|terpel|primax|biomax|texaco|mobil|esso|zeuss|petromil|brio|puma energy|gulf|gasolinera|combustible|octanaje'],
  ['Transporte', 'parqueadero|parqueaderos|parking|city parking|parkeo|parqueo|zona azul'],
  ['Transporte', 'peaje|peajes|devimed|tunel de oriente|autopistas|concesion|flypass'],
  ['Transporte', 'uber|didi|indrive|indriver|cabify|picap|bolt|beat|taxi|taxis libres|civica|metro de medellin|metroplus|encicla|transmilenio|terminal de transporte|avianca|latam|viva air|wingo|clic air|satena'],
  // Domicilios y comida
  ['Comida', 'rappi|ifood|didi food|domicilios com|mercadoni|merqueo|turbo', null, null],
  ['Comida', 'mcdonalds|mc donalds|mcdonald s|kfc|frisby|el corral|corral|burger king|subway|dominos|domino s|papa johns|pizza hut|jenos|jeno s|presto|crepes|crepes waffles|wok|sr wok|archies|kokoriko|la brasa roja|qbano|sandwich qbano|buffalo wings|hooters|el rodeo|dlk|tacos|taco bell|chipotle|popeyes|wendys|wendy s|carls jr|frisby|hamburguesas|el pirata|la cosecha|mondongos|hatsu|sushi|pizza|pizzeria|restaurante|rest |asadero|cafeteria|comidas rapidas|perros|salchipapa'],
  ['Comida', 'starbucks|juan valdez|tostao|oma|dunkin|krispy kreme|pan pa ya|panaderia|pasteleria|reposteria|helados|popsy|mimos|crepes|cafe|coffee|la ricura|cheesecake|postres|dulceria'],
  ['Comida', 'd1|tiendas d1|ara|jeronimo martins|exito|almacenes exito|carulla|jumbo|olimpica|makro|pricesmart|euro supermercados|la vaquita|consumo|colsubsidio mercado|isimo|surtimax|super inter|superinter|oxxo|justo y bueno|mercamas|merkepaisa|supermercado|minimercado|autoservicio|fruver|carniceria|tienda'],
  // Salud y cuidado personal
  ['Personal', 'farmatodo|cruz verde|drogueria|droguerias|drogas|farmacia|farm|la rebaja|pasteur|locatel|colsubsidio drogueria|alemana|farmacenter|optica|opticas|odontologia|laboratorio|clinica|hospital'],
  ['Personal', 'barberia|barber|peluqueria|spa|unas|nails|smart fit|smartfit|bodytech|spinning|gimnasio|gym'],
  // Ropa, tiendas, tecnología, hogar
  ['Personal', 'falabella|arturo calle|koaj|studio f|zara|h m|pull and bear|pull bear|bershka|stradivarius|mango|tennis|velez|totto|adidas|nike|new balance|gef|punto blanco|offcorss|americanino|chevignon|diesel|levis|levi s|quest|seven seven|ela|patprimo|mattelsa|bosi|spring step|payless|aldo|skechers|crocs|under armour|lacoste|tommy|polo'],
  ['Personal', 'miniso|flying tiger|dollarcity|dolarcity|homecenter|home center|ikea|panamericana|alkosto|ktronix|tecnoplaza|jumbo home|easy|ferreteria|tauro|mercado libre|mercadolibre|amazon|temu|shein|aliexpress'],
  // Suscripciones y entretenimiento
  ['Entretenimiento', 'netflix|spotify|disney|hbo|max com|prime video|amazon prime|youtube|google play|apple com|itunes|steam|playstation|xbox|nintendo|crunchyroll|paramount|star plus|deezer|twitch|cine colombia|cinecolombia|cinemark|procinal|royal films|tuboleta|tu boleta|eticket|ticketmaster|bar|discoteca|licorera|cerveceria|estanco|billar|bolos|parque|museo'],
  // Servicios del hogar, celular, seguros
  ['Servicios', 'epm|une|claro|tigo|movistar|wom|etb|emvarias|empresas publicas|aguas|acueducto|gas natural|vanti|efigas|enel|celsia|codensa|air e|soat|sura|seguros|allianz|bolivar|mapfre|colpatria seguros|arriendo|administracion|openai|chatgpt|anthropic|claude ai|microsoft|office|google one|google storage|icloud|dropbox|canva|adobe|notion'],
  // Del negocio
  ['Envíos', 'servientrega|interrapidisimo|inter rapidisimo|coordinadora|envia|tcc|deprisa|472|mensajeros urbanos|picap envios|domicilio envio'],
  ['Comisiones', '4x1000|4 x 1000|gmf|cuota de manejo|comision|comisiones|iva comision'],
  ['Publicidad', 'facebook ads|facebk|meta ads|meta platforms|instagram ads|tiktok ads|google ads']
];
/* Centros comerciales: monto pequeño = parqueadero; si no, compras */
const CC_RE = /(^| )(centro comercial|c ?c|mall|plaza|premium plaza|santafe|santa fe|oviedo|el tesoro|tesoro|viva envigado|viva|unicentro|mayorca|los molinos|molinos|arkadia|florida|puerta del norte|fabricato|aventura|san diego|monterrey|el diamante|camino real|la strada|city plaza|vizcaya|parque la colina|nuestro bogota|andino|gran estacion|titan plaza|el retiro|santafe medellin)( |$)/;
const COMERCIO_RE = COMERCIOS.map(([cat, palabras, nombre, max]) => ({cat, re: new RegExp('(^| )(' + palabras + ')( |$)'), nombre: nombre || null, max: max || null}));
const mvNormCom = t => ' ' + mvNorm(t).replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';

/* "RAPPI COLOMBIA*DL" → "Rappi" · "FRISBY Q58" → "Frisby" · "GOOGLE *PLAY YOUTUBE*D" → "YouTube (Google Play)" */
function nombreComercio(raw){
  let s = String(raw || '').replace(/\s+a\s+tu\s+(tarjeta|cuenta).*$/i, '').trim();
  const n = mvNorm(s);
  if(/youtube/.test(n)) return 'YouTube (Google Play)';
  if(/google \*?play|google play/.test(n)) return 'Google Play';
  if(/^rappi/.test(n)) return 'Rappi';
  if(/^(didi|uber|netflix|spotify|disney|starbucks|frisby|kfc)/.test(n)) s = s.split(/[\s*]/)[0];
  if(/^farm\b/.test(n)) s = s.replace(/^farm\b/i, 'Farmacia');
  if(/^(eds)\b/.test(n)) s = s.replace(/^eds\b/i, 'EDS');
  if(/centro comercial/.test(n)) s = s.replace(/centro comercial/i, 'C.C.');
  s = s.replace(/\*.*$/, '')                                  // códigos de la pasarela: "*DL", "*D"
       .replace(/\.(com|co|net)\b/gi, '')
       .replace(/\b(colombia|col|sas|s a s|ltda|s a|bog|med|mde)\b\.?/gi, '')
       .replace(/\s+/g, ' ').trim()
       .split(' ').filter((w, i) => i === 0 || !/^[A-Za-z]\d{1,4}$/.test(w)).join(' ');   // código de sede "Q58" (no el "D1" del comienzo)
  if(/c\.c\. los moli$/i.test(s)) s = 'C.C. Los Molinos';
  return mvTitulo(s || String(raw || '').trim()).replace(/\bC\.c\./, 'C.C.').replace(/\bEds\b/, 'EDS');
}

/* ¿Es un comercio conocido? → {cat, nombre, tipo} o null (null = la app pregunta) */
function comercioInfo(raw, monto){
  const t = mvNormCom(raw);
  if(!t.trim()) return null;
  const negs = typeof NEG_CATS !== 'undefined' ? NEG_CATS : ['Envíos', 'Empaques', 'Comisiones', 'Publicidad'];
  for(const c of COMERCIO_RE){
    if(c.max && monto > c.max) continue;
    if(c.re.test(t)) return {cat: c.cat, nombre: c.nombre || nombreComercio(raw), tipo: negs.includes(c.cat) ? 'negocio' : 'personal'};
  }
  if(CC_RE.test(t)){
    const nom = nombreComercio(raw);
    return +monto <= 15000 ? {cat: 'Transporte', nombre: 'Parqueadero ' + nom, tipo: 'personal'} : {cat: 'Personal', nombre: nom, tipo: 'personal'};
  }
  return null;
}
/* compatibilidad con lo anterior */
function mvComercio(t, monto){ const x = comercioInfo(t, monto || 0); return x ? x.cat : ''; }

/* patrones para el teléfono (Android los usa para anotar al instante, sin abrir la app) */
function patronesComercio(){
  return COMERCIOS.map(([cat, palabras, nombre, max]) => ({cat, re: '(^| )(' + palabras + ')( |$)', nombre: nombre || '', max: max || 0}))
    .concat([{cat: 'Transporte', re: CC_RE.source, nombre: '', max: 15000, prefijo: 'Parqueadero '}, {cat: 'Personal', re: CC_RE.source, nombre: '', max: 0}]);
}
const mvLimpia = s => String(s || '').replace(/[|_*~•·»«>]+/g, ' ').replace(/\s+/g, ' ').trim();
const mvTitulo = s => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

function parseMovimientos(texto, opts){
  opts = opts || {};
  const hoy = opts.hoy || (typeof today === 'function' ? today() : '');
  const lineas = String(texto || '').replace(/\r/g, '').split('\n').map(mvLimpia).filter(Boolean);
  const out = [];
  let fechaCur = null, saldo = null, usada = new Set();
  lineas.forEach((ln, i) => {
    const t = mvNorm(ln);
    const fLin = mvFecha(ln, hoy);
    let m = ln.match(MV_MONTO) || ln.match(MV_MONTO_SIN);
    // línea que solo es fecha (encabezado del día)
    if(!m){ if(usada.has(i)) return; if(fLin && t.replace(/[^a-z0-9]/g, '').length < 30) fechaCur = fLin; return; }
    const monto = mvNum(m[2]);
    if(monto < 100) return;
    const antes = mvLimpia(ln.slice(0, m.index)), tAntes = mvNorm(antes);
    if(MV_SALDO.test(tAntes) || (!antes && i > 0 && MV_SALDO.test(mvNorm(lineas[i - 1])) && !mvFecha(lineas[i - 1], hoy) && !MV_IN.test(mvNorm(lineas[i - 1])) && !MV_OUT.test(mvNorm(lineas[i - 1])))){
      if(saldo == null) saldo = monto;
      return;
    }
    // descripción: lo que va antes del monto; si no hay, la línea de arriba que tenga texto
    let desc = antes.replace(/\b\d{1,2}:\d{2}\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/gi, '')
      .replace(/^\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|20\d\d-\d\d-\d\d)\s*/, '').trim(), fecha = fLin;
    if(!/[a-záéíóúñ]{3}|4\s?x\s?1000|gmf|iva/i.test(desc) || mvFecha(desc, hoy) && mvNorm(desc).replace(/[^a-z]/g, '').length < 12){
      desc = '';
      for(let k = i - 1; k >= Math.max(0, i - 3); k--){
        if(usada.has(k)) break;
        const c = lineas[k], tc = mvNorm(c);
        if(c.match(MV_MONTO) || c.match(MV_MONTO_SIN)) break;
        const fc = mvFecha(c, hoy);
        if(fc && tc.replace(/[^a-z]/g, '').length < 16 && !MV_IN.test(tc) && !MV_OUT.test(tc)){ if(!fecha) fecha = fc; if(k < i - 1 || desc) break; continue; }
        if(mvEsRuido(tc)) continue;
        desc = c; usada.add(k); break;
      }
    }
    // fecha en la línea de abajo ("Hoy · 3:45 p.m.", "15 oct 2026")
    if(!fecha && i + 1 < lineas.length){
      const n = lineas[i + 1], fn = mvFecha(n, hoy);
      if(fn && (/\d:\d\d/.test(n) || !fechaCur && !/^(hoy|ayer|antier)$/.test(mvNorm(n).trim())) && !(n.match(MV_MONTO) || n.match(MV_MONTO_SIN)) && mvNorm(n).replace(/[^a-z]/g, '').length < 22){ fecha = fn; usada.add(i + 1); }
    }
    if(!fecha) fecha = fechaCur || hoy;
    desc = mvSinBasura(desc.replace(/\s*[-–]\s*$/, '').trim());
    const td = mvNorm(desc);
    let dir = '?';
    const signo = (m[1] || '').trim();
    if(signo === '+') dir = 'in';
    else if(signo) dir = 'out';
    else if(MV_IN.test(td) || /\b(te envio|te pago|recibiste|recibido|recibida)\b/.test(td)) dir = 'in';
    else if(MV_OUT.test(td) || /\b(enviaste|pagaste|compraste|retiraste)\b/.test(td)) dir = 'out';
    let quien = td.replace(MV_PREF, '').replace(/\s+te\s+envio.*$/, '').trim();
    quien = desc.slice(desc.length - quien.length).trim() || desc;
    out.push({fecha, desc: desc || (dir === 'in' ? 'Entrada' : 'Movimiento'), quien: mvTitulo(quien), monto, dir, raw: (desc ? desc + ' ' : '') + (signo === '+' ? '+' : signo ? '−' : '') + '$' + monto});
  });
  out.saldo = saldo;
  return out;
}

/* Ya registrado = mismo monto con fecha a ±1 día en cualquier colección con plata */
function mvYaEsta(db, mv){
  const yo = mv.pendId || '';
  const cerca = f => f && Math.abs(mvDias(f, mv.fecha)) <= 1;
  const L_ = c => (db[c] || []).filter(x => !x.del);
  const igual = v => Math.round(+v || 0) === mv.monto;
  if(mv.dir !== 'in'){
    if(L_('gastos').some(g => igual(g.valor) && cerca(g.fecha))) return 'gasto';
    if(L_('items').some(i => igual(i.buyPrice) && cerca(i.buyDate) && i.buyPocket !== '')) return 'compra';
    if(L_('cobros').some(c => igual((+c.total || 0) - (+c.pagado || 0)) && c.bolsillo && cerca(c.fecha))) return 'préstamo';
  }
  if(mv.dir !== 'out'){
    if(L_('ingresos').some(g => igual(g.valor) && cerca(g.fecha))) return 'ingreso';
    if(L_('items').some(i => i.status === 'sold' && (igual(i.sellPaid != null && i.sellPaid !== '' ? i.sellPaid : i.sellPrice)) && cerca(i.sellDate))) return 'venta';
    if(L_('abonos').some(a => igual(a.monto) && cerca(a.fecha))) return 'abono';
  }
  if(L_('transfers').some(t => igual(t.monto) && cerca(t.fecha))) return 'movimiento';
  if(L_('pend').some(p => p.id !== yo && igual(p.monto) && cerca(p.fecha) && (!yo || p.raw !== mv.raw))) return 'por clasificar';
  return '';
}

/* Decide qué hacer con cada movimiento.
   accion: 'gasto' (con cat/tipo) | 'ingreso' | 'abono' (cobroId) | 'mover' (otro = el otro bolsillo) | 'pend' (por clasificar) | 'ignorar' */
function clasificarMovs(db, movs, opts){
  opts = opts || {};
  const nk = typeof normKey === 'function' ? normKey : (s => mvNorm(s).replace(/[^a-z0-9]+/g, ' ').trim());
  const gcat = typeof guessGCat === 'function' ? guessGCat : (() => 'Otro');
  const negs = typeof NEG_CATS !== 'undefined' ? NEG_CATS : ['Envíos', 'Empaques', 'Comisiones', 'Publicidad'];
  const reglas = (db.reglas || []).filter(r => !r.del);
  const cobros = typeof cobrosPend === 'function' ? cobrosPend(db) : [];
  const vistos = [];
  const bols = (db.bolsillos || []).filter(b => !b.del);
  const bolPorNombre = t => bols.find(b => b.id !== (opts.bolsillo || 'nequi') && [b.nombre].concat(b.alias || []).some(n => { const k = nk(n); return k.length > 3 && (' ' + nk(t) + ' ').includes(' ' + k + ' '); }));
  return movs.map(mv => {
    const r = Object.assign({}, mv, {bolsillo: opts.bolsillo || 'nequi', quien: mvSinBasura(mv.quien), desc: mvSinBasura(mv.desc)});
    mv = r;
    // repetido dentro del mismo pantallazo (dos fotos que se cruzan)
    const rep = vistos.find(x => x.monto === mv.monto && x.fecha === mv.fecha && nk(x.desc) === nk(mv.desc));
    vistos.push(mv);
    if(rep){ r.accion = 'ignorar'; r.ya = 'repetido en las fotos'; return r; }
    const ya = mvYaEsta(db, mv);
    if(ya){ r.accion = 'ignorar'; r.ya = ya; return r; }
    const kq = nk(mv.quien), td = nk(mv.desc);
    // 1) lo que ya aprendió de ti (mismo nombre → misma clasificación)
    const regla = kq && reglas.find(x => x.id === kq);
    if(regla && regla.kind === 'transfer'){
      const otro = mv.dir === 'in' ? regla.from : regla.to;
      if(otro && otro !== r.bolsillo && bols.some(b => b.id === otro)){ r.accion = 'mover'; r.otro = otro; r.porQue = 'como la vez pasada'; return r; }
    }
    if(regla && (regla.kind === 'gasto' && mv.dir !== 'in' || regla.kind === 'ingreso' && mv.dir !== 'out')){
      r.accion = regla.kind; r.cat = regla.cat || (regla.kind === 'gasto' ? gcat(mv.desc) : ''); r.tipo = regla.tipo || '';
      r.desc2 = regla.desc || mv.quien; r.porQue = 'como la vez pasada'; return r;
    }
    // 2) entradas: ¿alguien que te debe?
    if(mv.dir === 'in'){
      const ws = kq.split(' ').filter(w => w.length > 2);
      const c = ws.length && cobros.find(c => { const cn = nk(c.nombre).split(' ').filter(w => w.length > 2); return cn.length && cn.every(w => ws.includes(w)) || (cn[0] && ws[0] === cn[0] && cobros.filter(o => nk(o.nombre).split(' ')[0] === cn[0]).length === 1); });
      if(c && mv.monto <= c.pend + 1){ r.accion = 'abono'; r.cobroId = c.id; r.porQue = 'te debía ' + c.pend; return r; }
      if(/intereses|rendimient/.test(td)){ r.accion = 'ingreso'; r.desc2 = 'Intereses'; return r; }
      if(/devoluci|reembolso|reverso|reintegro/.test(td)){ r.accion = 'ingreso'; r.desc2 = mvTitulo(mv.desc); return r; }
      const de = /^(recarga|transferencia|desde|de )/.test(td) && bolPorNombre(mv.desc);
      if(de){ r.accion = 'mover'; r.otro = de.id; r.porQue = 'de tu ' + de.nombre; return r; }
      r.accion = 'pend'; r.porQue = /^recarga|^transferencia de (nequi|bancolombia|daviplata|davivienda)|^desde /.test(td) ? '¿de otra cuenta tuya?' : mv.monto >= 300000 ? '¿una venta?' : '¿de qué fue?'; return r;
    }
    if(mv.dir === '?'){ r.accion = 'pend'; r.porQue = '¿entró o salió?'; return r; }
    // 3) salidas: categoría por el comercio / palabra
    const a = bolPorNombre(mv.desc);
    if(a && /^(para|a |envi|transferencia|recarga)/.test(td)){ r.accion = 'mover'; r.otro = a.id; r.porQue = 'a tu ' + a.nombre; return r; }
    const ci = comercioInfo(mv.quien || mv.desc, mv.monto) || comercioInfo(mv.desc, mv.monto);
    if(ci){ r.accion = 'gasto'; r.cat = ci.cat; r.tipo = ci.tipo; r.desc2 = ci.nombre; return r; }
    const cat = gcat(mv.desc + ' ' + mv.quien);
    if(cat !== 'Otro'){ r.accion = 'gasto'; r.cat = cat; r.tipo = negs.includes(cat) ? 'negocio' : 'personal'; r.desc2 = mv.quien || mv.desc; return r; }
    if(/^retiro|retiraste|cajero/.test(td) && bols.some(b => b.id === 'efectivo') && r.bolsillo !== 'efectivo'){ r.accion = 'mover'; r.otro = 'efectivo'; r.porQue = 'pasa a efectivo'; return r; }
    r.accion = 'pend'; r.porQue = mv.monto >= 300000 ? '¿compraste un equipo?' : '¿qué fue?'; return r;
  });
}

if(typeof module !== 'undefined') module.exports = {parseMovimientos, clasificarMovs, mvFecha, mvNum, mvYaEsta, mvSinBasura, mvComercio, comercioInfo, nombreComercio, patronesComercio};
