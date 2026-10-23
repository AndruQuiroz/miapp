'use strict';
/**
 * SPEC §14 (ronda 5) en app/core.js: normModelo, itemHistory, priceRef, topesEstado, monthInsight, contactoStats
 * y los textos (remindersText / summaryText). "Hoy" = 2026-10-05 10:00 Bogotá (helpers/clock.js).
 *   node --test tests/core.r5.test.js
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { hoy, withNow } = require('./helpers/clock');
const core = require('./helpers/core');
const B = require('./helpers/builders');

const { COLS, emptyDB, mergeDB, normModelo, itemHistory, priceRef, topesEstado, monthInsight, contactoStats, remindersText, summaryText } = core;
const { makeDB } = B;

describe('normModelo', () => {
  const PARES = [
    ['iPhone 15 Pro 256GB azul', 'iphone 15 pro'],
    ['15 pro', 'iphone 15 pro'],
    ['iphone 15 pro 128 gb usado', 'iphone 15 pro'],
    ['IPHONE 13 PRO MAX', 'iphone 13 pro max'],
    ['13 promax', 'iphone 13 pro max'],
    ['iphone 13 pm de 256', 'iphone 13 pro max'],
    ['iPhone 11 64GB batería 89%', 'iphone 11'],
    ['iphone 11 con 89% de bateria', 'iphone 11'],
    ['ip 12 mini', 'iphone 12 mini'],
    ['16 plus rosado', 'iphone 16 plus'],
    ['iPhone 16', 'iphone 16'],
    ['iphone 17 pro max titanio natural original', 'iphone 17 pro max'],
    ['iphone xr', 'iphone xr'],
    ['iPhone 14 negro liberado', 'iphone 14'],
    ['s23', 'samsung s23'],
    ['Samsung Galaxy S23 Ultra 256', 'samsung s23 ultra'],
    ['samsung s23 ultra 12/512', 'samsung s23 ultra'],
    ['A54 negro', 'samsung a54'],
    ['Samsung A14', 'samsung a14'],
    ['zflip 5', 'samsung z flip 5'],
    ['Galaxy Z Fold 5', 'samsung z fold 5'],
    ['ps5 slim', 'ps5'],
    ['PlayStation 5 digital', 'ps5'],
    ['play 5 con lector', 'ps5'],
    ['PS 4', 'ps4'],
    ['PS4 Pro 1TB', 'ps4 pro'],
    ['Xbox Series S 512GB', 'xbox series s'],
    ['xbox serie x', 'xbox series x'],
    ['series x', 'xbox series x'],
    ['Nintendo Switch OLED blanca', 'switch oled'],
    ['oled', 'switch oled'],
    ['switch lite', 'switch lite'],
    ['MacBook Air M1 8/256', 'macbook air m1'],
    ['mac book pro m2', 'macbook pro m2'],
    ['Tenis Jordan 4 Retro talla 42', 'jordan 4'],
    ['tenis air jordan 4 negros', 'jordan 4'],
    ['Nike Air Force 1 blancos', 'air force 1'],
    ['Redmi Note 12', 'redmi note 12'],
    ['Funko Pop Batman', 'funko pop batman'],
    ['', ''],
  ];
  for (const [entrada, esperado] of PARES) {
    test(`"${entrada}" → "${esperado}"`, () => assert.equal(normModelo(entrada), esperado));
  }
  test('null/undefined/números no revientan', () => {
    assert.equal(normModelo(null), '');
    assert.equal(normModelo(undefined), '');
    assert.equal(normModelo(5), normModelo('5'));
  });
});

describe('itemHistory', () => {
  const base = () => makeDB({
    contactos: [{ id: 'k1', nombre: 'Mateo', tel: '3001112233', tipo: 'cliente', u: 5 }],
    items: [
      B.sold({ id: 'v', desc: 'iPhone 17 Pro Max', buyPrice: 3000000, buyPocket: 'nequi', buyDate: '2026-09-01', sellPrice: 4100000, sellPaid: 2000000, sellPocket: 'efectivo', sellDate: '2026-09-11', tradeInId: 'ti', clienteId: 'k1', proveedor: 'Un man de Bello' }),
      B.item({ id: 'ti', desc: '16 Pro Max', buyPrice: 2100000, buyPocket: '', buyDate: '2026-09-11', fromTradeOf: 'v' }),
      B.sold({ id: 'cred', desc: 'PS5', buyPrice: 1800000, buyPocket: 'nequi', buyDate: '2026-09-01', sellPrice: 2200000, sellPaid: 1200000, sellPocket: 'nequi', sellDate: '2026-09-20', cliente: 'Laura' }),
      B.item({ id: 'vuelta', desc: 'Xbox', buyPrice: 800000, buyPocket: 'nequi', buyDate: '2026-09-25', status: 'stock', sellPrice: 900000, sellDate: '2026-09-28' }),
    ],
    gastos: [
      B.gasto({ id: 'g1', desc: 'Cambio de batería', valor: 150000, itemId: 'v', tipo: 'negocio', fecha: '2026-09-05' }),
      B.gasto({ id: 'g2', desc: 'Envío', valor: 20000, itemId: 'v', tipo: 'negocio', fecha: '2026-09-11' }),
      B.gasto({ id: 'g3', desc: 'Borrado', valor: 999, itemId: 'v', del: 1 }),
      B.gasto({ id: 'g4', desc: 'Limpieza', valor: 30000, itemId: 'ti', fecha: '2026-09-15' }),
    ],
    cobros: [B.cobro({ id: 'c1', nombre: 'Laura', total: 1000000, itemId: 'cred' })],
    abonos: [B.abono({ cobroId: 'c1', monto: 400000 })],
  });

  test('venta con parte de pago y arreglos: costo real, ganancia, margen, días, cliente, proveedor y lo recibido', () => {
    const h = itemHistory(base(), 'v');
    assert.deepEqual(h.costosExtra.map(g => g.id), ['g1', 'g2'], 'solo gastos vivos, en orden de fecha');
    assert.equal(h.costoTotal, 3000000 + 150000 + 20000);
    assert.deepEqual(h.venta, { precio: 4100000, pagado: 2000000, fecha: '2026-09-11', bolsillo: 'efectivo', cliente: 'Mateo' });
    assert.equal(h.ganancia, 4100000 - 3170000);
    assert.ok(Math.abs(h.margen - 930000 / 4100000 * 100) < 1e-9);
    assert.equal(h.dias, 10);
    assert.equal(h.recibido.id, 'ti');
    assert.equal(h.origen, null);
    assert.equal(h.cobro, null, 'la parte de pago NO es un cobro');
    assert.equal(h.proveedor, 'Un man de Bello');
  });

  test('producto recibido en parte de pago: su costo es el valor estimado (buyPrice) + sus arreglos; origen = la venta', () => {
    const h = hoy(() => itemHistory(base(), 'ti'));
    assert.equal(h.costoTotal, 2100000 + 30000);
    assert.equal(h.origen.id, 'v');
    assert.equal(h.venta, null);
    assert.equal(h.ganancia, null);
    assert.equal(h.margen, null);
    assert.equal(h.dias, 24, 'del 11-sep a hoy (5-oct)');
  });

  test('venta a crédito: trae el cobro con lo abonado y lo pendiente; cliente por texto', () => {
    const h = itemHistory(base(), 'cred');
    assert.equal(h.venta.pagado, 1200000);
    assert.equal(h.venta.cliente, 'Laura');
    assert.equal(h.ganancia, 400000);
    assert.equal(h.cobro.id, 'c1');
    assert.equal(h.cobro.pag, 400000);
    assert.equal(h.cobro.pend, 600000);
  });

  test('devuelto a stock (status stock aunque quedó sellPrice): sin venta ni ganancia; días hasta hoy', () => {
    const h = hoy(() => itemHistory(base(), 'vuelta'));
    assert.equal(h.venta, null);
    assert.equal(h.ganancia, null);
    assert.equal(h.dias, 10);
  });

  test('inexistente → null; no muta la base', () => {
    const db = base();
    const antes = JSON.stringify(db);
    assert.equal(itemHistory(db, 'nada'), null);
    itemHistory(db, 'v');
    assert.equal(JSON.stringify(db), antes);
  });
});

describe('priceRef', () => {
  const db = () => makeDB({
    items: [
      B.sold({ desc: 'iPhone 13 128GB', buyPrice: 1600000, buyDate: '2026-06-01', sellPrice: 2000000, sellDate: '2026-06-10' }),
      B.sold({ desc: 'iphone 13 azul', buyPrice: 1700000, buyDate: '2026-07-01', sellPrice: 2100000, sellDate: '2026-07-15' }),
      B.sold({ desc: '13 usado', buyPrice: 1500000, buyDate: '2026-08-01', sellPrice: 1950000, sellDate: '2026-08-20' }),
      B.sold({ desc: 'iPhone 13 256', buyPrice: 1800000, buyDate: '2026-09-01', sellPrice: 2250000, sellDate: '2026-09-21' }),
      B.item({ desc: 'iphone 13 negro', buyPrice: 1650000, buyDate: '2026-10-01' }),
      B.sold({ desc: 'iPhone 13', buyPrice: 100, sellPrice: 99999999, sellDate: '2026-10-01', del: 1 }),  // borrado: no cuenta
      B.sold({ desc: 'PS5', buyPrice: 1000000, sellPrice: 1300000, sellDate: '2026-09-01' }),
    ],
    gastos: [],
  });

  test('compras, ventas, ganancia y días promedio del modelo; sugerido = prom. de las 3 ventas más recientes redondeado a $10.000', () => {
    const d = db();
    const iph = d.items.find(i => i.desc === 'iPhone 13 256');
    d.gastos.push(B.gasto({ valor: 50000, itemId: iph.id, tipo: 'negocio' }));
    const r = priceRef(d, 'iphone 13 de 128');
    assert.equal(r.modelo, 'iphone 13');
    assert.equal(r.items.length, 5);
    assert.deepEqual(r.compras, { n: 5, prom: 1650000, min: 1500000, max: 1800000, ultima: { precio: 1650000, fecha: '2026-10-01' } });
    assert.deepEqual(r.ventas, { n: 4, prom: 2075000, min: 1950000, max: 2250000, ultima: { precio: 2250000, fecha: '2026-09-21' } });
    // ganancias: 400K, 400K, 450K, 450K − 50K (arreglo) = 400K → prom 412.500
    assert.equal(r.gananciaProm, 412500);
    assert.equal(r.diasProm, Math.round((9 + 14 + 19 + 20) / 4));
    // 3 más recientes: 2.250.000, 1.950.000, 2.100.000 → 2.100.000
    assert.equal(r.sugeridoVenta, 2100000);
  });

  test('sin ventas del modelo: costo prom × (1 + margen del usuario); sin ventas en general: × 1,15', () => {
    const d = db();
    d.items.push(B.item({ desc: 'Xbox Series S', buyPrice: 800000 }), B.item({ desc: 'xbox serie s blanca', buyPrice: 900000 }));
    // margen del usuario sobre el costo: vendido 9.600.000 (4 iPhone + PS5) / costo 7.600.000 → +26,3 %
    const r = priceRef(d, 'series s');
    assert.equal(r.ventas.n, 0);
    assert.equal(r.compras.prom, 850000);
    assert.equal(r.sugeridoVenta, Math.round(850000 * (1 + 2000000 / 7600000) / 1e4) * 1e4);
    const solo = makeDB({ items: [B.item({ desc: 'Switch', buyPrice: 1000000 })] });
    assert.equal(priceRef(solo, 'switch').sugeridoVenta, 1150000);
  });

  test('acepta un item como consulta; null si no hay nada o la consulta está vacía', () => {
    const d = db();
    assert.equal(priceRef(d, d.items[0]).modelo, 'iphone 13');
    assert.equal(priceRef(d, 'motorola g84'), null);
    assert.equal(priceRef(d, ''), null);
    assert.equal(priceRef(emptyDB(), 'iphone 13'), null);
  });
});

describe('topesEstado y avisos', () => {
  const db = () => makeDB({
    topes: [
      { id: 't1', cat: 'Comida', limite: 200000, u: 5 },
      { id: 't2', cat: '__personal', limite: 300000, u: 5 },
      { id: 't3', cat: 'Transporte', limite: 100000, u: 5 },
      { id: 't4', cat: 'Envíos', limite: 50000, u: 5, del: 1 },
    ],
    gastos: [
      B.gasto({ cat: 'Comida', tipo: 'personal', valor: 170000, fecha: '2026-10-02' }),
      B.gasto({ cat: 'Comida', tipo: 'personal', valor: 99000, fecha: '2026-09-30' }),        // otro mes
      B.gasto({ cat: 'Entretenimiento', tipo: 'personal', valor: 180000, fecha: '2026-10-03' }),
      B.gasto({ cat: 'Envíos', tipo: 'negocio', valor: 60000, fecha: '2026-10-03' }),          // negocio: no cuenta en __personal
      B.gasto({ cat: 'Transporte', tipo: 'personal', valor: 10000, fecha: '2026-10-04', del: 1 }),
    ],
  });
  test('ok / cerca (≥ 80 %) / pasado; el borrado no cuenta', () => {
    const r = topesEstado(db(), '2026-10');
    assert.deepEqual(r.map(x => [x.tope.id, x.gastado, x.pct, x.estado]), [
      ['t1', 170000, 85, 'cerca'],
      ['t2', 350000, 117, 'pasado'],
      ['t3', 0, 0, 'ok'],
    ]);
    assert.equal(hoy(() => topesEstado(db()))[0].gastado, 170000, 'sin ym = mes actual');
  });
  test('remindersText avisa topes cerca y pasados', () => {
    const t = hoy(() => remindersText(db()));
    assert.match(t, /^⚠️ Ya gastaste el 85% de tu tope de Comida$/m);
    assert.match(t, /^🚨 Te pasaste del tope personal por \$50K$/m);
    assert.doesNotMatch(t, /Transporte/);
  });
});

describe('monthInsight', () => {
  const venta = (desc, costo, precio, fecha, o) => B.sold({ desc, buyPrice: costo, buyPocket: 'nequi', buyDate: '2026-06-01', sellPrice: precio, sellPocket: 'nequi', sellDate: fecha, ...o });

  test("'' con menos de 2 ventas en total o sin datos en el mes", () => {
    assert.equal(hoy(() => monthInsight(emptyDB())), '');
    assert.equal(hoy(() => monthInsight(makeDB({ items: [venta('A', 1, 2, '2026-10-01')] }))), '');
    const db = makeDB({ items: [venta('A', 100000, 200000, '2026-08-01'), venta('B', 100000, 200000, '2026-08-02')] });
    assert.equal(hoy(() => monthInsight(db, '2026-06')), '');
  });

  test('mes en curso: compara contra el MISMO DÍA del mes pasado', () => {
    const db = makeDB({ items: [
      venta('Moto G', 500000, 600000, '2026-09-03'),          // a 5-sep: 100.000
      venta('PS5', 1000000, 2000000, '2026-09-20'),           // después del 5-sep: no cuenta
      venta('iPhone 13', 600000, 900000, '2026-10-02'),       // octubre: 300.000
    ] });
    assert.equal(hoy(() => monthInsight(db)), '📈 Llevas $300K de utilidad, $200K más que a esta altura del mes pasado');
  });

  test('mes en curso sin ventas todavía: tono amable', () => {
    const db = makeDB({ items: [venta('A', 100000, 300000, '2026-09-02'), venta('B', 100000, 300000, '2026-09-25')], gastos: [B.gasto({ valor: 10000, fecha: '2026-10-01' })] });
    assert.equal(hoy(() => monthInsight(db)), '🌱 Mes arrancando: a esta altura del mes pasado llevabas $200K de utilidad');
  });

  test('mes cerrado: utilidad arriba + margen (las dos frases si caben en 90 caracteres)', () => {
    const db = makeDB({ items: [venta('Xbox', 800000, 1000000, '2026-08-10'), venta('PS5', 1000000, 1500000, '2026-09-12')] });
    const s = hoy(() => monthInsight(db, '2026-09'));
    assert.equal(s, '📈 Utilidad de $500K, $300K más que el mes anterior · 💹 Tu margen subió a 33% (antes 20%)'.length <= 90
      ? '📈 Utilidad de $500K, $300K más que el mes anterior · 💹 Tu margen subió a 33% (antes 20%)'
      : '📈 Utilidad de $500K, $300K más que el mes anterior');
  });

  test('mes cerrado: utilidad abajo sin alarmismo; gasto personal que más subió', () => {
    const db = makeDB({
      items: [venta('A', 100000, 600000, '2026-08-10'), venta('B', 100000, 400000, '2026-09-12')],
      gastos: [B.gasto({ cat: 'Comida', valor: 20000, fecha: '2026-08-05' }), B.gasto({ cat: 'Comida', valor: 140000, fecha: '2026-09-05' })],
    });
    const s = hoy(() => monthInsight(db, '2026-09'));
    assert.match(s, /^📉 Utilidad de \$300K, \$200K menos que el mes anterior/);
    assert.doesNotMatch(s, /!|alerta|peligro|p[eé]rdida/i);
    const solo = makeDB({ items: [venta('A', 100000, 300000, '2026-08-10'), venta('B', 100000, 300000, '2026-09-12')],
      gastos: [B.gasto({ cat: 'Comida', valor: 20000, fecha: '2026-08-05' }), B.gasto({ cat: 'Comida', valor: 140000, fecha: '2026-09-05' })] });
    assert.match(hoy(() => monthInsight(solo, '2026-09')), /👀 Comida va en \$140K, \$120K más que el mes pasado/);
  });

  test('siempre ≤ 90 caracteres y determinista', () => {
    const db = makeDB({ items: Array.from({ length: 12 }, (_, i) => venta('Producto con un nombre larguísimo número ' + i, 100000 * (i + 1), 150000 * (i + 1), `2026-${i % 2 ? '09' : '08'}-1${i % 9}`)) });
    for (const ym of ['2026-08', '2026-09', '2026-10']) {
      const a = hoy(() => monthInsight(db, ym)), b = hoy(() => monthInsight(db, ym));
      assert.equal(a, b);
      assert.ok(a.length <= 90, `${ym}: ${a.length} ${a}`);
    }
  });

  test('summaryText incluye la línea del insight (y no si está vacía)', () => {
    const db = makeDB({ items: [venta('Moto G', 500000, 600000, '2026-09-03'), venta('iPhone 13', 600000, 900000, '2026-10-02')] });
    assert.match(hoy(() => summaryText(db)), /\n📈 Llevas \$300K de utilidad, \$200K más que a esta altura del mes pasado$/);
    assert.doesNotMatch(hoy(() => summaryText(emptyDB())), /📈|🌱|🏆/);
  });
});

describe('contactoStats', () => {
  const db = () => makeDB({
    contactos: [
      { id: 'k1', nombre: 'Mateo Gómez', tel: '3001112233', tipo: 'ambos', u: 5 },
      { id: 'k2', nombre: 'Laura', tel: '', tipo: 'cliente', u: 5 },
      { id: 'k3', nombre: 'Borrado', u: 5, del: 1 },
    ],
    items: [
      B.item({ id: 'a', desc: 'PS5', buyPrice: 1500000, buyDate: '2026-08-01', proveedorId: 'k1' }),
      B.item({ id: 'b', desc: 'Xbox', buyPrice: 700000, buyDate: '2026-09-01', proveedor: 'mateo gomez' }),     // por nombre (sin tildes/mayúsculas)
      B.sold({ id: 'c', desc: 'iPhone 12', buyPrice: 1000000, sellPrice: 1400000, sellDate: '2026-09-20', clienteId: 'k1' }),
      B.sold({ id: 'd', desc: 'Switch', buyPrice: 900000, sellPrice: 1200000, sellPaid: 700000, sellDate: '2026-09-25', cliente: 'Laura' }),
      B.sold({ id: 'e', desc: 'Tenis', buyPrice: 100000, sellPrice: 200000, sellDate: '2026-09-26', cliente: 'Laura Pérez' }), // otro nombre: no
      B.item({ id: 'f', desc: 'Borrado', buyPrice: 5, proveedorId: 'k1', del: 1 }),
    ],
    gastos: [B.gasto({ valor: 100000, itemId: 'c', tipo: 'negocio' })],
    cobros: [B.cobro({ id: 'cl', nombre: 'laura', total: 500000, itemId: 'd', fecha: '2026-09-25' }), B.cobro({ nombre: 'Mateo Gómez', total: 50000, fecha: '2026-09-28' })],
    abonos: [B.abono({ cobroId: 'cl', monto: 200000 })],
  });
  test('por id y por nombre normalizado: compras, ventas, ganancia real, lo que debe y lo último', () => {
    const m = contactoStats(db(), 'k1');
    assert.deepEqual(m.compras, { n: 2, total: 2200000 });
    assert.deepEqual(m.ventas, { n: 1, total: 1400000, ganancia: 300000 });
    assert.equal(m.debe, 50000);
    assert.deepEqual([m.ultimo.tipo, m.ultimo.fecha], ['cobro', '2026-09-28']);
    const l = contactoStats(db(), 'k2');
    assert.deepEqual(l.ventas, { n: 1, total: 1200000, ganancia: 300000 });
    assert.equal(l.debe, 300000);
    assert.equal(l.compras.n, 0);
  });
  test('contacto inexistente o borrado → null', () => {
    assert.equal(contactoStats(db(), 'k3'), null);
    assert.equal(contactoStats(db(), 'nadie'), null);
  });
});

describe('colecciones nuevas', () => {
  test('COLS incluye contactos y topes; emptyDB las trae vacías; mergeDB las une por u', () => {
    assert.ok(COLS.includes('contactos') && COLS.includes('topes'));
    assert.deepEqual([emptyDB().contactos, emptyDB().topes], [[], []]);
    const m = mergeDB({ contactos: [{ id: 'k', nombre: 'A', u: 1 }] }, { contactos: [{ id: 'k', nombre: 'B', u: 2 }], topes: [{ id: 't', u: 1 }] });
    assert.deepEqual([m.contactos[0].nombre, m.topes.length], ['B', 1]);
  });
});
