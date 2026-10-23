'use strict';
/**
 * Verifica tests/fixtures/demo-db.json (base de demostración de ~3 meses) y que core.js se comporta
 * bien sobre ella. Si cambias make-demo.js, regenera:  node tests/fixtures/make-demo.js
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { NOW_MS, HOY, DAY, bogota, withTZ, hoy } = require('./helpers/clock');
const core = require('./helpers/core');
const { norm } = require('./helpers/builders');
const { ledgerBalances, minBalances } = require('./helpers/oracle');
const { CATS, GCATS, NEG_CATS, CONDS, normKeyLocal } = require('./helpers/spec');
const { buildDemoDB, toJSON, OUT, TODAY } = require('./fixtures/make-demo');

const { emptyDB, mergeDB, balances, balancesFondos, ensureSeeds, cobrosPend, cobroPagado, monthStats, summaryText, remindersText, L, COLS, fmt } = core;

// días entre dos 'YYYY-MM-DD' calculados en UTC (independiente de core.js)
const utc = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const diasEntre = (a, b) => Math.round((utc(b) - utc(a)) / DAY);

const FILE = fs.readFileSync(OUT, 'utf8');
const db = JSON.parse(FILE);
const sold = db.items.filter(i => i.status === 'sold');
const stock = db.items.filter(i => i.status === 'stock');
const pocketIds = db.bolsillos.map(b => b.id);

describe('demo-db.json: generación determinista', () => {
  test('el archivo está al día con lo que genera make-demo.js (byte a byte)', () => {
    assert.equal(FILE, toJSON(buildDemoDB()), 'regenera con: node tests/fixtures/make-demo.js');
  });
  test('es determinista: dos generaciones seguidas dan exactamente lo mismo', () => {
    assert.equal(toJSON(buildDemoDB()), toJSON(buildDemoDB()));
  });
  test('no depende de la zona horaria ni del reloj de la máquina', () => {
    const base = toJSON(buildDemoDB());
    for (const tz of ['UTC', 'Asia/Tokyo', 'America/New_York', 'Pacific/Auckland']) assert.equal(withTZ(tz, () => toJSON(buildDemoDB())), base, tz);
  });
  test('es JSON puro: lo que genera == lo que se lee del archivo (sin undefined que se pierdan)', () => {
    assert.deepEqual(buildDemoDB(), db);
  });
  test('trae exactamente las 14 colecciones del modelo, en el orden de COLS', () => {
    assert.deepEqual(Object.keys(db), COLS);
  });
});

describe('demo-db.json: cantidades pedidas', () => {
  test('20 productos: 12 vendidos y 8 en stock', () => {
    assert.equal(db.items.length, 20);
    assert.equal(sold.length, 12);
    assert.equal(stock.length, 8);
  });
  test('2 ventas a crédito (sellPaid < sellPrice) entre los vendidos', () => {
    const credito = sold.filter(i => i.sellPaid < i.sellPrice);
    assert.equal(credito.length, 2);
    assert.ok(sold.filter(i => i.sellPaid === i.sellPrice).length === 10, 'las otras 10 se pagaron completas');
  });
  test('25 gastos (12 negocio y 13 personal, 1 desde Nequi pareja), 3 ingresos, 3 transfers, 1 ajuste, 3 pend, 2 reglas, 4 apartados, 4 repartos', () => {
    assert.equal(db.gastos.length, 25);
    assert.equal(db.gastos.filter(g => g.tipo === 'negocio').length, 12);
    assert.equal(db.gastos.filter(g => g.tipo === 'personal').length, 13);
    assert.equal(db.gastos.filter(g => g.bolsillo === 'nequi_pareja').length, 1);
    assert.equal(db.fondos.length, 4);
    assert.equal(db.repartos.length, 4);
    assert.equal(db.ingresos.length, 3);
    assert.equal(db.transfers.length, 3);
    assert.equal(db.ajustes.length, 1);
    assert.equal(db.pend.length, 3);
    assert.equal(db.reglas.length, 2);
  });
  test('4 cobros: 1 préstamo, 2 ventas a crédito, 1 saldado; con abonos', () => {
    assert.equal(db.cobros.length, 4);
    const prestamos = db.cobros.filter(c => c.bolsillo && !c.itemId);
    const ventas = db.cobros.filter(c => c.itemId);
    assert.equal(ventas.length, 2);
    assert.equal(prestamos.length, 2, 'un préstamo pendiente y el préstamo ya saldado');
    const pend = cobrosPend(db);
    assert.equal(pend.length, 3, '3 pendientes');
    const saldados = db.cobros.filter(c => !pend.some(p => p.id === c.id));
    assert.equal(saldados.length, 1, '1 saldado');
    assert.ok(saldados[0].bolsillo && !saldados[0].itemId, 'el saldado es un préstamo');
    assert.ok(db.abonos.length >= 4);
    for (const c of db.cobros) assert.ok(db.abonos.some(a => a.cobroId === c.id), `el cobro ${c.nombre} tiene abonos`);
  });
  test('bolsillos efectivo, nequi y nequi_pareja con saldo inicial > 0', () => {
    assert.deepEqual(pocketIds.slice().sort(), ['efectivo', 'nequi', 'nequi_pareja']);
    for (const b of db.bolsillos) assert.ok(b.ini > 0, b.id);
  });
});

describe('demo-db.json: coherencia', () => {
  const todas = COLS.flatMap(c => db[c].map(r => [c, r]));

  test('ids únicos en toda la base, u enteros y > 1, pend con prefijo p', () => {
    const ids = todas.map(([, r]) => r.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const [c, r] of todas) { assert.ok(Number.isInteger(r.u) && r.u > 1, `${c}/${r.id} u`); assert.equal(typeof r.id, 'string'); }
    for (const p of db.pend) assert.match(p.id, /^p/);
    for (const [c, r] of todas) if (c !== 'bolsillos' && c !== 'reglas' && !(c === 'fondos' && ['negocio', 'personal'].includes(r.id))) assert.match(r.id, /^p?[0-9a-z]{9,}$/, `${c} id con formato Date.now().toString(36)+random(4)`);
  });

  test('ningún registro está borrado (del) y no hay fechas futuras (salvo compromisos de cobro)', () => {
    for (const [c, r] of todas) assert.ok(!r.del, `${c}/${r.id}`);
    for (const [c, r] of todas) for (const k of ['buyDate', 'sellDate', 'fecha']) if (r[k]) assert.ok(r[k] <= TODAY, `${c}/${r.id}.${k}=${r[k]}`);
  });

  test('cubre ~3 meses hasta hoy (primera fecha entre 85 y 92 días atrás, última de hoy)', () => {
    const fechas = todas.flatMap(([, r]) => ['buyDate', 'sellDate', 'fecha'].map(k => r[k]).filter(Boolean)).sort();
    assert.ok(diasEntre(fechas[0], TODAY) >= 85 && diasEntre(fechas[0], TODAY) <= 92, `primera fecha ${fechas[0]}`);
    assert.equal(fechas[fechas.length - 1], TODAY);
  });

  test('u es coherente con la fecha del registro (nunca anterior a su día ni posterior a "ahora")', () => {
    for (const i of db.items) {
      const ultima = i.status === 'sold' ? i.sellDate : i.buyDate;
      assert.ok(i.u >= bogota(ultima, '00:00') && i.u < bogota(ultima, '00:00') + DAY, `item ${i.desc}`);
    }
    for (const c of ['gastos', 'ingresos', 'cobros', 'abonos', 'transfers', 'ajustes', 'pend']) for (const r of db[c]) assert.ok(r.u >= bogota(r.fecha, '00:00') && r.u < bogota(r.fecha, '00:00') + DAY, `${c}/${r.id}`);
    for (const [, r] of todas) assert.ok(r.u <= NOW_MS, 'u en el futuro');
  });

  test('productos: categoría y condición válidas, ventas con fecha ≥ compra, bolsillos existentes', () => {
    for (const i of db.items) {
      assert.ok(CATS.includes(i.cat), i.cat); assert.ok(CONDS.includes(i.cond), i.cond);
      assert.ok(i.buyPrice > 0 && Number.isInteger(i.buyPrice));
      assert.ok(i.buyPocket === '' || pocketIds.includes(i.buyPocket), i.buyPocket);
      assert.ok(i.targetPrice === null || i.targetPrice > i.buyPrice, `meta de ${i.desc}`);
    }
    for (const i of sold) {
      assert.ok(i.sellDate >= i.buyDate, i.desc);
      assert.ok(i.sellPaid >= 0 && i.sellPaid <= i.sellPrice, i.desc);
      assert.ok(pocketIds.includes(i.sellPocket), i.sellPocket);
    }
    for (const i of stock) assert.equal(i.sellPrice, undefined);
  });

  test('hay variedad para probar la UI: una venta con pérdida, productos quietos amarillo (30-59 d) y rojo (60+ d), una compra sin bolsillo', () => {
    assert.ok(sold.some(i => i.sellPrice < i.buyPrice), 'venta con pérdida');
    const edad = i => diasEntre(i.buyDate, TODAY);
    assert.ok(stock.some(i => edad(i) >= 30 && edad(i) < 60), 'amarillo');
    assert.ok(stock.some(i => edad(i) >= 60), 'rojo');
    assert.ok(stock.some(i => edad(i) < 30), 'recientes');
    assert.ok(db.items.some(i => i.buyPocket === ''), 'compra que no salió de mis bolsillos');
  });

  test('gastos: categoría válida; tipo negocio ⟺ categoría de negocio; bolsillo existente', () => {
    for (const g of db.gastos) {
      assert.ok(GCATS.includes(g.cat), g.cat);
      assert.equal(g.tipo === 'negocio', NEG_CATS.includes(g.cat), `${g.desc}: ${g.cat}/${g.tipo}`);
      assert.ok(pocketIds.includes(g.bolsillo)); assert.ok(g.valor > 0 && Number.isInteger(g.valor));
    }
    assert.ok(db.gastos.some(g => g.bolsillo === 'efectivo') && db.gastos.some(g => g.bolsillo === 'nequi'));
  });

  test('cobros y abonos: referencias válidas; la venta a crédito cobra exactamente la diferencia', () => {
    for (const a of db.abonos) { assert.ok(db.cobros.some(c => c.id === a.cobroId)); assert.ok(pocketIds.includes(a.bolsillo)); assert.ok(a.monto > 0); }
    for (const c of db.cobros.filter(c => c.itemId)) {
      const it = db.items.find(i => i.id === c.itemId);
      assert.ok(it && it.status === 'sold', 'el cobro apunta a un producto vendido');
      assert.equal(c.total, it.sellPrice - it.sellPaid, `cobro de ${c.nombre} = diferencia de la venta`);
      assert.equal(c.pagado, 0); assert.equal(c.bolsillo, '', 'venta a crédito: no salió plata');
    }
    for (const c of db.cobros) assert.match(c.tel, /^3\d{9}$/);
  });

  test('transfers entre bolsillos distintos; ajuste con delta pequeño; pend bien formados', () => {
    for (const t of db.transfers) { assert.notEqual(t.from, t.to); assert.ok(pocketIds.includes(t.from) && pocketIds.includes(t.to)); assert.ok(t.monto > 0); }
    assert.ok(db.ajustes[0].delta !== 0 && Math.abs(db.ajustes[0].delta) < 50000);
    for (const p of db.pend) { assert.ok(['in', 'out', '?'].includes(p.dir)); assert.ok(p.monto > 0); assert.ok(p.raw && p.quien && p.bolsillo === 'nequi'); }
  });

  test('las reglas corresponden a los "quien" de 2 de los 3 pend (el tercero queda sin regla)', () => {
    const reglas = new Set(db.reglas.map(r => r.id));
    const conRegla = db.pend.filter(p => reglas.has(normKeyLocal(p.quien)));
    assert.equal(conRegla.length, 2);
    assert.equal(db.pend.filter(p => !reglas.has(normKeyLocal(p.quien))).length, 1);
    for (const r of db.reglas) assert.ok(['gasto', 'ingreso', 'transfer'].includes(r.kind));
  });
});

describe('demo-db.json: saldos (el punto crítico: nada en negativo)', () => {
  test('saldos finales: ningún bolsillo negativo y coinciden con el oráculo independiente', () => {
    const b = balances(db);
    for (const [k, v] of Object.entries(b)) assert.ok(v >= 0, `${k} = ${v}`);
    assert.deepEqual(b, ledgerBalances(db));
    assert.deepEqual(Object.keys(b).sort(), ['efectivo', 'nequi', 'nequi_pareja']);
  });

  test('saldos finales exactos (cálculo a mano): efectivo $904.000 · nequi $1.826.900 · nequi pareja $218.000 · caja $2.948.900', () => {
    // Sumado a mano por tipo de movimiento.
    //  nequi:    4.000.000 − compras 14.900.000 + ventas 10.800.000 − gastos 618.900 + ingresos 2.600.000
    //            − préstamo 300.000 + abonos 500.000 − transfers netos 250.000 − ajuste 4.200 = 1.826.900
    //  efectivo:   450.000 − compras 755.000 + ventas 780.000 − gastos 171.000 + ingreso 150.000
    //            − préstamo 100.000 + abonos 300.000 + transfers netos 250.000 = 904.000
    // Si cambias make-demo.js, recalcula.
    //  nequi_pareja: 250.000 − domicilio Rappi 32.000 = 218.000
    assert.deepEqual(balances(db), { efectivo: 904000, nequi: 1826900, nequi_pareja: 218000 });
  });

  test('ningún bolsillo baja de cero en NINGÚN día del periodo (no solo al final)', () => {
    const lo = minBalances(db, '2026-01-01', TODAY);
    for (const [k, v] of Object.entries(lo)) assert.ok(v >= 0, `${k} llegó a ${v}`);
    assert.ok(lo.nequi > 0 && lo.efectivo > 0 && lo.nequi_pareja > 0);
  });

  test('cobros: pendientes calculados a mano (Camilo 200.000, Laura 500.000, Sebastián 250.000); Don Hernán saldado', () => {
    const p = cobrosPend(db);
    assert.deepEqual(p.map(c => [c.nombre, c.pend]), [['Camilo Restrepo', 200000], ['Laura Giraldo', 500000], ['Sebastián Mora', 250000]]);
    const hernan = db.cobros.find(c => c.nombre === 'Don Hernán');
    assert.equal(cobroPagado(db, hernan), hernan.total);
    assert.equal(p.reduce((s, c) => s + c.pend, 0), 950000);
  });
});

describe('demo-db.json: core.js sobre la base demo', () => {
  test('mergeDB con emptyDB() en cualquier orden no pierde ni cambia nada (los bolsillos del demo ganan a la semilla u:1)', () => {
    assert.deepEqual(norm(mergeDB(db, emptyDB())), norm(db));
    assert.deepEqual(norm(mergeDB(emptyDB(), db)), norm(db));
    assert.deepEqual(norm(ensureSeeds(JSON.parse(FILE))), norm(db), 'el demo ya trae todas las semillas: ensureSeeds no cambia nada');
  });

  test('monthStats histórico (cálculo a mano): ventas 12.930.000, costo 10.620.000, bruta 2.310.000, gastos negocio 326.000, neta 1.984.000, personales 495.900', () => {
    const r = monthStats(db, null);
    assert.equal(r.nVentas, 12);
    assert.equal(r.ventas, 12930000);
    assert.equal(r.costo, 10620000);
    assert.equal(r.bruta, 2310000);
    assert.equal(r.gN, 326000);
    assert.equal(r.neta, 1984000);
    assert.equal(r.gP, 495900);
    assert.equal(r.ing, 2750000);
    assert.ok(Math.abs(r.margen - 1984000 / 12930000 * 100) < 1e-9);
  });

  test('monthStats por mes: los meses suman el total histórico (campos aditivos) y cada mes coincide con un cálculo independiente', () => {
    const meses = ['2026-07', '2026-08', '2026-09', '2026-10'];
    const por = meses.map(m => monthStats(db, m));
    const total = monthStats(db, null);
    for (const k of ['nVentas', 'ventas', 'costo', 'bruta', 'gN', 'gP', 'neta', 'compras', 'ing'])
      assert.equal(por.reduce((s, x) => s + x[k], 0), total[k], k);
    meses.forEach((m, i) => {
      const v = sold.filter(x => x.sellDate.startsWith(m));
      assert.equal(por[i].ventas, v.reduce((s, x) => s + x.sellPrice, 0), m);
      assert.equal(por[i].costo, v.reduce((s, x) => s + x.buyPrice, 0), m);
      assert.equal(por[i].gN, db.gastos.filter(g => g.tipo === 'negocio' && g.fecha.startsWith(m)).reduce((s, g) => s + g.valor, 0), m);
      assert.equal(por[i].compras, db.items.filter(x => x.buyDate.startsWith(m)).reduce((s, x) => s + x.buyPrice, 0), m);
    });
    assert.ok(por.every(x => x.nVentas > 0 || x === por[3]), 'hay ventas en los primeros meses');
  });

  test('summaryText a las 10 a. m. de hoy (cálculo a mano)', () => {
    // sin ventas en los últimos 7 días · gastos de la semana: Cena 40.000 (personal)
    // caja 904.000 + 1.826.900 + 218.000 = 2.948.900 · stock 8 productos por 5.355.000 · te deben 950.000
    // apartados: ver el test de balancesFondos (Negocio 999.000 · Personal 1.244.900 · Casa 505.000 · Ahorro 200.000)
    // quietos (30+ días): iPhone 11 (34 d) y Jordan 1 (65 d) · 3 pend
    assert.equal(hoy(() => summaryText(db)), [
      '📊 Sin ventas esta semana',
      '💸 Gastos $40K (negocio $0 · personal $40K)',
      '💵 Caja $2.9M · 📦 Stock $5.4M (8)',
      '💼 Negocio $999K · 👤 Personal $1.2M · 🏠 Casa $505K · 🐷 Ahorro $200K',
      '🤝 Te deben $950K: Camilo $200K, Laura $500K, Sebastián $250K',
      '⚠️ 2 productos con +30 días: iPhone 11 64GB, Jordan 1 Retro talla 41',
      '📲 3 movimientos por clasificar',
      // monthInsight: octubre sin ventas aún; al 5-sep: Switch +250.000 − publicidad 80.000 − cajas 22.000 = 148.000
      '🌱 Mes arrancando: a esta altura del mes pasado llevabas $148K de utilidad',
    ].join('\n'));
  });

  test('remindersText hoy: Laura vencida, Sebastián hoy, 3 por clasificar; sin empujón (hubo actividad hace menos de 3 días)', () => {
    assert.equal(hoy(() => remindersText(db)), [
      '🤝 Laura Giraldo debía pagarte el 02/10/26: $500K',
      '🤝 Sebastián Mora prometió pagarte hoy: $250K',
      '📲 Tienes 3 movimientos por clasificar',
    ].join('\n'));
  });

  test('remindersText 5 días después: aparece el empujón de inactividad y los 3 cobros ya vencidos', () => {
    const t = require('./helpers/clock').withNow('2026-10-10T10:00:00-05:00', () => remindersText(db));
    assert.match(t, /Llevas \d+ días sin registrar nada/);
    assert.match(t, /Sebastián Mora debía pagarte el 05\/10\/26: \$250K/);
  });

  test('fmt de los saldos que mostrará Inicio: Caja y chips', () => {
    const b = balances(db);
    assert.equal(fmt(b.efectivo), '$904K');
    assert.equal(fmt(b.nequi), '$1.8M');
    assert.equal(fmt(b.nequi_pareja), '$218K');
  });

  test('todos los productos en stock del demo siguen "en stock" para la tarjeta: capital y conteo', () => {
    assert.equal(L(db, 'items').filter(i => i.status === 'stock').reduce((s, i) => s + i.buyPrice, 0), 5355000);
  });
});

describe('demo-db.json: apartados (SPEC §13)', () => {
  const casa = db.fondos.find(f => f.nombre === 'Casa').id, ahorro = db.fondos.find(f => f.nombre === 'Ahorro').id;
  const total = o => Object.values(o).reduce((s, v) => s + v, 0);

  test('INVARIANTE: suma de apartados = suma de bolsillos (= caja)', () => {
    assert.equal(total(balancesFondos(db)), total(balances(db)));
    assert.equal(total(balancesFondos(db)), 2948900);
  });

  test('saldos por apartado (cálculo a mano, independiente de core)', () => {
    // negocio  = iniFondos 3.800.000 − compras con bolsillo 15.655.000 + ventas cobradas 11.580.000 − gastos negocio 326.000
    //            + abonos de ventas a crédito (Laura 500.000 + Sebastián 100.000) + reparto 1.000.000 = 999.000
    // casa     = repartos 600.000 − Internet 95.000 = 505.000 · ahorro = reparto 200.000
    // personal = caja 2.948.900 − los demás = 1.244.900
    assert.deepEqual(balancesFondos(db), { negocio: 999000, personal: 1244900, [casa]: 505000, [ahorro]: 200000 });
  });

  test('ningún apartado del demo queda en negativo y la meta de Casa es mayor que su saldo', () => {
    for (const [k, v] of Object.entries(balancesFondos(db))) assert.ok(v >= 0, `${k} = ${v}`);
    assert.ok(db.fondos.find(f => f.id === casa).meta > balancesFondos(db)[casa]);
  });
});
