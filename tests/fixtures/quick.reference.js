'use strict';
/**
 * REFERENCIA — NO ES EL PRODUCTO (el producto es app/quick.js, del Frontend).
 *
 * Implementación mínima de SPEC §6.3 que escribió QA con un solo fin: comprobar que
 * tests/quick.test.js es coherente y se puede cumplir (si ninguna implementación pudiera pasarlo,
 * el test estaría mal). Se usa así:
 *
 *   QUICK_PATH=tests/fixtures/quick.reference.js node --test tests/quick.test.js
 *
 * Si app/quick.js falla un caso y dudas de quién tiene la razón, compara su lógica con esta.
 * No se publica ni se importa desde app/. Es script clásico + CommonJS, igual que se pide a quick.js.
 */
(function (root) {
  // En el navegador y en vm, core.js ya declaró extractMonto como global; en Node lo cargamos.
  const EM = typeof extractMonto === 'function' ? extractMonto : require('../../app/core.js').extractMonto;

  const CATS = ['Celulares', 'Consolas', 'Computadores', 'Accesorios', 'Ropa', 'Calzado', 'Coleccionables', 'Moto/Auto', 'Otro'];
  const GCATS = ['Envíos', 'Empaques', 'Comisiones', 'Publicidad', 'Transporte', 'Comida', 'Mantenimiento', 'Servicios', 'Entretenimiento', 'Personal', 'Otro'];
  const NEG_CATS = ['Envíos', 'Empaques', 'Comisiones', 'Publicidad'];

  /* ── normalización ── */
  const strip = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normKey = s => strip(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = s => normKey(s).split(' ').filter(Boolean);
  const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  /* ── categorías por palabra clave (primera categoría de la tabla que coincide) ── */
  const table = rows => rows.map(([cat, ws]) => [cat, new Set(ws.split(' '))]);
  const CAT_WORDS = table([
    ['Accesorios', 'audifonos audifono cargador cargadores funda protector cable parlante mouse teclado airpods smartwatch reloj estuche control correa'],
    ['Consolas', 'ps5 ps4 ps3 ps2 playstation xbox nintendo switch consola consolas wii'],
    ['Celulares', 'iphone celular celulares samsung xiaomi redmi motorola huawei telefono galaxy pixel realme oppo'],
    ['Computadores', 'macbook laptop portatil computador computadores pc imac notebook lenovo asus hp dell monitor tablet ipad'],
    ['Calzado', 'tenis zapatilla zapatillas zapato zapatos bota botas sandalia sandalias crocs guayos'],
    ['Ropa', 'camisa camisas camiseta camisetas jean jeans pantalon chaqueta buso hoodie vestido falda ropa medias sudadera'],
    ['Coleccionables', 'funko funkos carta cartas pokemon figura figuras coleccion lego comic album moneda monedas'],
    ['Moto/Auto', 'moto carro auto casco llanta camioneta vehiculo'],
    ['Calzado', 'nike adidas jordan puma'],
  ]);
  const GCAT_WORDS = table([
    ['Envíos', 'envio envios flete fletes servientrega interrapidisimo coordinadora mensajeria'],
    ['Empaques', 'empaque empaques caja cajas bolsa bolsas burbuja cinta embalaje'],
    ['Comisiones', 'comision comisiones'],
    ['Publicidad', 'publicidad pauta anuncio anuncios ads'],
    ['Mantenimiento', 'mantenimiento reparacion arreglo repuesto taller tecnico'],
    ['Transporte', 'uber taxi bus pasaje pasajes gasolina didi cabify peaje parqueadero metro tiquete'],
    ['Comida', 'almuerzo comida cena desayuno restaurante pizza hamburguesa mercado cafe tinto empanada rappi onces helado'],
    ['Servicios', 'luz agua gas internet arriendo wifi energia administracion claro movistar tigo'],
    ['Entretenimiento', 'netflix spotify cine rumba trago disney youtube fiesta concierto cerveza licor'],
    ['Personal', 'peluqueria barberia medico farmacia drogueria gimnasio regalo salud'],
  ]);
  const guess = (tbl, desc, otro) => {
    const ws = words(desc);
    for (const [cat, set] of tbl) if (ws.some(w => set.has(w))) return cat;
    return otro;
  };
  const guessCat = desc => guess(CAT_WORDS, desc, 'Otro');
  const guessGCat = desc => guess(GCAT_WORDS, desc, 'Otro');

  /* ── bestMatch: coincidencia por tokens (sin tildes ni mayúsculas, ignora relleno) ── */
  const FILL = new Set('de del el la los las un una en por con a al para mi me le y que pesos peso pesitos'.split(' '));   // + SPEC §10.2
  function bestMatch(q, lista, getTexto) {
    const qt = [...new Set(words(q).filter(w => !FILL.has(w)))];
    if (!qt.length || !Array.isArray(lista)) return null;
    const get = typeof getTexto === 'function' ? getTexto : x => x;
    let best = null, bc = 0, bj = 0;
    for (const it of lista) {
      const tt = new Set(words(get(it)));
      const hit = qt.filter(w => tt.has(w));
      if (!hit.length || hit.every(w => /^\d+$/.test(w))) continue;   // solo números en común no basta
      const cov = hit.length / qt.length;
      if (cov < 0.5) continue;
      const jac = hit.length / (tt.size + qt.length - hit.length);
      if (cov > bc || (cov === bc && jac > bj)) { best = it; bc = cov; bj = jac; }
    }
    return best;
  }

  /* ── palabras clave por tipo (en orden de precedencia). '=' = comparar CON tilde. ── */
  const KW = [
    ['transfer', [['retire'], ['saque'], ['pase'], ['movi'], ['transferi']]],
    ['abono', [['abono'], ['=pagó'], ['me', 'pago'], ['me', 'dio'], ['me', 'consigno']]],
    ['cobro', [['me', 'debe'], ['me', 'quedo', 'debiendo'], ['le', 'preste'], ['preste'], ['fie'], ['fiado']]],
    ['venta', [['vendi'], ['venta'], ['vendido']]],
    ['compra', [['compre'], ['compra']]],
    ['ingreso', [['ingreso'], ['me', 'pagaron'], ['recibi'], ['sueldo'], ['salario'], ['me', 'entro'], ['gane']]],
    ['gasto', [['gaste'], ['gasto'], ['pague'], ['pago'], ['pagar']]],
  ];
  const EFE_SYN = ['efectivo', 'cash', 'fisico', 'billete'];

  const tokenize = rest => String(rest).split(' ').map(raw => {
    const clean = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    return { clean, n: strip(clean), used: false };
  }).filter(t => t.clean);

  const same = (t, w) => (w[0] === '=' ? t.clean === w.slice(1) : t.n === w);
  const findSeq = (toks, seq) => {
    for (let i = 0; i + seq.length <= toks.length; i++)
      if (seq.every((w, k) => !toks[i + k].used && same(toks[i + k], w))) return i;
    return -1;
  };

  function pocketDefs(bols) {
    const defs = [];
    for (const p of bols) {
      if (!p || p.id == null || p.id === '') continue;
      const seqs = [];
      const nm = words(p.nombre); if (nm.length) seqs.push(nm);
      const iw = words(p.id); if (iw.length === 1 && /^[a-z]+$/.test(iw[0])) seqs.push(iw);
      if (p.id === 'efectivo') EFE_SYN.forEach(s => seqs.push([s]));
      defs.push({ id: p.id, seqs });
    }
    return defs;
  }

  function findPockets(toks, defs) {
    const hits = [];
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].used) continue;
      let best = null;
      for (const d of defs) for (const seq of d.seqs) {
        if (i + seq.length <= toks.length && seq.every((w, k) => !toks[i + k].used && toks[i + k].n === w) && (!best || seq.length > best.len))
          best = { i, len: seq.length, id: d.id };
      }
      if (!best) continue;
      for (let k = 0; k < best.len; k++) toks[i + k].used = true;
      const prev = toks[i - 1];
      if (prev && !prev.used && ['de', 'del', 'a', 'al'].includes(prev.n)) { best.prep = (prev.n === 'de' || prev.n === 'del') ? 'de' : 'a'; prev.used = true; }
      hits.push(best);
      i += best.len - 1;
    }
    return hits;
  }

  function parseQuick(texto, ctx) {
    ctx = ctx || {};
    const bols = Array.isArray(ctx.bolsillos) ? ctx.bolsillos : [];
    const stock = Array.isArray(ctx.stock) ? ctx.stock : [];
    const cobros = Array.isArray(ctx.cobros) ? ctx.cobros : [];

    const { monto, rest } = EM(String(texto == null ? '' : texto).normalize('NFC'));
    const toks = tokenize(rest);

    // 1) tipo por palabra clave
    let kind = 'gasto';
    for (const [k, seqs] of KW) {
      const hit = seqs.find(seq => findSeq(toks, seq) >= 0);
      if (!hit) continue;
      kind = k;
      // "vendí xbox 700k a juan fiado": una venta a crédito, no un cobro
      if (k === 'cobro' && (hit[0] === 'fiado' || hit[0] === 'fie') && KW[3][1].some(seq => findSeq(toks, seq) >= 0)) { toks[findSeq(toks, hit)].used = true; continue; }
      const i = findSeq(toks, hit);
      hit.forEach((_, j) => { toks[i + j].used = true; });
      break;
    }

    // 2) bolsillo(s)
    const pockets = findPockets(toks, pocketDefs(bols));
    const pocket = pockets.length ? pockets[0].id : undefined;

    // 3) tipo de gasto explícito
    let tipoExp;
    if (kind === 'gasto') {
      for (const t of toks) if (!t.used && (t.n === 'negocio' || t.n === 'personal')) { tipoExp = t.n; t.used = true; }
    }

    // "sueldo"/"salario" son palabra clave Y la descripción natural del ingreso
    let kwIngreso = '';
    if (kind === 'ingreso') { const t = toks.find(x => x.used && (x.n === 'sueldo' || x.n === 'salario')); if (t) kwIngreso = t.clean; }

    // 4) resto = descripción / nombre
    // descripción: el relleno se quita en cualquier parte; NOMBRE (cobro/abono): solo en los BORDES (SPEC §10.2: "Luis del Río", "Juan de Dios")
    const libres = toks.filter(t => !t.used);
    let desc;
    if (kind === 'cobro' || kind === 'abono') {
      let i = 0, j = libres.length;
      while (i < j && FILL.has(libres[i].n)) i++;
      while (j > i && FILL.has(libres[j - 1].n)) j--;
      desc = cap(libres.slice(i, j).map(t => t.clean).join(' '));
    } else desc = cap(libres.filter(t => !FILL.has(t.n)).map(t => t.clean).join(' '));
    const d = {};
    const put = (k, v) => { if (v !== undefined) d[k] = v; };

    switch (kind) {
      case 'transfer': {
        const de = pockets.find(h => h.prep === 'de'), a = pockets.find(h => h.prep === 'a');
        const otro = id => (id === 'nequi' ? 'efectivo' : id === 'efectivo' ? 'nequi' : 'efectivo');
        let from, to;
        if (de || a) { from = de ? de.id : undefined; to = a ? a.id : undefined; }
        else if (pockets.length) from = pockets[0].id;
        if (!from) from = to === 'nequi' ? 'efectivo' : 'nequi';
        if (!to) to = otro(from);
        if (from === to) from = otro(to);
        Object.assign(d, { from, to, monto });
        break;
      }
      case 'abono': {
        const c = bestMatch(desc, cobros, x => x.nombre);
        Object.assign(d, { cobroId: c ? c.id : '', nombre: desc, monto });
        put('bolsillo', pocket);
        break;
      }
      case 'cobro':
        Object.assign(d, { nombre: desc, total: monto, bolsillo: pocket === undefined ? '' : pocket });
        break;
      case 'venta': {
        const it = desc ? bestMatch(desc, stock, x => x.desc) : null;
        Object.assign(d, { itemId: it ? it.id : (desc ? '__nuevo' : ''), sellPrice: monto });
        if (!it && desc) d.desc = desc;
        put('sellPocket', pocket);
        break;
      }
      case 'compra':
        Object.assign(d, { desc, cat: guessCat(desc), buyPrice: monto });
        put('buyPocket', pocket);
        break;
      case 'ingreso':
        Object.assign(d, { desc: desc || cap(kwIngreso), valor: monto });
        put('bolsillo', pocket);
        break;
      default: { // gasto
        const cat = guessGCat(desc);
        Object.assign(d, { desc, valor: monto, cat, tipo: tipoExp || (NEG_CATS.includes(cat) ? 'negocio' : 'personal') });
        put('bolsillo', pocket);
      }
    }
    return { kind, d };
  }

  const api = { CATS, GCATS, NEG_CATS, guessCat, guessGCat, normKey, bestMatch, parseQuick };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
