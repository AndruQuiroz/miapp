'use strict';
/**
 * Pruebas de app/quick.js — registro rápido en una frase (SPEC §6.3). node:test + assert, sin dependencias.
 *   node --test tests/quick.test.js
 *
 * - Si app/quick.js NO existe todavía (lo escribe el Frontend en paralelo), TODO este archivo se salta
 *   (skip) y la suite sigue verde. En cuanto exista, estas pruebas corren solas.
 * - QUICK_PATH=/ruta/otro-quick.js corre la MISMA suite contra otra implementación. Con
 *   QUICK_PATH=tests/fixtures/quick.reference.js se comprueba que estas pruebas son coherentes y cumplibles
 *   (esa referencia la escribió QA; NO es el producto).
 *
 * Todo lo de aquí es prueba NORMAL (nada se salta con "todo"): lo fija el SPEC §6.3, las decisiones del lead (SPEC §10.2:
 * "pesos" es relleno; el relleno se quita solo en los bordes del nombre; "pagué préstamo" = gasto; "__proto__" no es palabra
 * clave) o es una invariante evidente (no lanzar, no mutar ctx, montos enteros, nada de "undefined"/NaN en el borrador).
 * Si un caso falla, es señal para el Frontend (app/quick.js), no para QA: no se salta.
 * Los valores esperados están razonados a mano desde la gramática, no copiados de la salida del código.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { withNow } = require('./helpers/clock');
const core = require('./helpers/core');
const { rng } = require('./helpers/rng');
const SPEC = require('./helpers/spec');

/* ── carga (perezosa y a prueba de fallos: un quick.js roto debe fallar UN test, no tumbar todo el archivo) ── */
const DEFAULT_PATH = path.resolve(__dirname, '../app/quick.js');
const QUICK_PATH = process.env.QUICK_PATH ? path.resolve(process.env.QUICK_PATH) : DEFAULT_PATH;
const HAY = fs.existsSync(QUICK_PATH);
let Q = {}, LOAD_ERROR = null;
if (HAY) { try { Q = require(QUICK_PATH); } catch (e) { LOAD_ERROR = e; } }
const QUICK_SOURCE = HAY ? fs.readFileSync(QUICK_PATH, 'utf8') : '';

const SKIP_ALL = HAY ? false : 'app/quick.js todavía no existe (lo escribe el Frontend): pruebas de quick.js omitidas';
const SKIP = SKIP_ALL || (LOAD_ERROR || typeof Q.parseQuick !== 'function' ? 'quick.js no carga o no exporta parseQuick (mira el test "carga")' : false);

/* ── contextos de prueba ── */
const clone = x => JSON.parse(JSON.stringify(x));
const EFE = { id: 'efectivo', nombre: 'Efectivo' }, NEQ = { id: 'nequi', nombre: 'Nequi' };

/** Exactamente el ctx que supone el SPEC en sus casos obligatorios. */
const CTX_SPEC = { bolsillos: [EFE, NEQ], stock: [{ id: 'it-ps5', desc: 'PS5' }], cobros: [{ id: 'cb-juan', nombre: 'Juan' }] };

/** Contexto rico: bolsillos propios (uno con tilde), stock variado y cobros con nombre y apellido. */
const BOLS = [EFE, NEQ, { id: 'b-bcol', nombre: 'Bancolombia' }, { id: 'b-cajon', nombre: 'Cajón' }];
const STOCK = [
  { id: 's-ps5', desc: 'PS5 825GB' }, { id: 's-ps5d', desc: 'PS5 Digital' }, { id: 's-ip13', desc: 'iPhone 13 128GB' },
  { id: 's-xbox', desc: 'Xbox Series S' }, { id: 's-nike', desc: 'Zapatillas Nike Air Max' }, { id: 's-tel', desc: 'Teléfono Móvil Samsung A54' },
];
const COBROS = [
  { id: 'cb-juan', nombre: 'Juan Pérez' }, { id: 'cb-maria', nombre: 'María Gómez' },
  { id: 'cb-camilo', nombre: 'Camilo Restrepo' }, { id: 'cb-pedro', nombre: 'Pedro Salazar' },
];
const CTX = { bolsillos: BOLS, stock: STOCK, cobros: COBROS };
const CTX_VACIO = { bolsillos: [EFE, NEQ], stock: [], cobros: [] };

/* ── ayudas de aserción ── */
const TEXTOS = new Set(['desc', 'nombre']);
const esFecha = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const sinMonto = v => v === undefined || v === null || v === '' || v === 0;
const sinBolsillo = v => v === undefined || v === '' || v === null || BOLS.some(b => b.id === v);

/** ¿el campo real cumple lo esperado? desc/nombre: sin distinguir mayúsculas pero con inicial mayúscula (SPEC: "primera letra en mayúscula"). */
function coincide(k, real, esperado) {
  if (typeof esperado === 'function') return esperado(real);
  if (TEXTOS.has(k) && typeof esperado === 'string')
    return typeof real === 'string' && real.toLowerCase() === esperado.toLowerCase() && real.charAt(0) === real.charAt(0).toUpperCase();
  return JSON.stringify(real) === JSON.stringify(esperado);
}

function parse(txt, ctx = CTX) { return Q.parseQuick(txt, clone(ctx)); }

/** Parsea y exige tipo + campos (parciales). Devuelve d. */
function esperar(txt, kind, campos = {}, ctx = CTX) {
  const r = parse(txt, ctx), vista = JSON.stringify(r);
  assert.ok(r && typeof r === 'object' && r.d && typeof r.d === 'object', `"${txt}" no devolvió {kind, d}: ${vista}`);
  assert.equal(r.kind, kind, `"${txt}" → kind '${r.kind}' en vez de '${kind}'. Resultado: ${vista}`);
  for (const [k, v] of Object.entries(campos))
    assert.ok(coincide(k, r.d[k], v), `"${txt}" → d.${k} = ${JSON.stringify(r.d[k])}; esperado ${typeof v === 'function' ? 'que cumpla ' + v : JSON.stringify(v)}.\n  Resultado: ${vista}`);
  return r.d;
}

/** Igual que esperar pero con igualdad ESTRICTA de cada campo (para los 8 casos literales del SPEC). */
function esperarExacto(txt, kind, campos, ctx) {
  const r = parse(txt, ctx);
  assert.equal(r.kind, kind, `"${txt}" → ${JSON.stringify(r)}`);
  for (const [k, v] of Object.entries(campos)) assert.deepEqual(r.d[k], v, `"${txt}" → d.${k} (resultado completo: ${JSON.stringify(r)})`);
  return r.d;
}

/** Para comparar "lo mismo" entre variantes: minúsculas y SIN tildes en todos los textos (lo que el usuario teclea con tilde, se queda con tilde). */
const fold = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const lower = r => JSON.stringify(r, (k, v) => (typeof v === 'string' ? fold(v) : v));
const SPEC_IDS = BOLS.map(b => b.id);
const KINDS_OK = r => r && SPEC.KINDS.includes(r.kind) && r.d && typeof r.d === 'object';

/* ════════════════════════════════════════════════════════════════════════════
   0. Carga y contrato de exportación
════════════════════════════════════════════════════════════════════════════ */
describe('carga y contrato de quick.js (SPEC §6.3)', { skip: SKIP_ALL }, () => {
  test('carga sin errores con require()', () => {
    if (LOAD_ERROR) throw LOAD_ERROR;
  });

  test('exporta parseQuick, CATS, GCATS, NEG_CATS, guessCat, guessGCat, normKey y bestMatch', () => {
    for (const f of ['parseQuick', 'guessCat', 'guessGCat', 'normKey', 'bestMatch']) assert.equal(typeof Q[f], 'function', `${f} no es una función exportada`);
    for (const a of ['CATS', 'GCATS', 'NEG_CATS']) assert.ok(Array.isArray(Q[a]), `${a} no es un arreglo exportado`);
  });

  test('CATS, GCATS y NEG_CATS son EXACTAMENTE las listas del SPEC (mismo orden)', { skip: SKIP }, () => {
    assert.deepEqual(Q.CATS, SPEC.CATS);
    assert.deepEqual(Q.GCATS, SPEC.GCATS);
    assert.deepEqual(Q.NEG_CATS, SPEC.NEG_CATS);
    for (const c of Q.NEG_CATS) assert.ok(Q.GCATS.includes(c), `${c} ∈ NEG_CATS pero no ∈ GCATS`);
    assert.equal(Q.CATS[Q.CATS.length - 1], 'Otro');
    assert.equal(Q.GCATS[Q.GCATS.length - 1], 'Otro');
  });

  test('como script clásico tras core.js (orden del index.html) deja los mismos nombres como globales y no pisa nada de core.js', () => {
    const ctx = vm.createContext({});
    ctx.window = ctx; // navegador: window === global (pero sin document, localStorage, require ni module)
    vm.runInContext(core.CORE_SOURCE, ctx, { filename: 'core.js' });
    const NOMBRES_CORE = ['COLS', 'emptyDB', 'mergeDB', 'L', 'sum', 'today', 'shiftDate', 'daysBetween', 'MESES', 'monthLabel',
      'fmt', 'full', 'fd', 'extractMonto', 'parseMoney', 'parseNoti', 'balances', 'cobroPagado', 'cobrosPend', 'monthStats', 'summaryText', 'remindersText'];
    ctx.__core = vm.runInContext(`({${NOMBRES_CORE.join(',')}})`, ctx);
    vm.runInContext(QUICK_SOURCE, ctx, { filename: 'quick.js' }); // un `const` repetido (p. ej. L, sum, fmt) lanzaría SyntaxError aquí
    for (const n of ['parseQuick', 'CATS', 'GCATS', 'NEG_CATS', 'guessCat', 'guessGCat', 'normKey', 'bestMatch'])
      assert.notEqual(vm.runInContext(`typeof ${n}`, ctx), 'undefined', `${n} no queda como global al cargar quick.js como <script>`);
    for (const n of NOMBRES_CORE)
      assert.ok(ctx.__core[n] === vm.runInContext(n, ctx), `quick.js reemplazó ${n} de core.js (cargado antes que él)`);
  });

  test('es puro: en un contexto sin DOM ni Node (solo core.js + quick.js) produce el mismo resultado que en Node', { skip: SKIP }, () => {
    const ctx = vm.createContext({});
    vm.runInContext(core.CORE_SOURCE, ctx);
    vm.runInContext(QUICK_SOURCE, ctx);
    for (const g of ['document', 'localStorage', 'navigator', 'require', 'module', 'process'])
      assert.equal(vm.runInContext(`typeof ${g}`, ctx), 'undefined');
    ctx.__ctx = JSON.stringify(CTX_SPEC);
    for (const frase of ['compré ps5 1.2M nequi', 'vendí ps5 1.5M efectivo', 'juan abonó 50k nequi', 'retiré 100k nequi', 'almuerzo 18 mil']) {
      ctx.__frase = frase;
      const enVm = JSON.parse(vm.runInContext('JSON.stringify(parseQuick(__frase, JSON.parse(__ctx)))', ctx));
      assert.deepEqual(enVm, JSON.parse(JSON.stringify(parse(frase, CTX_SPEC))), frase);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   1. Los 8 casos OBLIGATORIOS del SPEC §6.3 (literales)
════════════════════════════════════════════════════════════════════════════ */
describe('casos obligatorios del SPEC §6.3', { skip: SKIP }, () => {
  test('"compré ps5 1.2M nequi" → compra {desc:"Ps5", buyPrice:1200000, buyPocket:"nequi", cat:"Consolas"}', () => {
    esperarExacto('compré ps5 1.2M nequi', 'compra', { desc: 'Ps5', buyPrice: 1200000, buyPocket: 'nequi', cat: 'Consolas' }, CTX_SPEC);
  });
  test('"vendí ps5 1.5M efectivo" (PS5 en stock) → venta {itemId:<id>, sellPrice:1500000, sellPocket:"efectivo"}', () => {
    esperarExacto('vendí ps5 1.5M efectivo', 'venta', { itemId: 'it-ps5', sellPrice: 1500000, sellPocket: 'efectivo' }, CTX_SPEC);
  });
  test('"envío 12k nequi" → gasto {valor:12000, cat:"Envíos", tipo:"negocio", bolsillo:"nequi"}', () => {
    esperarExacto('envío 12k nequi', 'gasto', { valor: 12000, cat: 'Envíos', tipo: 'negocio', bolsillo: 'nequi' }, CTX_SPEC);
  });
  test('"almuerzo 18 mil" → gasto {valor:18000, cat:"Comida", tipo:"personal"}', () => {
    esperarExacto('almuerzo 18 mil', 'gasto', { valor: 18000, cat: 'Comida', tipo: 'personal' }, CTX_SPEC);
  });
  test('"juan me debe 200k" → cobro {nombre:"Juan", total:200000}', () => {
    esperarExacto('juan me debe 200k', 'cobro', { nombre: 'Juan', total: 200000 }, CTX_SPEC);
  });
  test('"juan abonó 50k nequi" (cobro de Juan existe) → abono {cobroId:<id>, monto:50000, bolsillo:"nequi"}', () => {
    esperarExacto('juan abonó 50k nequi', 'abono', { cobroId: 'cb-juan', monto: 50000, bolsillo: 'nequi' }, CTX_SPEC);
  });
  test('"retiré 100k nequi" → transfer {from:"nequi", to:"efectivo", monto:100000}', () => {
    esperarExacto('retiré 100k nequi', 'transfer', { from: 'nequi', to: 'efectivo', monto: 100000 }, CTX_SPEC);
  });
  test('"sueldo 1.3M nequi" → ingreso {valor:1300000, bolsillo:"nequi"}', () => {
    esperarExacto('sueldo 1.3M nequi', 'ingreso', { valor: 1300000, bolsillo: 'nequi' }, CTX_SPEC);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   2. Extras por tipo (gramática del SPEC)
════════════════════════════════════════════════════════════════════════════ */
const CASOS = {
  compra: [
    ['compré iphone 13 128gb 800k nequi', { desc: 'Iphone 13 128gb', buyPrice: 800000, buyPocket: 'nequi' }],   // 13 y 128gb NO son plata
    ['compré macbook air m1 2.8M efectivo', { desc: 'Macbook air m1', buyPrice: 2800000, buyPocket: 'efectivo' }],
    ['compré moto modelo 2022 8 millones nequi', { desc: 'Moto modelo 2022', buyPrice: 8000000, buyPocket: 'nequi' }], // el año se queda en la descripción
    ['compré un ps5 en 1.2M con efectivo', { desc: 'Ps5', buyPrice: 1200000, buyPocket: 'efectivo' }],               // relleno: un, en, con
    ['compra audifonos 80k nequi', { desc: 'Audifonos', buyPrice: 80000, buyPocket: 'nequi' }],                     // "compra" también es palabra clave
    ['compré 2 camisas 80k efectivo', { desc: '2 camisas', buyPrice: 80000 }],                                      // la cantidad no es el precio
    ['compré tenis nike air max 250k bancolombia', { desc: 'Tenis nike air max', buyPrice: 250000, buyPocket: 'b-bcol' }], // bolsillo propio por nombre
    ['compré xbox series s 600 mil cajón', { desc: 'Xbox series s', buyPrice: 600000, buyPocket: 'b-cajon' }],
    ['compré ps5 nequi', { desc: 'Ps5', buyPocket: 'nequi', buyPrice: sinMonto }],                                   // sin monto: no inventar uno
    ['compré 3 funko 45000 nequi', { desc: '3 funko', buyPrice: 45000, buyPocket: 'nequi' }],
  ],
  venta: [
    ['vendí iphone 13 en 900k nequi', { itemId: 's-ip13', sellPrice: 900000, sellPocket: 'nequi' }],
    ['vendí ps5 digital 1.4M efectivo', { itemId: 's-ps5d', sellPrice: 1400000, sellPocket: 'efectivo' }],            // gana el de más tokens en común
    ['vendí el xbox por 700.000 en efectivo', { itemId: 's-xbox', sellPrice: 700000, sellPocket: 'efectivo' }],
    ['vendi telefono samsung 300k nequi', { itemId: 's-tel', sellPrice: 300000, sellPocket: 'nequi' }],              // sin tildes vs "Teléfono Móvil"
    ['vendí NIKE 150k efectivo', { itemId: 's-nike', sellPrice: 150000, sellPocket: 'efectivo' }],                  // mayúsculas vs "Nike"
    ['venta xbox 700k cash', { itemId: 's-xbox', sellPrice: 700000, sellPocket: 'efectivo' }],                       // "venta" y sinónimo "cash"
    ['vendido iphone 13 1M físico', { itemId: 's-ip13', sellPrice: 1000000, sellPocket: 'efectivo' }],               // "vendido" y sinónimo "físico"
    ['vendí camiseta 40k efectivo', { itemId: '__nuevo', desc: 'Camiseta', sellPrice: 40000, sellPocket: 'efectivo' }], // sin match → __nuevo
    ['vendí ps4 600k nequi', { itemId: '__nuevo', desc: 'Ps4', sellPrice: 600000 }],                                 // ps4 NO es ps5
    ['vendí 100k nequi', { sellPrice: 100000, sellPocket: 'nequi', itemId: v => !STOCK.some(s => s.id === v) }],     // sin descripción: no adivinar un producto
  ],
  gasto: [
    ['uber 12k efectivo', { valor: 12000, bolsillo: 'efectivo' }],                                                    // sin palabra clave → gasto
    ['gasté 18 mil en almuerzo', { valor: 18000, desc: 'Almuerzo', cat: 'Comida', tipo: 'personal' }],               // "en" es relleno
    ['gasté 30k negocio almuerzo nequi', { valor: 30000, desc: 'Almuerzo', cat: 'Comida', tipo: 'negocio', bolsillo: 'nequi' }], // "negocio" fija el tipo y no queda en desc
    ['envío 12k personal', { valor: 12000, cat: 'Envíos', tipo: 'personal' }],                                        // "personal" gana a la categoría
    ['pagué 50k por la luz de mi casa con nequi', { valor: 50000, desc: 'Luz casa', bolsillo: 'nequi' }],            // relleno: por, la, de, mi, con
    ['gasto 12k envío nequi', { valor: 12000, desc: 'Envío', cat: 'Envíos', tipo: 'negocio', bolsillo: 'nequi' }],   // la palabra clave no se come la descripción
    ['pagar 80k transporte', { valor: 80000, desc: 'Transporte' }],
    ['pago 25k bancolombia domicilio', { valor: 25000, bolsillo: 'b-bcol', desc: 'Domicilio' }],
    ['gasté 15k en un café y una empanada', { valor: 15000, desc: 'Café empanada' }],                                // relleno: en, un, y, una
    ['gasté 5k cajón', { valor: 5000, bolsillo: 'b-cajon' }],                                                         // bolsillo con tilde, tecleado sin ella
    ['50k', { valor: 50000 }],                                                                                        // solo un monto → gasto
    ['gasté 18.000 pesos en almuerzo', { valor: 18000, desc: 'Almuerzo' }],                                           // SPEC §10.2: "pesos" es relleno
    ['pagué 20 mil pesos de taxi', { valor: 20000, desc: 'Taxi' }],
    ['gasté 5 mil pesitos en dulces', { valor: 5000, desc: 'Dulces' }],
    ['pagué el préstamo 100k nequi', { valor: 100000, desc: 'Préstamo', bolsillo: 'nequi' }],                        // SPEC §10.2: pagar una deuda propia = gasto
  ],
  ingreso: [
    ['me pagaron 300k efectivo', { valor: 300000, bolsillo: 'efectivo' }],
    ['recibí 50k nequi regalo', { valor: 50000, bolsillo: 'nequi', desc: 'Regalo' }],
    ['me entró 200k nequi', { valor: 200000, bolsillo: 'nequi' }],
    ['gané 80k efectivo rifa', { valor: 80000, bolsillo: 'efectivo', desc: 'Rifa' }],
    ['salario 2M nequi', { valor: 2000000, bolsillo: 'nequi' }],
    ['me pagaron 300k por el arreglo', { valor: 300000, desc: 'Arreglo' }],
  ],
  cobro: [
    ['le presté 300 mil a camilo', { nombre: 'Camilo', total: 300000 }],
    ['pedro me quedó debiendo 120k', { nombre: 'Pedro', total: 120000 }],
    ['fié 80k a pedro', { nombre: 'Pedro', total: 80000 }],
    ['presté 50k a maría', { nombre: 'María', total: 50000 }],
    ['fiado 50k a laura', { nombre: 'Laura', total: 50000 }],
    ['le presté 300k a camilo nequi', { nombre: 'Camilo', total: 300000, bolsillo: 'nequi' }],                       // préstamo: de dónde salió la plata
    ['juan pérez me debe 1.5M', { nombre: 'Juan Pérez', total: 1500000 }],
    ['doña rosa me debe 50k', { nombre: 'Doña Rosa', total: 50000 }],
    ['luis del río me debe 50k', { nombre: 'Luis del Río', total: 50000 }],                                           // SPEC §10.2: el relleno se quita solo en los BORDES del nombre
    ['juan de dios me debe 50k', { nombre: 'Juan de Dios', total: 50000 }],
    ['maría de los ángeles me debe 80k', { nombre: 'María de los Ángeles', total: 80000 }],
    ['le presté 300k a juan de dios', { nombre: 'Juan de Dios', total: 300000 }],                                    // "a" del borde sí se quita; "de" interior no
    ['juan me debe 50 mil pesos', { nombre: 'Juan', total: 50000 }],                                                  // "pesos" también es relleno aquí
  ],
  abono: [
    ['maria me pagó 100k efectivo', { cobroId: 'cb-maria', monto: 100000, bolsillo: 'efectivo' }],                   // "me pagó" (con tilde)
    ['camilo me dio 40k nequi', { cobroId: 'cb-camilo', monto: 40000, bolsillo: 'nequi' }],                          // "me dio"
    ['pedro me consignó 70k nequi', { cobroId: 'cb-pedro', monto: 70000, bolsillo: 'nequi' }],                       // "me consignó"
    ['pérez abonó 20k', { cobroId: 'cb-juan', monto: 20000 }],                                                        // por el apellido, con tilde
    ['gomez abono 20k nequi', { cobroId: 'cb-maria', monto: 20000, bolsillo: 'nequi' }],                             // por el apellido, sin tildes
    ['juan pagó 50k nequi', { cobroId: 'cb-juan', monto: 50000, bolsillo: 'nequi' }],                                // "pagó" con tilde = abono
    ['andres abonó 50k nequi', { monto: 50000, bolsillo: 'nequi', cobroId: v => !COBROS.some(c => c.id === v) }],     // sin cobro de Andrés: NO atribuirlo a otro
  ],
  transfer: [
    ['pasé 200k de nequi a efectivo', { from: 'nequi', to: 'efectivo', monto: 200000 }],
    ['pasé 150k de efectivo a nequi', { from: 'efectivo', to: 'nequi', monto: 150000 }],
    ['saqué 100 mil de nequi', { from: 'nequi', to: 'efectivo', monto: 100000 }],
    ['moví 50k de efectivo a nequi', { from: 'efectivo', to: 'nequi', monto: 50000 }],
    ['transferí 90k de nequi a efectivo', { from: 'nequi', to: 'efectivo', monto: 90000 }],
    ['pasé 500k de nequi a bancolombia', { from: 'nequi', to: 'b-bcol', monto: 500000 }],                            // bolsillo propio
    ['retiré 100k', { from: 'nequi', to: 'efectivo', monto: 100000 }],                                                // por defecto Nequi → Efectivo
    ['retiré 100 mil del nequi', { from: 'nequi', to: 'efectivo', monto: 100000 }],
    ['pasé 20k de nequi a cash', { from: 'nequi', to: 'efectivo' }],                                                  // sinónimos de efectivo
    ['pasé 20k de nequi a físico', { from: 'nequi', to: 'efectivo' }],
    ['pasé 20k de nequi a fisico', { from: 'nequi', to: 'efectivo' }],
    ['pasé 20k de nequi a billete', { from: 'nequi', to: 'efectivo' }],
    ['moví 50k a nequi', { to: 'nequi', monto: 50000 }],                                                              // solo "a X"
  ],
};

describe('registro rápido: casos extra por tipo', { skip: SKIP }, () => {
  for (const [kind, filas] of Object.entries(CASOS)) {
    describe(kind, () => {
      for (const [frase, campos] of filas) test(`"${frase}"`, () => { esperar(frase, kind, campos); });
    });
  }

  test('"juan abonó 10k" con dos Juan y una María: nunca se lo atribuye a María', () => {
    const ctx = { bolsillos: [EFE, NEQ], stock: [], cobros: [{ id: 'j1', nombre: 'Juan Pérez' }, { id: 'j2', nombre: 'Juan Camilo Ríos' }, { id: 'm1', nombre: 'María Gómez' }] };
    const d = esperar('juan abonó 10k', 'abono', { monto: 10000 }, ctx);
    assert.notEqual(d.cobroId, 'm1');
    esperar('camilo ríos abonó 10k', 'abono', { cobroId: 'j2' }, ctx); // el que más tokens comparte
  });

  test('abono a un cobro con nombre compuesto ("Juan de Dios Pérez") por el nombre completo o por una parte', () => {
    const ctx = { bolsillos: [EFE, NEQ], stock: [], cobros: [{ id: 'jd', nombre: 'Juan de Dios Pérez' }, { id: 'mg', nombre: 'María Gómez' }] };
    esperar('juan de dios abonó 50k', 'abono', { cobroId: 'jd', monto: 50000 }, ctx);
    esperar('pérez abonó 50k nequi', 'abono', { cobroId: 'jd', monto: 50000, bolsillo: 'nequi' }, ctx);
  });

  test('"juan abonó 50k" sin cobros: abono sin cobroId (el formulario lo pedirá), sin lanzar', () => {
    const d = esperar('juan abonó 50k', 'abono', { monto: 50000 }, CTX_VACIO);
    assert.ok(!d.cobroId, `cobroId inventado: ${JSON.stringify(d.cobroId)}`);
  });

  test('"vendí ps5 1.5M" con dos PS5 en stock devuelve uno de los dos y siempre el mismo', () => {
    const a = esperar('vendí ps5 1.5M efectivo', 'venta', { sellPrice: 1500000 }, CTX);
    assert.ok(['s-ps5', 's-ps5d'].includes(a.itemId), a.itemId);
    assert.equal(parse('vendí ps5 1.5M efectivo').d.itemId, a.itemId);
  });

  test('bolsillo inexistente: no inventa un id; la palabra se queda en la descripción', () => {
    const r = esperar('gasté 20k nequii', 'gasto', { valor: 20000, bolsillo: sinBolsillo });   // typo del usuario
    assert.equal(r.desc.toLowerCase(), 'nequii');
    const d = esperar('gasté 20k daviplata mercado', 'gasto', { valor: 20000, bolsillo: sinBolsillo }, CTX); // Daviplata no está en ctx
    assert.match(d.desc.toLowerCase(), /daviplata/);
    esperar('pasé 20k de nequi a daviplata', 'transfer', { monto: 20000, from: 'nequi', to: v => SPEC_IDS.includes(v) });
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   3. Palabras completas (lookarounds de espacio, no subcadenas) — SPEC: "NO \b"
════════════════════════════════════════════════════════════════════════════ */
describe('palabra completa: una palabra que CONTIENE una palabra clave o un bolsillo no la activa', { skip: SKIP }, () => {
  const FILAS = [
    ['compré ventana 80k nequi', 'compra', { desc: 'Ventana', buyPrice: 80000 }],            // "venta" dentro de "ventana"
    ['compras del mercado 80k', 'gasto', { valor: 80000, desc: 'Compras mercado' }],         // "compras" ≠ "compra"
    ['pagué prestamo 100k nequi', 'gasto', { valor: 100000, desc: 'Prestamo' }],             // "presté" no es "prestamo"
    ['pagué préstamo 100k nequi', 'gasto', { valor: 100000, desc: 'Préstamo', bolsillo: 'nequi' }],   // SPEC §10.2: "pagué (el) préstamo" = gasto, con tilde
    ['pagué el prestamo del banco 300k', 'gasto', { valor: 300000, desc: 'Prestamo banco' }],
    ['gasté 20k recibidor', 'gasto', { valor: 20000, desc: 'Recibidor' }],                   // "recibí" dentro de "recibidor"
    ['gasté 10k movimiento', 'gasto', { valor: 10000, desc: 'Movimiento' }],                 // "moví" dentro de "movimiento"
    ['gasté 80k fiesta', 'gasto', { valor: 80000, desc: 'Fiesta' }],                         // "fié" dentro de "fiesta"
    ['gasté 50k cashmere', 'gasto', { valor: 50000, desc: 'Cashmere', bolsillo: sinBolsillo }], // "cash" dentro de "cashmere"
    ['compré billetera 50k nequi', 'compra', { desc: 'Billetera', buyPrice: 50000, buyPocket: 'nequi' }], // "billete" dentro de "billetera"
  ];
  for (const [frase, kind, campos] of FILAS) test(`"${frase}" → ${kind}`, () => {
    const d = esperar(frase, kind, campos);
    if (/billetera|cashmere/.test(frase)) assert.notEqual(d.buyPocket || d.bolsillo, 'efectivo');
  });

  test('"pagó" con tilde = abono; "pago" sin tilde = gasto (SPEC: "pagó (con tilde)")', () => {
    esperar('juan pagó 50k nequi', 'abono', { cobroId: 'cb-juan', monto: 50000 });
    esperar('pago 50k luz nequi', 'gasto', { valor: 50000, bolsillo: 'nequi' });
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   4. Montos en cualquier forma (dictado, jerga colombiana) dentro de cada tipo
════════════════════════════════════════════════════════════════════════════ */
describe('montos: cada forma de decir plata llega entera al campo correcto de cada tipo', { skip: SKIP }, () => {
  const MONTOS = [
    ['$1.200.000', 1200000], ['1.200.000', 1200000], ['1.2M', 1200000], ['1,5 millones', 1500000], ['1 millón 200 mil', 1200000],
    ['2 palos', 2000000], ['50 lucas', 50000], ['50 barras', 50000], ['$50.000', 50000], ['$ 50.000,00', 50000],
    ['18 mil', 18000], ['850k', 850000], ['1500000', 1500000], ['12K', 12000], ['900 mil', 900000],
  ];
  const PLANTILLAS = [
    ['gasto', t => `gasté ${t} nequi`, 'valor'],
    ['compra', t => `compré ps5 ${t} nequi`, 'buyPrice'],
    ['venta', t => `vendí xbox ${t} nequi`, 'sellPrice'],
    ['ingreso', t => `me pagaron ${t} nequi`, 'valor'],
    ['cobro', t => `juan me debe ${t}`, 'total'],
    ['abono', t => `juan abonó ${t} nequi`, 'monto'],
    ['transfer', t => `retiré ${t} nequi`, 'monto'],
  ];
  for (const [kind, plantilla, campo] of PLANTILLAS) {
    test(`${kind}: ${campo} sale bien con las ${MONTOS.length} formas`, () => {
      for (const [txt, valor] of MONTOS) esperar(plantilla(txt), kind, { [campo]: valor });
    });
  }

  test('dictado típico de Chrome en es-CO (mayúsculas, "$", puntos de miles, relleno)', () => {
    esperar('Compré un PS5 por $1.200.000 con Nequi', 'compra', { desc: 'Ps5', buyPrice: 1200000, buyPocket: 'nequi', cat: 'Consolas' });
    esperar('Vendí el Xbox en 700.000 en efectivo', 'venta', { itemId: 's-xbox', sellPrice: 700000, sellPocket: 'efectivo' });
    esperar('Gasté $18.000 en almuerzo', 'gasto', { valor: 18000, desc: 'Almuerzo', cat: 'Comida' });
    esperar('Me pagaron $ 2.500.000 en Nequi', 'ingreso', { valor: 2500000, bolsillo: 'nequi' });
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   5. Con/sin tildes, mayúsculas, espacios
════════════════════════════════════════════════════════════════════════════ */
describe('tildes, mayúsculas y espacios no cambian el resultado', { skip: SKIP }, () => {
  const VARIANTES = [
    ['compré ps5 1.2M nequi', 'compre ps5 1.2M nequi', 'COMPRÉ PS5 1.2M NEQUI'],
    ['vendí xbox 700k efectivo', 'vendi xbox 700k efectivo', 'VENDÍ XBOX 700K EFECTIVO'],
    ['gasté 18 mil almuerzo', 'gaste 18 mil almuerzo', 'GASTÉ 18 MIL ALMUERZO'],
    ['pagué 25k físico', 'pague 25k fisico', 'PAGUÉ 25K FÍSICO'],
    ['retiré 100k nequi', 'retire 100k nequi', 'RETIRÉ 100K NEQUI'],
    ['saqué 50k de nequi', 'saque 50k de nequi', 'SAQUÉ 50K DE NEQUI'],
    ['pasé 30k de nequi a efectivo', 'pase 30k de nequi a efectivo', 'PASÉ 30K DE NEQUI A EFECTIVO'],
    ['moví 20k de efectivo a nequi', 'movi 20k de efectivo a nequi', 'MOVÍ 20K DE EFECTIVO A NEQUI'],
    ['transferí 90k de nequi a efectivo', 'transferi 90k de nequi a efectivo', 'TRANSFERÍ 90K DE NEQUI A EFECTIVO'],
    ['juan abonó 50k nequi', 'juan abono 50k nequi', 'JUAN ABONÓ 50K NEQUI'],
    ['maría abonó 20k', 'maria abono 20k', 'MARÍA ABONÓ 20K'],
    ['pedro me quedó debiendo 120k', 'pedro me quedo debiendo 120k', 'PEDRO ME QUEDÓ DEBIENDO 120K'],
    ['le presté 300 mil a camilo', 'le preste 300 mil a camilo', 'LE PRESTÉ 300 MIL A CAMILO'],
    ['fié 80k a pedro', 'fie 80k a pedro', 'FIÉ 80K A PEDRO'],
    ['gané 300k nequi rifa', 'gane 300k nequi rifa', 'GANÉ 300K NEQUI RIFA'],
    ['recibí 100k nequi', 'recibi 100k nequi', 'RECIBÍ 100K NEQUI'],
    ['me entró 100k nequi', 'me entro 100k nequi', 'ME ENTRÓ 100K NEQUI'],
    ['pedro me consignó 70k', 'pedro me consigno 70k', 'PEDRO ME CONSIGNÓ 70K'],
    ['gasto 5k cajón', 'gasto 5k cajon', 'GASTO 5K CAJÓN'],
  ];
  for (const [base, ...otras] of VARIANTES) test(`"${base}" = su versión sin tildes = su versión en MAYÚSCULAS`, () => {
    const ref = parse(base);
    assert.ok(KINDS_OK(ref), JSON.stringify(ref));
    for (const v of otras) assert.equal(lower(parse(v)), lower(ref), `"${v}" no da lo mismo que "${base}"`);
  });

  test('espacios de más, tabulaciones, saltos de línea y espacios duros no cambian nada', () => {
    const ref = parse('compré ps5 1.2M nequi');
    for (const v of ['  compré   ps5   1.2M   nequi  ', 'compré\tps5\t1.2M\tnequi', 'compré ps5\n1.2M\nnequi', 'compré\u00a0ps5\u00a01.2M\u00a0nequi', ' \n compré ps5 1.2M nequi \t '])
      assert.deepEqual(parse(v), ref, JSON.stringify(v));
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   6. Robustez: entradas raras, ctx, pureza, fechas
════════════════════════════════════════════════════════════════════════════ */
const RARAS = ['', ' ', '   \n\t ', 'hola', '$', '12', 'k', 'mil', 'nequi', 'efectivo', 'negocio', 'de', '🎤', '😀 compré 😀 50k', '¿?', '...',
  'compré', 'vendí', 'juan me debe', 'retiré', 'sueldo', 'abonó', 'gasté 0', 'compré ps5 0', 'compré ps5 -50k', 'x'.repeat(5000), 'compré ' + 'ps5 '.repeat(500) + '1.2M'];

describe('robustez de parseQuick', { skip: SKIP }, () => {
  test('nunca lanza con entradas raras y siempre devuelve null o un {kind, d} válido', () => {
    for (const t of RARAS) {
      let r;
      assert.doesNotThrow(() => { r = parse(t); }, `lanzó con ${JSON.stringify(t.slice(0, 40))}`);
      assert.ok(r == null || KINDS_OK(r), `${JSON.stringify(t.slice(0, 40))} → ${JSON.stringify(r)}`);
    }
  });

  test('palabras que son propiedades de Object ("constructor", "__proto__", "toString"...) no se toman por palabras clave ni bolsillos', () => {
    for (const w of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype']) {
      const d = esperar(`gasté 5k ${w}`, 'gasto', { valor: 5000, bolsillo: sinBolsillo });
      const solo = x => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');   // "__proto__" puede quedar como "proto" (se recortan signos en los bordes)
      assert.equal(solo(d.desc), solo(w), `la descripción de "${w}" quedó como ${JSON.stringify(d.desc)}`);
    }
  });

  test('sin ningún monto el campo de plata queda en 0/vacío (nunca NaN) y el tipo sale igual', () => {
    for (const [t, kind, campo] of [['compré ps5 nequi', 'compra', 'buyPrice'], ['gasté almuerzo', 'gasto', 'valor'], ['juan me debe', 'cobro', 'total'],
      ['vendí xbox', 'venta', 'sellPrice'], ['retiré nequi', 'transfer', 'monto'], ['me pagaron nequi', 'ingreso', 'valor'], ['juan abonó', 'abono', 'monto']])
      esperar(t, kind, { [campo]: sinMonto });
  });

  test('con ctx de listas vacías no lanza y los 8 tipos siguen saliendo', () => {
    for (const [t, kind] of [['compré ps5 1.2M nequi', 'compra'], ['vendí ps5 1.5M efectivo', 'venta'], ['envío 12k nequi', 'gasto'], ['juan me debe 200k', 'cobro'],
      ['juan abonó 50k nequi', 'abono'], ['retiré 100k nequi', 'transfer'], ['sueldo 1.3M nequi', 'ingreso']])
      esperar(t, kind, {}, { bolsillos: [], stock: [], cobros: [] });
  });

  test('no muta el ctx que recibe y es determinista (misma entrada → mismo resultado)', () => {
    const antes = JSON.stringify(CTX);
    const ctx = clone(CTX);
    for (const t of [...RARAS.slice(0, 20), ...Object.values(CASOS).flat().map(f => f[0])]) {
      const a = Q.parseQuick(t, ctx), b = Q.parseQuick(t, ctx);
      assert.deepEqual(a, b, `no determinista con ${JSON.stringify(t)}`);
    }
    assert.equal(JSON.stringify(ctx), antes, 'parseQuick modificó el ctx');
  });

  test('el borrador nunca trae NaN, Infinity, "undefined", "null" ni "[object Object]"; la plata es un entero >= 0', () => {
    const MONEY = ['buyPrice', 'sellPrice', 'valor', 'total', 'monto', 'targetPrice', 'sellPaid', 'pagado'];
    const frases = [...RARAS, ...Object.values(CASOS).flat().map(f => f[0])];
    for (const t of frases) {
      const r = parse(t);
      if (!r) continue;
      for (const [k, v] of Object.entries(r.d)) {
        if (typeof v === 'number') assert.ok(Number.isFinite(v), `${JSON.stringify(t.slice(0, 40))}: d.${k}=${v}`);
        if (typeof v === 'string') assert.doesNotMatch(v, /\b(undefined|null|NaN|Infinity)\b|\[object/, `${JSON.stringify(t.slice(0, 40))}: d.${k}=${JSON.stringify(v)}`);
        if (MONEY.includes(k) && v != null && v !== '') assert.ok(Number.isInteger(v) && v >= 0, `${JSON.stringify(t.slice(0, 40))}: d.${k}=${JSON.stringify(v)} no es entero >= 0`);
      }
    }
  });

  test('el tipo de gasto sale de la categoría: negocio si y solo si cat ∈ NEG_CATS (salvo que digan "negocio"/"personal")', () => {
    for (const t of ['envío 12k', 'empaques 8k', 'comisión 5k', 'comision 5k', 'publicidad 20k', 'almuerzo 18k', 'uber 12k', 'netflix 17k', 'luz 50k', 'zzz 5k', 'servientrega 9k']) {
      const d = parse(t).d;
      assert.ok(SPEC.GCATS.includes(d.cat), `${t}: cat ${JSON.stringify(d.cat)} no es de GCATS`);
      assert.equal(d.tipo, SPEC.NEG_CATS.includes(d.cat) ? 'negocio' : 'personal', `${t}: cat ${d.cat} tipo ${d.tipo}`);
    }
  });

  test('las fechas que traiga el borrador son de HOY en hora local de Colombia (a las 10:30 p. m. sigue siendo el mismo día, no el de UTC)', () => {
    const frases = [['compré ps5 1.2M nequi', CTX_SPEC], ['vendí ps5 1.5M efectivo', CTX_SPEC], ['envío 12k nequi', CTX_SPEC], ['almuerzo 18 mil', CTX_SPEC],
      ['juan me debe 200k', CTX_SPEC], ['juan abonó 50k nequi', CTX_SPEC], ['retiré 100k nequi', CTX_SPEC], ['sueldo 1.3M nequi', CTX_SPEC]];
    withNow('2026-10-05T22:30:00-05:00', () => {
      for (const [t, ctx] of frases) {
        for (const [k, v] of Object.entries(parse(t, ctx).d)) {
          if (!esFecha(v)) continue;
          assert.equal(v, '2026-10-05', `"${t}": d.${k}=${v} (en UTC ya sería 2026-10-06; las fechas deben ser locales, SPEC §6.7)`);
        }
      }
    });
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   7. Funciones exportadas: normKey, bestMatch, guessCat, guessGCat
════════════════════════════════════════════════════════════════════════════ */
describe('normKey(s)', { skip: SKIP }, () => {
  test('ignora mayúsculas, tildes y espacios de más ("reglas: id = normKey(quien)")', () => {
    assert.equal(Q.normKey('JUAN  Pérez'), Q.normKey('juan perez'));
    assert.equal(Q.normKey('  María   LÓPEZ '), Q.normKey('maria lopez'));
    assert.equal(Q.normKey('Tienda D1'), Q.normKey('tienda d1'));
  });
  test('distingue nombres distintos y no devuelve vacío para un nombre normal', () => {
    assert.notEqual(Q.normKey('Juan Pérez'), Q.normKey('Juan Gómez'));
    assert.notEqual(Q.normKey('Tienda D1'), Q.normKey('Tienda D2'));
    assert.ok(Q.normKey('MARIA LOPEZ').length > 0);
  });
  test('es idempotente y no lanza con null, undefined, vacío o números', () => {
    for (const x of ['JUAN  Pérez', 'Tienda D1', 'Ñandú', '', '   ', 'a', 'Bancolombia S.A.']) assert.equal(Q.normKey(Q.normKey(x)), Q.normKey(x), x);
    for (const x of [null, undefined, '', 0, 123]) assert.doesNotThrow(() => Q.normKey(x));
    assert.equal(Q.normKey(null), '');
    assert.equal(Q.normKey(undefined), '');
  });
  test('ignora puntuación y devuelve solo [a-z0-9 ]', () => {
    assert.equal(Q.normKey(' Tienda D1! '), Q.normKey('tienda d1'));
    assert.match(Q.normKey('Ñandú  & Cía.'), /^[a-z0-9 ]*$/);
  });
});

describe('bestMatch(q, lista, getTexto)', { skip: SKIP }, () => {
  /** El SPEC no dice qué devuelve (elemento, índice, {item}); aceptamos las tres formas y comprobamos QUÉ elemento ganó. */
  function ganador(r, lista) {
    if (r == null || r === false) return null;
    if (lista.includes(r)) return r;
    if (Number.isInteger(r) && lista[r] !== undefined) return lista[r];
    if (r && typeof r === 'object' && lista.includes(r.item)) return r.item;
    throw new assert.AssertionError({ message: `bestMatch devolvió algo que no es un elemento de la lista: ${JSON.stringify(r)}` });
  }
  const LISTA = [{ id: 1, t: 'PS5 825GB' }, { id: 2, t: 'PS5 Digital' }, { id: 3, t: 'iPhone 13 128GB' }, { id: 4, t: 'Teléfono Móvil Samsung' }, { id: 5, t: 'Zapatillas Nike Air Max' }];
  const bm = q => ganador(Q.bestMatch(q, LISTA, x => x.t), LISTA);

  test('encuentra por tokens, sin importar mayúsculas, tildes ni orden', () => {
    assert.equal(bm('iphone').id, 3);
    assert.equal(bm('IPHONE 13').id, 3);
    assert.equal(bm('13 iphone').id, 3);
    assert.equal(bm('telefono').id, 4);
    assert.equal(bm('TELÉFONO movil').id, 4);
    assert.equal(bm('nike').id, 5);
  });
  test('gana el elemento con más tokens en común', () => {
    assert.equal(bm('ps5 digital').id, 2);
    assert.equal(bm('ps5 825gb').id, 1);
    assert.equal(bm('zapatillas nike air').id, 5);
  });
  test('sin tokens en común → null/undefined (ps4 no es ps5; "tenis" no está en la lista)', () => {
    assert.equal(bm('ps4'), null);
    assert.equal(bm('tenis'), null);
    assert.equal(bm('camiseta roja'), null);
  });
  test('consulta vacía o solo espacios no coincide con todo; lista vacía no lanza', () => {
    assert.equal(bm(''), null);
    assert.equal(bm('   '), null);
    assert.equal(ganador(Q.bestMatch('ps5', [], x => x.t), []), null);
    assert.equal(ganador(Q.bestMatch('ps5', LISTA, x => x.t), LISTA) !== null, true);
  });
  test('es determinista y, ante un empate, devuelve uno de los empatados', () => {
    const E = [{ id: 'a', t: 'Funda iPhone azul' }, { id: 'b', t: 'Funda iPhone roja' }];
    const r1 = ganador(Q.bestMatch('funda iphone', E, x => x.t), E), r2 = ganador(Q.bestMatch('funda iphone', E, x => x.t), E);
    assert.ok(r1 && ['a', 'b'].includes(r1.id));
    assert.equal(r1.id, r2.id);
  });
  test('no modifica la lista', () => {
    const copia = JSON.stringify(LISTA);
    Q.bestMatch('ps5 digital', LISTA, x => x.t);
    assert.equal(JSON.stringify(LISTA), copia);
  });
});

describe('guessCat(desc) y guessGCat(desc)', { skip: SKIP }, () => {
  test('siempre devuelven una categoría válida del SPEC (y "Otro" si no reconocen nada)', () => {
    const basura = ['', ' ', 'zzzzzz', 'qwerty asdf', '12345', '🎤', null, undefined, 'x'.repeat(2000), 'constructor', '__proto__'];
    for (const x of [...basura, 'ps5', 'iphone 13', 'almuerzo', 'envío', 'uber', 'tenis nike', 'funko pop']) {
      assert.ok(SPEC.CATS.includes(Q.guessCat(x)), `guessCat(${JSON.stringify(x)}) = ${JSON.stringify(Q.guessCat(x))}`);
      assert.ok(SPEC.GCATS.includes(Q.guessGCat(x)), `guessGCat(${JSON.stringify(x)}) = ${JSON.stringify(Q.guessGCat(x))}`);
    }
    for (const x of ['zzzzzz', 'qwerty asdf', '12345', '']) { assert.equal(Q.guessCat(x), 'Otro'); assert.equal(Q.guessGCat(x), 'Otro'); }
  });
  test('los ejemplos del SPEC: ps5 → Consolas; envío → Envíos; almuerzo → Comida', () => {
    assert.equal(Q.guessCat('ps5'), 'Consolas');
    assert.equal(Q.guessCat('PS5 825GB'), 'Consolas');
    assert.equal(Q.guessGCat('envío'), 'Envíos');
    assert.equal(Q.guessGCat('envio'), 'Envíos');   // sin tilde
    assert.equal(Q.guessGCat('Envío Servientrega'), 'Envíos');
    assert.equal(Q.guessGCat('almuerzo'), 'Comida');
    assert.equal(Q.guessGCat('ALMUERZO'), 'Comida');
  });
  const OBVIAS_CAT = [['iphone 13 128gb', 'Celulares'], ['samsung a54', 'Celulares'], ['xbox series s', 'Consolas'], ['nintendo switch', 'Consolas'],
    ['macbook air', 'Computadores'], ['portatil lenovo', 'Computadores'], ['audífonos', 'Accesorios'], ['cargador', 'Accesorios'], ['camiseta', 'Ropa'], ['jean', 'Ropa'],
    ['tenis nike', 'Calzado'], ['zapatillas', 'Calzado'], ['funko pop', 'Coleccionables'], ['carta pokemon', 'Coleccionables'], ['moto', 'Moto/Auto']];
  const OBVIAS_GCAT = [['empaques', 'Empaques'], ['bolsas', 'Empaques'], ['comisión', 'Comisiones'], ['comision', 'Comisiones'], ['publicidad', 'Publicidad'],
    ['uber', 'Transporte'], ['taxi', 'Transporte'], ['gasolina', 'Transporte'], ['mantenimiento', 'Mantenimiento'], ['internet', 'Servicios'], ['luz', 'Servicios'],
    ['netflix', 'Entretenimiento'], ['cine', 'Entretenimiento']];
  for (const [d, c] of OBVIAS_CAT) test(`guessCat("${d}") → ${c}`, () => assert.equal(Q.guessCat(d), c));
  for (const [d, c] of OBVIAS_GCAT) test(`guessGCat("${d}") → ${c}`, () => assert.equal(Q.guessGCat(d), c));
});

/* ════════════════════════════════════════════════════════════════════════════
   8. Propiedades con semilla fija: frases generadas al azar, con permutaciones de orden,
      tildes, mayúsculas y todas las formas de decir un monto
════════════════════════════════════════════════════════════════════════════ */
describe('propiedades (frases generadas, semilla fija)', { skip: SKIP }, () => {
  const PROD = ['ps5', 'xbox', 'iphone', 'audifonos', 'cargador', 'portatil', 'funko', 'teclado', 'mouse', 'reloj', 'gorra', 'maleta', 'lampara', 'parlante', 'tablet'];
  const EN_STOCK = PROD.slice(0, 8), NO_STOCK = PROD.slice(8);
  const NOMBRES = ['juan', 'maria', 'camilo', 'pedro'];
  const ID_COBRO = { juan: 'cb-juan', maria: 'cb-maria', camilo: 'cb-camilo', pedro: 'cb-pedro' };
  const TEXTO_BOLSILLO = { efectivo: ['efectivo', 'cash', 'físico', 'billete'], nequi: ['nequi'], 'b-bcol': ['bancolombia'], 'b-cajon': ['cajón'] };
  const IDS = Object.keys(TEXTO_BOLSILLO);
  const CTX_F = {
    bolsillos: BOLS,
    stock: EN_STOCK.map((p, i) => ({ id: `s${i}`, desc: `${p[0].toUpperCase()}${p.slice(1)} ${['825gb', 'pro', 'negro', 'v2'][i % 4]}` })),
    cobros: COBROS,
  };
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const barajar = (R, a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = R.int(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  function monto(R) {
    const t = R.int(0, 5);
    if (t === 0) { const k = R.int(1, 999); return [`${k}k`, k * 1000]; }
    if (t === 1) { const k = R.int(1, 999); return [`${k} mil`, k * 1000]; }
    if (t === 2) { const n = R.int(10, 9999) * 1000; return ['$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'), n]; }   // $1.230.000
    if (t === 3) { const x = R.int(1, 99); return [`${(x / 10).toFixed(1)}M`, x * 100000]; }                               // 1.2M
    if (t === 4) { const x = R.int(1, 99); return [`${(x / 10).toFixed(1).replace('.', ',')} millones`, x * 100000]; }     // 1,5 millones
    let n; do n = R.int(1000, 9999999); while (n >= 1900 && n <= 2099);                                                    // 1500000 (evita años)
    return [String(n), n];
  }

  /** Genera una frase y lo que debe salir de ella. `sinTilde:false` si la palabra clave depende de la tilde ("pagó"). */
  function generar(R, kind) {
    const [mt, mv] = monto(R);
    const pid = R.pick(IDS), ptxt = R.pick(TEXTO_BOLSILLO[pid]);
    const p = R.pick(PROD);
    let piezas, campos, sinTilde = true;
    switch (kind) {
      case 'compra':
        piezas = [R.pick(['compré', 'compre', 'compra']), p, mt, ptxt]; campos = { desc: cap(p), buyPrice: mv, buyPocket: pid }; break;
      case 'venta': {
        const hay = R.chance(0.6), q = hay ? R.pick(EN_STOCK) : R.pick(NO_STOCK);
        piezas = [R.pick(['vendí', 'vendi', 'venta', 'vendido']), q, mt, ptxt];
        campos = hay ? { itemId: `s${EN_STOCK.indexOf(q)}`, sellPrice: mv, sellPocket: pid } : { itemId: '__nuevo', desc: cap(q), sellPrice: mv, sellPocket: pid };
        break;
      }
      case 'gasto':
        piezas = [R.pick(['gasté', 'gaste', 'gasto', 'pagué', 'pague', 'pago', 'pagar', '']), p, mt, ptxt].filter(x => x !== '');
        campos = { desc: cap(p), valor: mv, bolsillo: pid }; break;
      case 'ingreso':
        piezas = [R.pick(['ingreso', 'me pagaron', 'recibí', 'recibi', 'me entró', 'me entro', 'gané', 'gane']), p, mt, ptxt]; campos = { desc: cap(p), valor: mv, bolsillo: pid }; break;
      case 'cobro': {
        const n = R.pick(NOMBRES);
        piezas = [R.pick(['me debe', 'me quedó debiendo', 'me quedo debiendo', 'le presté', 'le preste', 'presté', 'preste', 'fié', 'fie', 'fiado']), n, mt];
        campos = { nombre: cap(n), total: mv }; break;
      }
      case 'abono': {
        const n = R.pick(NOMBRES), kw = R.pick(['abonó', 'abono', 'me pagó', 'me dio', 'me consignó', 'me consigno', 'pagó']);
        if (/pagó/.test(kw)) sinTilde = false;
        piezas = [kw, n, mt, ptxt]; campos = { cobroId: ID_COBRO[n], monto: mv, bolsillo: pid }; break;
      }
      default: { // transfer
        const de = R.pick(IDS), a = R.pick(IDS.filter(i => i !== de));
        const bloque = `de ${R.pick(TEXTO_BOLSILLO[de])} a ${R.pick(TEXTO_BOLSILLO[a])}`;
        piezas = [R.pick(['retiré', 'saqué', 'pasé', 'moví', 'transferí']), mt, bloque]; campos = { from: de, to: a, monto: mv };
      }
    }
    return { frase: barajar(R, piezas).join(' '), kind, campos, sinTilde };
  }

  const sinTildes = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const kind of SPEC.KINDS) {
    test(`${kind}: 150 frases al azar (orden, monto y bolsillo variables) dan el tipo y los campos esperados, también sin tildes, en MAYÚSCULAS y con inicial mayúscula`, () => {
      const R = rng(20261005 + SPEC.KINDS.indexOf(kind));
      for (let i = 0; i < 150; i++) {
        const g = generar(R, kind);
        const pre = core.extractMonto(g.frase).monto;
        assert.ok(pre === g.campos.monto || pre === g.campos.valor || pre === g.campos.buyPrice || pre === g.campos.sellPrice || pre === g.campos.total, `precondición: core.extractMonto(${JSON.stringify(g.frase)}) = ${pre}`);
        const base = parse(g.frase, CTX_F);
        assert.equal(base.kind, g.kind, `"${g.frase}" → ${JSON.stringify(base)}`);
        for (const [k, v] of Object.entries(g.campos)) assert.ok(coincide(k, base.d[k], v), `"${g.frase}" → d.${k}=${JSON.stringify(base.d[k])}; esperado ${JSON.stringify(v)}\n  ${JSON.stringify(base)}`);
        const variantes = [g.frase.toUpperCase(), g.frase.charAt(0).toUpperCase() + g.frase.slice(1)];
        if (g.sinTilde) variantes.push(sinTildes(g.frase));
        for (const v of variantes) assert.equal(lower(parse(v, CTX_F)), lower(base), `"${v}" no da lo mismo que "${g.frase}"`);
      }
    });
  }
});

/* ════════════════════════════════════════════════════════════════════════════
   9. Dictado natural y ambigüedades (comportamiento decidido; antes eran "todo")
════════════════════════════════════════════════════════════════════════════ */
describe('dictado natural y ambigüedades', { skip: SKIP }, () => {
  test('"sueldo 1.3M nequi" deja la descripción "Sueldo" (el formulario de ingreso la pide)', () => {
    esperar('sueldo 1.3M nequi', 'ingreso', { valor: 1300000, desc: 'Sueldo', bolsillo: 'nequi' });
    esperar('salario 2M nequi', 'ingreso', { valor: 2000000, desc: 'Salario' });
  });
  test('"pasé 100 mil del efectivo al nequi" (del/al = de+el, a+el)', () => {
    esperar('pasé 100 mil del efectivo al nequi', 'transfer', { from: 'efectivo', to: 'nequi', monto: 100000 });
    esperar('saqué 50 mil del nequi al efectivo', 'transfer', { from: 'nequi', to: 'efectivo', monto: 50000 });
  });
  test('"pasé 100k a efectivo de nequi" (orden invertido): from/to salen de las preposiciones, no del orden', () => {
    esperar('pasé 100k a efectivo de nequi', 'transfer', { from: 'nequi', to: 'efectivo', monto: 100000 });
    esperar('pasé 100k a nequi de efectivo', 'transfer', { from: 'efectivo', to: 'nequi', monto: 100000 });
  });
  test('"moví 50k a nequi": desde y hacia no son el mismo bolsillo (el formulario exige distintos, §6.2)', () => {
    const d = esperar('moví 50k a nequi', 'transfer', { to: 'nequi', monto: 50000 });
    assert.notEqual(d.from, d.to);
    const e = esperar('moví 50k de nequi', 'transfer', { from: 'nequi', monto: 50000 });
    assert.notEqual(e.from, e.to);
  });
  test('puntuación pegada al final (punto, coma) no impide encontrar bolsillo ni monto', () => {
    esperar('gasté 18 mil almuerzo con efectivo.', 'gasto', { valor: 18000, bolsillo: 'efectivo', desc: 'Almuerzo' });
    esperar('Compré un PS5 por 1.2M, con Nequi.', 'compra', { buyPrice: 1200000, buyPocket: 'nequi', desc: 'Ps5' });
    esperar('Retiré 100 mil de Nequi.', 'transfer', { from: 'nequi', to: 'efectivo', monto: 100000 });
  });
  test('"vendí xbox 700k a juan fiado" es una venta (a crédito), no un cobro', () => {
    esperar('vendí xbox 700k a juan fiado', 'venta', { sellPrice: 700000, itemId: v => ['s-xbox', '__nuevo'].includes(v) });   // el producto exacto depende de cómo se trate el nombre del cliente
  });
  test('con "iPhone 13 Pro" y "iPhone 13" en stock, "iphone 13" elige el más ajustado', () => {
    const ctx = { bolsillos: [EFE, NEQ], cobros: [], stock: [{ id: 'pro', desc: 'iPhone 13 Pro 256GB' }, { id: 'std', desc: 'iPhone 13 128GB' }] };
    esperar('vendí iphone 13 900k nequi', 'venta', { itemId: 'std' }, ctx);
    esperar('vendí iphone 13 pro 1.5M nequi', 'venta', { itemId: 'pro' }, ctx);
  });
  test('parseQuick(texto) sin ctx no lanza', () => {
    assert.ok(KINDS_OK(Q.parseQuick('gasté 5k')));
    assert.ok(KINDS_OK(Q.parseQuick('vendí ps5 1.5M', {})));
  });
});
