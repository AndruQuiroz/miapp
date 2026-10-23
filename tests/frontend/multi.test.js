'use strict';
/**
 * SPEC §11: parseQuickMulti (varias operaciones en una frase, parte de pago, montos cortos en millones) y guessCat de celulares.
 *   node --test tests/frontend/multi.test.js
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Q = require(path.resolve(__dirname, '../../app/quick.js'));

const CTX = {
  bolsillos: [{ id: 'efectivo', nombre: 'Efectivo' }, { id: 'nequi', nombre: 'Nequi' }],
  stock: [{ id: 'it-ps5', desc: 'PS5 Slim 1TB' }, { id: 'it-tenis', desc: 'Tenis Jordan 1' }],
  cobros: [{ id: 'cb-juan', nombre: 'Juan' }],
};
const M = (t, ctx = CTX) => Q.parseQuickMulti(t, ctx);
const kinds = r => r.map(x => x.kind).join(',');
function has(d, campos, t) {
  for (const [k, v] of Object.entries(campos)) assert.deepEqual(d[k], v, `${t} → d.${k} = ${JSON.stringify(d[k])}; esperado ${JSON.stringify(v)}`);
}

const USUARIO = 'compre un 17 pro max en 3 y lo vendi en 2M y un 16 pro max valorado como compra en 2,1';

describe('§11.1–11.2: la frase real del usuario', () => {
  for (const t of [USUARIO, 'compré un 17 pro max en 3 y lo vendí en 2M y un 16 pro max valorado como compra en 2,1',
    'Compré un 17 Pro Max en 3, y lo vendí en 2M y un 16 Pro Max valorado como compra en 2,1']) {
    test(t, () => {
      const r = M(t);
      assert.equal(kinds(r), 'compra,venta', JSON.stringify(r));
      has(r[0].d, { desc: '17 Pro Max', cat: 'Celulares', buyPrice: 3000000 }, t);
      assert.equal(r[0].d.buyPocket, undefined, 'no se dijo el bolsillo: se elige en la hoja');
      has(r[1].d, { itemId: '__prev', desc: '17 Pro Max', sellPrice: 2000000 }, t);
      assert.deepEqual(r[1].d.tradeIn, { desc: '16 Pro Max', valor: 2100000, cat: 'Celulares' });
    });
  }
});

describe('§11.1: frases compuestas', () => {
  const CASOS = [
    ['compré iphone 15 por 3 millones y la vendí en 3.5 nequi', 'compra,venta', [{ buyPrice: 3000000, cat: 'Celulares', desc: 'iPhone 15' }, { itemId: '__prev', sellPrice: 3500000, sellPocket: 'nequi' }]],
    ['compré iphone 14 en 2 y la vendí en 2.5M nequi', 'compra,venta', [{ buyPrice: 2000000 }, { itemId: '__prev', sellPrice: 2500000, sellPocket: 'nequi' }]],
    ['compré ps5 en 2 y la vendí en 2.4 efectivo', 'compra,venta', [{ buyPrice: 2000000, cat: 'Consolas' }, { itemId: '__prev', sellPrice: 2400000, sellPocket: 'efectivo' }]],
    ['compre un 17 pro max en 3 y lo vendi en 4', 'compra,venta', [{ buyPrice: 3000000 }, { itemId: '__prev', sellPrice: 4000000 }]],
    ['compré tenis 100k nequi, luego gasté 12k en envío', 'compra,gasto', [{ buyPrice: 100000, buyPocket: 'nequi', cat: 'Calzado' }, { valor: 12000, cat: 'Envíos', tipo: 'negocio' }]],
    ['retiré 100k nequi y gasté 20k en taxi efectivo', 'transfer,gasto', [{ from: 'nequi', to: 'efectivo', monto: 100000 }, { valor: 20000, bolsillo: 'efectivo' }]],
    ['compré iphone 13 en 1.5 nequi y otro iphone 12 en 1.1', 'compra,compra', [{ buyPrice: 1500000, buyPocket: 'nequi' }, { buyPrice: 1100000, desc: 'iPhone 12' }]],
    ['vendí tenis 250k efectivo y después compré camiseta 40k nequi', 'venta,compra', [{ itemId: 'it-tenis', sellPrice: 250000 }, { buyPrice: 40000, cat: 'Ropa' }]],
  ];
  for (const [t, k, ds] of CASOS) test(t, () => {
    const r = M(t);
    assert.equal(kinds(r), k, JSON.stringify(r));
    ds.forEach((c, i) => has(r[i].d, c, t));
  });
});

describe('§11.1: parte de pago', () => {
  test('"vendí el 16 pro max y me dio 1M y un 15 pro de 1.8" → plata 1M + 15 Pro de 1.8M', () => {
    const r = M('vendí el 16 pro max y me dio 1M y un 15 pro de 1.8');
    assert.equal(kinds(r), 'venta');
    has(r[0].d, { sellPrice: 1000000 }, 'me dio');
    assert.deepEqual(r[0].d.tradeIn, { desc: '15 Pro', valor: 1800000, cat: 'Celulares' });
  });
  test('"vendí la ps5 en 2M y me lo cambiaron por un xbox de 1.5" (producto del stock)', () => {
    const r = M('vendí la ps5 en 2M y me lo cambiaron por un xbox de 1.5');
    has(r[0].d, { itemId: 'it-ps5', sellPrice: 2000000 }, 'xbox');
    assert.deepEqual(r[0].d.tradeIn, { desc: 'Xbox', valor: 1500000, cat: 'Consolas' });
  });
  test('"vendí ps5 en 2.5M más un control como parte de pago en 80k"', () => {
    const r = M('vendí ps5 en 2.5M más un control como parte de pago en 80k');
    has(r[0].d, { itemId: 'it-ps5', sellPrice: 2500000 }, 'control');
    assert.equal(r[0].d.tradeIn.valor, 80000);
    assert.equal(r[0].d.tradeIn.cat, 'Accesorios');
  });
});

describe('NO se parte (la "y" es parte del segmento)', () => {
  test('"compré funda y vidrio 30k" → 1 compra', () => {
    const r = M('compré funda y vidrio 30k');
    assert.equal(r.length, 1); has(r[0].d, { buyPrice: 30000, desc: 'Funda vidrio' }, 'funda');
  });
  test('"gasté 2 millones y 500 mil en arriendo" → 1 gasto de 2.5M', () => {
    const r = M('gasté 2 millones y 500 mil en arriendo');
    assert.equal(r.length, 1); has(r[0].d, { valor: 2500000 }, 'arriendo');
  });
  test('en categorías baratas un número suelto NO es millones', () => {
    const r = M('compré camiseta en 3');
    assert.ok(!(r[0].d.buyPrice >= 1000000), JSON.stringify(r));
  });
});

describe('frases simples: 1 elemento, igual que parseQuick', () => {
  for (const t of ['almuerzo 18 mil', 'compré ps5 1.2M nequi', 'vendí ps5 1.5M efectivo', 'envío 12k nequi', 'juan me debe 200k', 'juan abonó 50k nequi',
    'retiré 100k nequi', 'sueldo 1.3M nequi', 'pagué el préstamo 100k nequi', 'le presté 300k a juan de dios', 'gasté 5k __proto__', '', '50k']) {
    test(JSON.stringify(t), () => assert.deepEqual(M(t), [Q.parseQuick(t, CTX)]));
  }
});

describe('§11.3 guessCat de celulares', () => {
  for (const [t, c] of [['17 pro max', 'Celulares'], ['16 Pro Max', 'Celulares'], ['15 pro', 'Celulares'], ['galaxy s23', 'Celulares'], ['a54', 'Celulares'],
    ['redmi note 13', 'Celulares'], ['iphone 13 plus', 'Celulares'], ['funda 15 pro max', 'Accesorios'], ['ps5 pro', 'Consolas'], ['macbook pro', 'Computadores']]) {
    test(`${t} → ${c}`, () => assert.equal(Q.guessCat(t), c));
  }
});

/* Ronda 3b: variantes naturales (pedido del lead) — reglas generales, no frase por frase */
describe('parte de pago: cualquier forma de "recibir" + de/en/por/valorado/avaluado N', () => {
  const CASOS = [
    ['vendí la ps5 en 1.8 y me dieron un xbox series x de 1.5', { itemId: 'it-ps5', sellPrice: 1800000 }, { desc: 'Xbox Series X', valor: 1500000, cat: 'Consolas' }],
    ['vendí el 14 en 1.6 y me dejaron un 12 de 700 mil', { itemId: '__nuevo', desc: 'iPhone 14', cat: 'Celulares', sellPrice: 1600000 }, { desc: 'iPhone 12', valor: 700000, cat: 'Celulares' }],
    ['vendí la ps5 en 1.8 y recibí un xbox de 1.5', { itemId: 'it-ps5', sellPrice: 1800000 }, { desc: 'Xbox', valor: 1500000, cat: 'Consolas' }],
    ['vendí el 13 pro en 1.5 y me lo pagaron con un 11 de 600 mil', { sellPrice: 1500000, cat: 'Celulares' }, { desc: 'iPhone 11', valor: 600000, cat: 'Celulares' }],
    ['vendí ps5 en 2M + un control de 80k', { itemId: 'it-ps5', sellPrice: 2000000 }, { desc: 'Control', valor: 80000, cat: 'Accesorios' }],
    ['vendí ps5 en 2M y me entregaron un xbox avaluado en 1.4', { sellPrice: 2000000 }, { desc: 'Xbox', valor: 1400000, cat: 'Consolas' }],
    ['vendí el 15 pro en 2.5 y me pasaron un 13 por 900 mil efectivo', { sellPrice: 2500000, sellPocket: 'efectivo' }, { desc: 'iPhone 13', valor: 900000, cat: 'Celulares' }],
  ];
  for (const [t, venta, ti] of CASOS) test(t, () => {
    const r = M(t);
    assert.equal(kinds(r), 'venta', JSON.stringify(r));
    has(r[0].d, venta, t);
    assert.deepEqual(r[0].d.tradeIn, ti);
  });
  test('"vendí la ps5 con control en 2M" NO tiene parte de pago (el control iba con la consola)', () => {
    const r = M('vendí la ps5 con control en 2M');
    assert.equal(r.length, 1); assert.ok(!r[0].d.tradeIn); has(r[0].d, { itemId: 'it-ps5', sellPrice: 2000000 }, 'con control');
  });
});

describe('se parte cuando AMBOS lados tienen su monto; el bolsillo del final vale para todos', () => {
  const CASOS = [
    ['almuerzo 18 mil y envío 12k nequi', 'gasto,gasto', [{ desc: 'Almuerzo', valor: 18000, bolsillo: 'nequi' }, { desc: 'Envío', valor: 12000, tipo: 'negocio', bolsillo: 'nequi' }]],
    ['taxi 15k, almuerzo 20 mil y gaseosa 4 mil efectivo', 'gasto,gasto,gasto', [{ valor: 15000, cat: 'Transporte', bolsillo: 'efectivo' }, { valor: 20000, cat: 'Comida', bolsillo: 'efectivo' }, { valor: 4000, bolsillo: 'efectivo' }]],
    ['gasté 30k en mercado; bus 8 mil nequi', 'gasto,gasto', [{ valor: 30000, bolsillo: undefined }, { valor: 8000, cat: 'Transporte', bolsillo: 'nequi' }]],
    ['compré iphone 13 en 1.5M y un cargador de 50k nequi', 'compra,compra', [{ desc: 'iPhone 13', buyPrice: 1500000, buyPocket: undefined }, { desc: 'Cargador', buyPrice: 50000, cat: 'Accesorios', buyPocket: 'nequi' }]],
    ['almuerzo 18 mil efectivo y envío 12k nequi', 'gasto,gasto', [{ bolsillo: 'efectivo' }, { bolsillo: 'nequi' }]],
  ];
  for (const [t, k, ds] of CASOS) test(t, () => {
    const r = M(t);
    assert.equal(kinds(r), k, JSON.stringify(r));
    ds.forEach((c, i) => has(r[i].d, c, t));
  });
  for (const [t, campos] of [['compré funda y vidrio 30k', { buyPrice: 30000 }], ['gasté 2 millones y 500 mil en arriendo', { valor: 2500000 }],
    ['pan y leche 9 mil', { valor: 9000 }], ['vendí ps5 2M y me dieron un xbox de 1.5M', { sellPrice: 2000000 }]]) {
    test(`NO se parte: ${t}`, () => { const r = M(t); assert.equal(r.length, 1, JSON.stringify(r)); has(r[0].d, campos, t); });
  }
});

describe('"c/u": cantidad × precio por unidad (decisión del frontend: el total es lo que salió del bolsillo)', () => {
  test('"compré 2 controles a 150k c/u" → 1 compra de $300.000 con la nota "2 × $150.000 c/u"', () => {
    const r = M('compré 2 controles a 150k c/u');
    assert.equal(kinds(r), 'compra');
    has(r[0].d, { buyPrice: 300000, notes: '2 × $150.000 c/u', cat: 'Accesorios' }, 'c/u');
  });
  test('"3 empanadas a 3 mil cada una" → gasto de $9.000', () => has(M('3 empanadas a 3 mil cada una')[0].d, { valor: 9000 }, 'cada una'));
});

describe('el bolsillo del final NO salta a un segmento con su propio verbo', () => {
  test('"compre un portatil lenovo en 1.9 y lo vendi en 2.4 nequi" → la compra queda sin bolsillo (lo pide la hoja)', () => {
    const r = M('compre un portatil lenovo en 1.9 y lo vendi en 2.4 nequi');
    assert.equal(kinds(r), 'compra,venta');
    has(r[0].d, { buyPrice: 1900000, cat: 'Computadores', buyPocket: undefined }, 'compra');
    has(r[1].d, { itemId: '__prev', sellPrice: 2400000, sellPocket: 'nequi' }, 'venta');
  });
  test('"gasolina 20 mil, parqueadero 5 mil y almuerzo 18 mil efectivo" → efectivo para los tres', () => {
    const r = M('gasolina 20 mil, parqueadero 5 mil y almuerzo 18 mil efectivo');
    assert.equal(kinds(r), 'gasto,gasto,gasto');
    r.forEach(x => assert.equal(x.d.bolsillo, 'efectivo'));
  });
  test('modelo solo numérico 11–17 = iPhone: "me entregaron un 11 de 600 mil"', () => {
    const r = M('vendí el 13 pro en 1.5 y me entregaron un 11 de 600 mil');
    assert.equal(r[0].d.tradeIn.desc, 'iPhone 11');
    assert.equal(r[0].d.desc, '13 Pro', 'con más palabras que el número no se toca');
    assert.equal(M('compré un 15 en 2 y lo vendí en 2.6 efectivo')[0].d.desc, 'iPhone 15');
  });
});
