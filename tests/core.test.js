'use strict';
/**
 * Pruebas de app/core.js (FASE 1). node:test + assert, sin dependencias.
 *   node --test tests/core.test.js
 *
 * Convenciones:
 *  - "Hoy" = 2026-10-05 10:00 a. m. Bogotá (helpers/clock.js); TZ fija a America/Bogota.
 *  - Los valores esperados están calculados A MANO (no pegados de la salida del código).
 *  - { todo } = comportamiento deseado que core.js hoy NO cumple y que es decisión del lead;
 *    se ejecutan y se reportan, pero no rompen la suite. Si algún día pasan, quita el todo.
 *  - CORE_PATH=/ruta/core.orig.js corre esta misma suite contra otra versión de core.js.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { NOW_ISO, NOW_MS, HOY, HOUR, DAY, bogota, withNow, withTZ, hoy } = require('./helpers/clock');
const core = require('./helpers/core');
const B = require('./helpers/builders');
const { ledgerBalances } = require('./helpers/oracle');

const {
  COLS, emptyDB, mergeDB, L, sum, today, shiftDate, daysBetween, fmt, full, fd,
  extractMonto, parseMoney, parseNoti, balances, cobroPagado, cobrosPend, monthStats,
  summaryText, remindersText,
} = core;
const { makeDB, norm, clone, deepFreeze } = B;

const SPEC_API = ['COLS', 'emptyDB', 'mergeDB', 'L', 'sum', 'today', 'shiftDate', 'daysBetween', 'MESES', 'monthLabel',
  'fmt', 'full', 'fd', 'extractMonto', 'parseMoney', 'parseNoti', 'balances', 'cobroPagado', 'cobrosPend',
  'monthStats', 'summaryText', 'remindersText'];

/* ════════════════════════════════════════════════════════════════════════════
   0. API y carga
════════════════════════════════════════════════════════════════════════════ */
describe('API y carga de core.js (SPEC §4)', () => {
  test('require() exporta todos los nombres que lista el SPEC §4', () => {
    for (const n of SPEC_API) assert.notEqual(typeof core[n], 'undefined', `core.js no exporta ${n}`);
    assert.ok(Array.isArray(core.COLS) && Array.isArray(core.MESES));
  });

  test('COLS son exactamente las 14 colecciones del modelo, en ese orden (SPEC §13 fondos/repartos, §14 contactos/topes)', () => {
    assert.deepEqual(COLS, ['items', 'gastos', 'ingresos', 'cobros', 'abonos', 'transfers', 'ajustes', 'pend', 'bolsillos', 'reglas', 'fondos', 'repartos', 'contactos', 'topes', 'pedidos']);
  });

  test('como script clásico (navegador / Apps Script) declara los mismos nombres como globales', () => {
    const ctx = vm.createContext({});
    vm.runInContext(core.CORE_SOURCE, ctx, { filename: 'core.js' });
    for (const n of SPEC_API) assert.notEqual(vm.runInContext(`typeof ${n}`, ctx), 'undefined', `${n} no queda global`);
  });

  test('no depende de DOM ni de Node: corre en un contexto vacío (como Apps Script)', () => {
    const ctx = vm.createContext({});
    vm.runInContext(core.CORE_SOURCE, ctx);
    for (const g of ['window', 'document', 'require', 'module', 'process', 'localStorage'])
      assert.equal(vm.runInContext(`typeof ${g}`, ctx), 'undefined');
    const out = vm.runInContext('summaryText(emptyDB()) + "|" + JSON.stringify(balances(emptyDB()))', ctx);
    assert.match(out, /Sin ventas esta semana/);
    assert.match(out, /\{"efectivo":0,"nequi":0,"nequi_pareja":0\}$/);
  });

  test('emptyDB(): todas las COLS, semillas de bolsillos (efectivo, nequi, nequi_pareja) y apartados (negocio, personal) con u:1, y es una instancia nueva', () => {
    const d = emptyDB();
    assert.deepEqual(Object.keys(d), COLS);
    for (const c of COLS.filter(c => c !== 'bolsillos' && c !== 'fondos')) assert.deepEqual(d[c], []);
    assert.deepEqual(d.bolsillos.map(b => [b.id, b.nombre, b.ini, b.u]), [
      ['efectivo', 'Efectivo', 0, 1], ['nequi', 'Nequi', 0, 1], ['nequi_pareja', 'Nequi pareja', 0, 1],
    ]);
    assert.ok(d.bolsillos.every(b => Array.isArray(b.alias) && b.alias.length));
    assert.deepEqual(d.fondos.map(f => [f.id, f.nombre, f.emoji, f.u]), [['negocio', 'Negocio', '💼', 1], ['personal', 'Personal', '👤', 1]]);
    d.bolsillos[0].alias.push('x');
    assert.ok(!emptyDB().bolsillos[0].alias.includes('x'), 'los alias de la semilla no se comparten entre llamadas');
    d.items.push({ id: 'x' });
    assert.deepEqual(emptyDB().items, [], 'emptyDB() comparte estado entre llamadas');
  });

  test('L() quita borrados y tolera colecciones o db inexistentes; sum() suma por clave o directo', () => {
    const db = makeDB({ gastos: [B.gasto({ id: 'a', valor: 10 }), B.gasto({ id: 'b', valor: 20, del: 1 }), B.gasto({ id: 'c', valor: 30 })] });
    assert.deepEqual(L(db, 'gastos').map(x => x.id), ['a', 'c']);
    assert.deepEqual(L(db, 'noExiste'), []);
    assert.deepEqual(L(null, 'gastos'), []);
    assert.deepEqual(L(undefined, 'gastos'), []);
    assert.equal(sum(L(db, 'gastos'), 'valor'), 40);
    assert.equal(sum([1, 2, '3', null, undefined, 'x']), 6);
    assert.equal(sum([], 'valor'), 0);
    assert.equal(sum([{ valor: '5' }, { valor: 'abc' }, {}], 'valor'), 5);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   1. mergeDB
════════════════════════════════════════════════════════════════════════════ */
describe('mergeDB', () => {
  const rec = (id, u, extra) => ({ id, u, ...extra });
  const ids = (db, c) => db[c].map(r => r.id).sort();

  test('por id gana el de mayor u, sin importar el orden de los argumentos', () => {
    const viejo = makeDB({ items: [rec('1', 10, { desc: 'viejo' })] });
    const nuevo = makeDB({ items: [rec('1', 20, { desc: 'nuevo' })] });
    assert.equal(mergeDB(viejo, nuevo).items[0].desc, 'nuevo');
    assert.equal(mergeDB(nuevo, viejo).items[0].desc, 'nuevo');
    assert.equal(mergeDB(viejo, nuevo).items.length, 1);
  });

  test('ids distintos se unen (nada se pierde de ningún lado) en todas las colecciones', () => {
    const a = makeDB({ items: [rec('a', 1)], gastos: [rec('g1', 1)], cobros: [rec('c1', 1)], reglas: [rec('rappi', 1)] });
    const b = makeDB({ items: [rec('b', 1)], gastos: [rec('g2', 1)], abonos: [rec('ab1', 1)], pend: [rec('p1', 1)] });
    const m = mergeDB(a, b);
    assert.deepEqual(ids(m, 'items'), ['a', 'b']);
    assert.deepEqual(ids(m, 'gastos'), ['g1', 'g2']);
    assert.deepEqual(ids(m, 'cobros'), ['c1']);
    assert.deepEqual(ids(m, 'abonos'), ['ab1']);
    assert.deepEqual(ids(m, 'pend'), ['p1']);
    assert.deepEqual(ids(m, 'reglas'), ['rappi']);
  });

  describe('tombstones (del:1)', () => {
    test('un borrado más nuevo gana: se propaga y L() ya no lo ve', () => {
      const vivo = makeDB({ items: [rec('1', 10, { desc: 'x' })] });
      const borrado = makeDB({ items: [rec('1', 20, { desc: 'x', del: 1 })] });
      for (const m of [mergeDB(vivo, borrado), mergeDB(borrado, vivo)]) {
        assert.equal(m.items.length, 1, 'el tombstone se conserva (nunca se borra físicamente)');
        assert.equal(m.items[0].del, 1);
        assert.deepEqual(L(m, 'items'), []);
      }
    });

    test('una edición más nueva que el borrado "resucita" el registro (gana mayor u)', () => {
      const borrado = makeDB({ items: [rec('1', 20, { del: 1 })] });
      const editado = makeDB({ items: [rec('1', 30, { desc: 'otra vez' })] });
      for (const m of [mergeDB(borrado, editado), mergeDB(editado, borrado)]) {
        assert.equal(m.items[0].desc, 'otra vez');
        assert.equal(m.items[0].del, undefined);
      }
    });

    test('un borrado MÁS VIEJO que la edición no la borra', () => {
      const m = mergeDB(makeDB({ gastos: [rec('1', 5, { del: 1 })] }), makeDB({ gastos: [rec('1', 9, { valor: 7 })] }));
      assert.equal(m.gastos[0].valor, 7);
      assert.equal(L(m, 'gastos').length, 1);
    });

    test('tombstones de bolsillos y reglas también viajan', () => {
      const a = makeDB({ bolsillos: [B.bolsillo('x', 'X', 0, { u: 5 })], reglas: [B.regla({ id: 'r', u: 5 })] });
      const b = makeDB({ bolsillos: [B.bolsillo('x', 'X', 0, { u: 6, del: 1 })], reglas: [B.regla({ id: 'r', u: 6, del: 1 })] });
      const m = mergeDB(a, b);
      assert.deepEqual(L(m, 'bolsillos'), []);
      assert.deepEqual(L(m, 'reglas'), []);
      assert.equal(m.bolsillos.length, 1, 'el tombstone del bolsillo se conserva');
    });
  });

  describe('empates de u (mismo milisegundo en dos dispositivos)', () => {
    test('el resultado NO depende del orden de los argumentos (si no, los dispositivos nunca convergen)', () => {
      const a = makeDB({ items: [rec('1', 5, { desc: 'a' })] });
      const b = makeDB({ items: [rec('1', 5, { desc: 'b' })] });
      assert.deepEqual(norm(mergeDB(a, b)), norm(mergeDB(b, a)));
    });

    test('en empate, el borrado gana (también sin depender del orden)', () => {
      const vivo = makeDB({ items: [rec('1', 5, { desc: 'x' })] });
      const borrado = makeDB({ items: [rec('1', 5, { desc: 'x', del: 1 })] });
      assert.equal(mergeDB(vivo, borrado).items[0].del, 1);
      assert.equal(mergeDB(borrado, vivo).items[0].del, 1);
    });

    test('empate con registros idénticos: queda uno solo', () => {
      const a = makeDB({ items: [rec('1', 5, { desc: 'igual' })] });
      const m = mergeDB(a, clone(a));
      assert.equal(m.items.length, 1);
      assert.equal(m.items[0].desc, 'igual');
    });
  });

  test('colecciones faltantes: {} / null / undefined no revientan y devuelven TODAS las COLS como arrays', () => {
    for (const [x, y] of [[{}, {}], [null, null], [undefined, undefined], [{}, null], [null, emptyDB()]]) {
      const m = mergeDB(x, y);
      assert.deepEqual(Object.keys(m), COLS);
      for (const c of COLS) assert.ok(Array.isArray(m[c]), `${c} no es array`);
    }
    // un lado sin algunas colecciones
    const parcial = { items: [rec('1', 1, { desc: 'solo items' })] };
    const m = mergeDB(parcial, emptyDB());
    assert.equal(m.items.length, 1);
    assert.deepEqual(m.bolsillos.map(p => p.id).sort(), ['efectivo', 'nequi', 'nequi_pareja']);
  });

  test('mergeDB(null,null) NO trae los bolsillos semilla (quien lea una base vacía debe usar emptyDB())', () => {
    assert.deepEqual(mergeDB(null, null).bolsillos, []);
  });

  test('descarta claves que no son colecciones y registros sin id (null, undefined, sin id)', () => {
    const sucio = { foo: [rec('x', 1)], version: 3, items: [null, undefined, { u: 1, desc: 'sin id' }, rec('ok', 1), { id: null, u: 2 }] };
    const m = mergeDB(sucio, {});
    assert.equal(m.foo, undefined);
    assert.equal(m.version, undefined);
    assert.deepEqual(ids(m, 'items'), ['ok']);
  });

  test('un registro sin u cuenta como u=0 (pierde contra cualquier u>0)', () => {
    const sinU = makeDB({ gastos: [{ id: 'g', valor: 1 }] });
    const conU = makeDB({ gastos: [{ id: 'g', valor: 2, u: 1 }] });
    assert.equal(mergeDB(sinU, conU).gastos[0].valor, 2);
    assert.equal(mergeDB(conU, sinU).gastos[0].valor, 2);
  });

  test('la semilla u:1 pierde contra el onboarding (ini con u real) en cualquier orden', () => {
    const onboarded = emptyDB();
    onboarded.bolsillos = [B.bolsillo('efectivo', 'Efectivo', 150000, { u: 1790000000000 }), B.bolsillo('nequi', 'Nequi', 800000, { u: 1790000000001 })];
    for (const m of [mergeDB(emptyDB(), onboarded), mergeDB(onboarded, emptyDB())]) {
      const byId = Object.fromEntries(m.bolsillos.map(p => [p.id, p.ini]));
      assert.deepEqual(byId, { efectivo: 150000, nequi: 800000, nequi_pareja: 0 });
    }
  });

  test('es idempotente: merge(a,a), merge(merge(a,b),b) y merge(merge(a,b),a) = merge(a,b)', () => {
    const a = makeDB({ items: [rec('1', 5, { desc: 'a' }), rec('2', 9, { del: 1 })], gastos: [rec('g', 3)] });
    const b = makeDB({ items: [rec('1', 7, { desc: 'b' }), rec('3', 1)], cobros: [rec('c', 2)] });
    const ab = mergeDB(a, b);
    assert.deepEqual(norm(mergeDB(a, a)), norm(mergeDB(a, null)), 'merge(a,a) = a (deduplicado)');
    assert.deepEqual(norm(mergeDB(ab, b)), norm(ab));
    assert.deepEqual(norm(mergeDB(ab, a)), norm(ab));
    assert.deepEqual(norm(mergeDB(ab, ab)), norm(ab));
  });

  test('es conmutativo (comparando como conjuntos: el ORDEN de los arrays no está garantizado)', () => {
    const a = makeDB({ items: [rec('1', 5, { desc: 'a' }), rec('2', 9, { del: 1 })], gastos: [rec('g', 3)] });
    const b = makeDB({ items: [rec('1', 7, { desc: 'b' }), rec('2', 4, { desc: 'revive?' })], cobros: [rec('c', 2)] });
    assert.deepEqual(norm(mergeDB(a, b)), norm(mergeDB(b, a)));
  });

  test('es asociativo: (a+b)+c = a+(b+c)', () => {
    const a = makeDB({ items: [rec('1', 5, { v: 'a' })] });
    const b = makeDB({ items: [rec('1', 5, { v: 'b' }), rec('2', 1)] });
    const c = makeDB({ items: [rec('1', 5, { v: 'c', del: 1 }), rec('2', 2, { v: 'c' })] });
    assert.deepEqual(norm(mergeDB(mergeDB(a, b), c)), norm(mergeDB(a, mergeDB(b, c))));
  });

  test('no muta sus entradas (acepta objetos congelados)', () => {
    const a = makeDB({ items: [rec('1', 5)], gastos: [rec('g', 1, { valor: 3 })] });
    const b = makeDB({ items: [rec('1', 9, { desc: 'n' })] });
    const antes = [clone(a), clone(b)];
    deepFreeze(a); deepFreeze(b);
    assert.doesNotThrow(() => mergeDB(a, b));
    assert.deepEqual([clone(a), clone(b)], antes);
  });

  test('merge con emptyDB() no pierde ni inventa datos', () => {
    const a = makeDB({
      items: [B.item({ id: 'i1', u: 50 })], gastos: [B.gasto({ id: 'g1', u: 50 })],
      bolsillos: [B.bolsillo('efectivo', 'Efectivo', 10, { u: 50 }), B.bolsillo('nequi', 'Nequi', 20, { u: 50 })],
    });
    // solo se suman las semillas que a no tenía (nequi_pareja y los apartados), nada más
    const esperado = clone(a);
    esperado.bolsillos.push(emptyDB().bolsillos.find(b => b.id === 'nequi_pareja'));
    esperado.fondos = emptyDB().fondos;
    assert.deepEqual(norm(mergeDB(a, emptyDB())), norm(esperado));
    assert.deepEqual(norm(mergeDB(emptyDB(), a)), norm(esperado));
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   2. balances
════════════════════════════════════════════════════════════════════════════ */
describe('balances', () => {
  const pockets = (ef = 0, nq = 0) => [B.bolsillo('efectivo', 'Efectivo', ef), B.bolsillo('nequi', 'Nequi', nq)];

  test('sin movimientos: cada bolsillo = su saldo inicial (ini)', () => {
    assert.deepEqual(balances(makeDB({ bolsillos: pockets(150000, 800000) })), { efectivo: 150000, nequi: 800000 });
  });

  test('db vacía / undefined / null → {} (y emptyDB → ceros)', () => {
    assert.deepEqual(balances(undefined), {});
    assert.deepEqual(balances(null), {});
    assert.deepEqual(balances({}), {});
    assert.deepEqual(balances(emptyDB()), { efectivo: 0, nequi: 0, nequi_pareja: 0 });
  });

  test('compra con bolsillo descuenta el costo; con "" (no salió de mis bolsillos) o sin campo no mueve plata', () => {
    const db = makeDB({
      bolsillos: pockets(0, 1000000),
      items: [
        B.item({ buyPrice: 300000, buyPocket: 'nequi' }),
        B.item({ buyPrice: 50000, buyPocket: '' }),
        (() => { const i = B.item({ buyPrice: 70000 }); delete i.buyPocket; return i; })(),
      ],
    });
    assert.deepEqual(balances(db), { efectivo: 0, nequi: 700000 });
  });

  test('venta pagada completa: entra sellPaid (= precio) al bolsillo de venta; el costo ya salió en la compra', () => {
    const db = makeDB({
      bolsillos: pockets(0, 500000),
      items: [B.sold({ buyPrice: 200000, buyPocket: 'nequi', sellPrice: 350000, sellPaid: 350000, sellPocket: 'efectivo' })],
    });
    assert.deepEqual(balances(db), { efectivo: 350000, nequi: 300000 });
  });

  test('venta SIN sellPaid (undefined o null) se toma como pagada completa por sellPrice', () => {
    for (const extra of [{}, { sellPaid: null }, { sellPaid: undefined }]) {
      const db = makeDB({ items: [B.sold({ buyPrice: 0, sellPrice: 150000, sellPocket: 'nequi', ...extra })] });
      assert.equal(balances(db).nequi, 150000, JSON.stringify(extra));
    }
  });

  test('venta a crédito: solo entra lo pagado; el cobro automático (bolsillo "") no mueve plata; los abonos entran después', () => {
    const it = B.sold({ id: 'iCredito', buyPrice: 400000, buyPocket: 'efectivo', sellPrice: 600000, sellPaid: 250000, sellPocket: 'nequi' });
    const c = B.cobro({ id: 'cCredito', total: 350000, pagado: 0, bolsillo: '', itemId: 'iCredito' });
    const db = makeDB({ items: [it], cobros: [c] });
    assert.deepEqual(balances(db), { efectivo: -400000, nequi: 250000 });
    db.abonos.push(B.abono({ cobroId: 'cCredito', monto: 100000, bolsillo: 'efectivo' }));
    assert.deepEqual(balances(db), { efectivo: -300000, nequi: 250000 });
  });

  test('sellPaid 0 (todo a crédito) NO cae al precio de venta: entra 0', () => {
    const db = makeDB({ items: [B.sold({ sellPrice: 500000, sellPaid: 0, sellPocket: 'nequi' })] });
    assert.equal(balances(db).nequi, 0);
  });

  test('un producto en stock NO suma venta aunque traiga sellPrice/sellPocket (solo cuenta si status sold)', () => {
    const db = makeDB({ items: [B.item({ status: 'stock', buyPrice: 100, buyPocket: 'nequi', sellPrice: 999, sellPocket: 'nequi' })] });
    assert.equal(balances(db).nequi, -100);
  });

  test('venta sin sellPocket ("" o ausente) no mueve plata', () => {
    const db = makeDB({ items: [B.sold({ sellPrice: 500000, sellPocket: '' }), B.sold({ sellPrice: 1, sellPocket: undefined })] });
    assert.deepEqual(balances(db), { efectivo: 0, nequi: 0 });
  });

  test('gastos restan e ingresos suman en su bolsillo (negocio y personal por igual)', () => {
    const db = makeDB({
      bolsillos: pockets(100000, 0),
      gastos: [B.gasto({ valor: 12000, tipo: 'negocio', bolsillo: 'nequi' }), B.gasto({ valor: 18000, tipo: 'personal', bolsillo: 'efectivo' })],
      ingresos: [B.ingreso({ valor: 1300000, bolsillo: 'nequi' }), B.ingreso({ valor: 5000, bolsillo: 'efectivo' })],
    });
    assert.deepEqual(balances(db), { efectivo: 87000, nequi: 1288000 });
  });

  test('préstamo (cobro con bolsillo): sale total − pagado; sin pagado inicial sale el total', () => {
    const db = makeDB({
      bolsillos: pockets(0, 1000000),
      cobros: [
        B.cobro({ total: 300000, pagado: 0, bolsillo: 'nequi' }),                       // −300.000
        B.cobro({ total: 300000, pagado: 100000, bolsillo: 'nequi' }),                  // −200.000 (ya abonó 100.000 al crear)
      ],
    });
    assert.equal(balances(db).nequi, 500000);
  });

  test('cobro "me deben" sin bolsillo ("") no mueve plata hasta que lleguen abonos', () => {
    const c = B.cobro({ id: 'c1', total: 200000, pagado: 50000, bolsillo: '' });
    const db = makeDB({ cobros: [c] });
    assert.deepEqual(balances(db), { efectivo: 0, nequi: 0 });
    db.abonos.push(B.abono({ cobroId: 'c1', monto: 30000, bolsillo: 'nequi' }));
    assert.deepEqual(balances(db), { efectivo: 0, nequi: 30000 });
  });

  test('abonos suman al bolsillo indicado en el abono (no al del cobro)', () => {
    const db = makeDB({
      cobros: [B.cobro({ id: 'c1', total: 100000, bolsillo: 'nequi' })],
      abonos: [B.abono({ cobroId: 'c1', monto: 40000, bolsillo: 'efectivo' })],
    });
    assert.deepEqual(balances(db), { efectivo: 40000, nequi: -100000 });
  });

  test('transfers mueven plata entre bolsillos y conservan el total', () => {
    const db = makeDB({
      bolsillos: pockets(10000, 500000),
      transfers: [B.transfer({ from: 'nequi', to: 'efectivo', monto: 150000 }), B.transfer({ from: 'efectivo', to: 'nequi', monto: 20000 })],
    });
    const b = balances(db);
    assert.deepEqual(b, { efectivo: 140000, nequi: 370000 });
    assert.equal(b.efectivo + b.nequi, 510000);
  });

  test('transfer con un extremo vacío ("") solo mueve el otro lado', () => {
    const db = makeDB({ bolsillos: pockets(0, 100), transfers: [B.transfer({ from: '', to: 'nequi', monto: 50 }), B.transfer({ from: 'nequi', to: '', monto: 30 })] });
    assert.equal(balances(db).nequi, 120);
    assert.equal(balances(db).efectivo, 0);
  });

  test('ajustes suman delta (positivo o negativo)', () => {
    const db = makeDB({ bolsillos: pockets(0, 100000), ajustes: [B.ajuste({ bolsillo: 'nequi', delta: -5000 }), B.ajuste({ bolsillo: 'efectivo', delta: 2000 })] });
    assert.deepEqual(balances(db), { efectivo: 2000, nequi: 95000 });
  });

  test('TODOS los tipos juntos (cálculo a mano: efectivo 284.000, nequi 1.283.000, caja 1.567.000)', () => {
    const db = makeDB({
      bolsillos: pockets(100000, 500000),
      items: [
        B.item({ buyPrice: 300000, buyPocket: 'nequi' }),                                                   // nequi −300.000
        B.item({ buyPrice: 50000, buyPocket: '' }),                                                         // nada
        B.sold({ buyPrice: 200000, buyPocket: 'nequi', sellPrice: 350000, sellPaid: 350000, sellPocket: 'efectivo' }), // nequi −200.000, efectivo +350.000
        B.sold({ buyPrice: 400000, buyPocket: 'efectivo', sellPrice: 600000, sellPaid: 250000, sellPocket: 'nequi' }), // efectivo −400.000, nequi +250.000
        B.sold({ buyPrice: 100000, buyPocket: 'nequi', sellPrice: 150000, sellPocket: 'nequi' }),            // nequi −100.000 +150.000 (sin sellPaid)
      ],
      gastos: [B.gasto({ valor: 12000, tipo: 'negocio', bolsillo: 'nequi' }), B.gasto({ valor: 18000, bolsillo: 'efectivo' })],
      ingresos: [B.ingreso({ valor: 1300000, bolsillo: 'nequi' })],
      cobros: [
        B.cobro({ id: 'c1', total: 350000, pagado: 0, bolsillo: '' }),                                      // venta a crédito: nada
        B.cobro({ id: 'c2', total: 300000, pagado: 100000, bolsillo: 'nequi' }),                            // préstamo: nequi −200.000
      ],
      abonos: [B.abono({ cobroId: 'c1', monto: 100000, bolsillo: 'efectivo' }), B.abono({ cobroId: 'c2', monto: 50000, bolsillo: 'nequi' })],
      transfers: [B.transfer({ from: 'nequi', to: 'efectivo', monto: 150000 })],
      ajustes: [B.ajuste({ bolsillo: 'nequi', delta: -5000 }), B.ajuste({ bolsillo: 'efectivo', delta: 2000 })],
    });
    const b = balances(db);
    assert.deepEqual(b, { efectivo: 284000, nequi: 1283000 });
    assert.equal(b.efectivo + b.nequi, 1567000);
    assert.deepEqual(b, ledgerBalances(db), 'core.balances debe coincidir con el oráculo independiente');
  });

  test('registros borrados (del:1) se ignoran en TODAS las colecciones, también los bolsillos', () => {
    const db = makeDB({
      bolsillos: [B.bolsillo('efectivo', 'Efectivo', 100), B.bolsillo('nequi', 'Nequi', 100), B.bolsillo('viejo', 'Viejo', 5000, { del: 1 })],
      items: [B.item({ buyPrice: 10, buyPocket: 'nequi', del: 1 }), B.sold({ buyPrice: 0, sellPrice: 99, sellPocket: 'nequi', del: 1 })],
      gastos: [B.gasto({ valor: 10, bolsillo: 'nequi', del: 1 })],
      ingresos: [B.ingreso({ valor: 10, bolsillo: 'nequi', del: 1 })],
      cobros: [B.cobro({ total: 10, bolsillo: 'nequi', del: 1 })],
      abonos: [B.abono({ monto: 10, bolsillo: 'nequi', del: 1 })],
      transfers: [B.transfer({ from: 'nequi', to: 'efectivo', monto: 10, del: 1 })],
      ajustes: [B.ajuste({ bolsillo: 'nequi', delta: 10, del: 1 })],
    });
    assert.deepEqual(balances(db), { efectivo: 100, nequi: 100 });
  });

  test('bolsillo desconocido (id que no existe en bolsillos): aparece en el resultado con su saldo (la plata no se pierde)', () => {
    const db = makeDB({ gastos: [B.gasto({ valor: 5000, bolsillo: 'daviplata' })], ingresos: [B.ingreso({ valor: 2000, bolsillo: 'daviplata' })] });
    assert.deepEqual(balances(db), { efectivo: 0, nequi: 0, daviplata: -3000 });
  });

  test('un bolsillo eliminado con movimientos vivos "reaparece" por id con el saldo de sus movimientos, SIN su ini', () => {
    const db = makeDB({
      bolsillos: [B.bolsillo('efectivo', 'Efectivo', 0), B.bolsillo('nequi', 'Nequi', 0), B.bolsillo('ahorros', 'Ahorros', 1000000, { del: 1 })],
      gastos: [B.gasto({ valor: 200, bolsillo: 'ahorros' })],
    });
    assert.equal(balances(db).ahorros, -200);
  });

  test('montos como string numérico se coercionan; undefined/NaN cuentan como 0', () => {
    const db = makeDB({
      gastos: [B.gasto({ valor: '5000', bolsillo: 'nequi' }), B.gasto({ valor: undefined, bolsillo: 'nequi' }), B.gasto({ valor: 'abc', bolsillo: 'nequi' })],
      items: [B.item({ buyPrice: '1200', buyPocket: 'nequi' }), B.item({ buyPocket: 'nequi', buyPrice: undefined })],
    });
    assert.equal(balances(db).nequi, -6200);
  });

  test('DOCUMENTADO: un abono cuyo cobro fue eliminado SIGUE sumando al saldo (la UI debe borrar los abonos en cascada)', () => {
    const db = makeDB({
      cobros: [B.cobro({ id: 'c1', total: 1000, bolsillo: 'nequi', del: 1 })],
      abonos: [B.abono({ cobroId: 'c1', monto: 400, bolsillo: 'nequi' })],
    });
    assert.equal(balances(db).nequi, 400);
    assert.deepEqual(cobrosPend(db), []);
  });

  test('no muta la db', () => {
    const db = deepFreeze(makeDB({ gastos: [B.gasto({ valor: 1, bolsillo: 'nequi' })], bolsillos: pockets(1, 2) }));
    assert.doesNotThrow(() => balances(db));
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   3. cobroPagado / cobrosPend
════════════════════════════════════════════════════════════════════════════ */
describe('cobroPagado / cobrosPend', () => {
  test('cobroPagado = pagado inicial + abonos vivos de ESE cobro', () => {
    const c = B.cobro({ id: 'c1', total: 500000, pagado: 100000 });
    const db = makeDB({
      cobros: [c, B.cobro({ id: 'c2', total: 1 })],
      abonos: [
        B.abono({ cobroId: 'c1', monto: 50000 }), B.abono({ cobroId: 'c1', monto: 150000 }),
        B.abono({ cobroId: 'c1', monto: 999999, del: 1 }),   // borrado: no cuenta
        B.abono({ cobroId: 'c2', monto: 7 }),                // de otro cobro: no cuenta
      ],
    });
    assert.equal(cobroPagado(db, c), 300000);
  });

  test('cobroPagado: sin pagado ni abonos = 0; pagado undefined/string se coerciona', () => {
    const db = makeDB();
    assert.equal(cobroPagado(db, { id: 'x' }), 0);
    assert.equal(cobroPagado(db, { id: 'x', pagado: '2500' }), 2500);
  });

  test('cobrosPend: solo pendientes, con pag y pend calculados, y conserva los campos originales', () => {
    const c1 = B.cobro({ id: 'c1', nombre: 'Juan', total: 500000, pagado: 100000, compromiso: '2026-10-01', tel: '3001234567' });
    const db = makeDB({ cobros: [c1], abonos: [B.abono({ cobroId: 'c1', monto: 150000 })] });
    const r = cobrosPend(db);
    assert.equal(r.length, 1);
    assert.equal(r[0].pag, 250000);
    assert.equal(r[0].pend, 250000);
    assert.equal(r[0].nombre, 'Juan');
    assert.equal(r[0].compromiso, '2026-10-01');
    assert.equal(r[0].tel, '3001234567');
  });

  test('cobrosPend NO muta los cobros originales (no les agrega pag/pend)', () => {
    const c1 = B.cobro({ id: 'c1', total: 100 });
    const db = makeDB({ cobros: [c1] });
    cobrosPend(db);
    assert.equal('pend' in c1, false);
    assert.equal('pag' in c1, false);
  });

  test('un cobro saldado (pend 0), sobrepagado o eliminado NO aparece', () => {
    const db = makeDB({
      cobros: [
        B.cobro({ id: 'saldado', total: 100, pagado: 100 }),
        B.cobro({ id: 'abonado', total: 100, pagado: 0 }),
        B.cobro({ id: 'sobre', total: 100, pagado: 150 }),
        B.cobro({ id: 'borrado', total: 100, del: 1 }),
        B.cobro({ id: 'vivo', total: 100 }),
      ],
      abonos: [B.abono({ cobroId: 'abonado', monto: 100 })],
    });
    assert.deepEqual(cobrosPend(db).map(c => c.id), ['vivo']);
  });

  test('sobrepago: pend nunca es negativo (Math.max 0) y cobroPagado sí refleja lo realmente pagado', () => {
    const c = B.cobro({ id: 'c1', total: 100, pagado: 0 });
    const db = makeDB({ cobros: [c], abonos: [B.abono({ cobroId: 'c1', monto: 130 })] });
    assert.equal(cobroPagado(db, c), 130);
    assert.deepEqual(cobrosPend(db), []);
  });

  test('venta a crédito: el cobro por la diferencia queda pendiente hasta que los abonos lo cubran', () => {
    const c = B.cobro({ id: 'cv', total: 350000, pagado: 0, bolsillo: '', itemId: 'i1' });
    const db = makeDB({ cobros: [c], abonos: [B.abono({ cobroId: 'cv', monto: 100000 })] });
    assert.equal(cobrosPend(db)[0].pend, 250000);
    db.abonos.push(B.abono({ cobroId: 'cv', monto: 250000 }));
    assert.deepEqual(cobrosPend(db), [], '¡Saldado!');
  });

  test('db vacía → []', () => {
    assert.deepEqual(cobrosPend(emptyDB()), []);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   4. monthStats
════════════════════════════════════════════════════════════════════════════ */
describe('monthStats', () => {
  // Octubre-2026: A, B, F vendidos; D en stock; G se compra en oct y se vende en nov; E borrado.
  const dbMS = () => makeDB({
    items: [
      B.sold({ id: 'A', buyDate: '2026-09-20', buyPrice: 1000000, sellDate: '2026-10-02', sellPrice: 1300000 }),
      B.sold({ id: 'B', buyDate: '2026-10-01', buyPrice: 200000, sellDate: '2026-10-04', sellPrice: 260000 }),
      B.sold({ id: 'C', buyDate: '2026-09-01', buyPrice: 500000, sellDate: '2026-09-28', sellPrice: 700000 }),
      B.item({ id: 'D', buyDate: '2026-10-03', buyPrice: 400000 }),
      B.sold({ id: 'E', buyDate: '2026-10-01', buyPrice: 1, sellDate: '2026-10-02', sellPrice: 999999, del: 1 }),
      B.sold({ id: 'F', buyDate: '2026-10-10', buyPrice: 100000, sellDate: '2026-10-31', sellPrice: 150000 }),
      B.sold({ id: 'G', buyDate: '2026-10-20', buyPrice: 300000, sellDate: '2026-11-01', sellPrice: 400000 }),
    ],
    gastos: [
      B.gasto({ cat: 'Envíos', tipo: 'negocio', valor: 12000, fecha: '2026-10-01' }),
      B.gasto({ cat: 'Envíos', tipo: 'negocio', valor: 8000, fecha: '2026-10-15' }),
      B.gasto({ cat: 'Empaques', tipo: 'negocio', valor: 25000, fecha: '2026-10-31' }),
      B.gasto({ cat: 'Comida', tipo: 'personal', valor: 18000, fecha: '2026-10-02' }),
      B.gasto({ cat: 'Comida', tipo: 'personal', valor: 30000, fecha: '2026-10-03' }),
      B.gasto({ cat: 'Entretenimiento', tipo: 'personal', valor: 50000, fecha: '2026-10-04' }),
      B.gasto({ cat: 'Otro', tipo: undefined, valor: 7000, fecha: '2026-10-05' }),                 // sin tipo → personal
      B.gasto({ cat: 'Envíos', tipo: 'negocio', valor: 5000, fecha: '2026-09-30' }),               // septiembre
      B.gasto({ cat: 'Envíos', tipo: 'negocio', valor: 9000, fecha: '2026-11-01' }),               // noviembre
      B.gasto({ cat: 'Envíos', tipo: 'negocio', valor: 777777, fecha: '2026-10-10', del: 1 }),     // borrado
    ],
    ingresos: [
      B.ingreso({ valor: 1300000, fecha: '2026-10-01' }), B.ingreso({ valor: 100000, fecha: '2026-10-03' }),
      B.ingreso({ valor: 500000, fecha: '2026-09-15' }), B.ingreso({ valor: 5, fecha: '2026-10-02', del: 1 }),
    ],
  });

  test('mes concreto 2026-10: ventas, costo, bruta, gastos, neta, margen, compras, ingresos, diasProm', () => {
    const r = monthStats(dbMS(), '2026-10');
    assert.equal(r.nVentas, 3);
    assert.deepEqual(r.sold.map(i => i.id).sort(), ['A', 'B', 'F']);
    assert.equal(r.ventas, 1710000);        // 1.300.000 + 260.000 + 150.000
    assert.equal(r.costo, 1300000);         // 1.000.000 + 200.000 + 100.000
    assert.equal(r.bruta, 410000);
    assert.equal(r.gN, 45000);              // 12.000 + 8.000 + 25.000
    assert.equal(r.gP, 105000);             // 18.000 + 30.000 + 50.000 + 7.000 (sin tipo = personal)
    assert.equal(r.neta, 365000);
    assert.ok(Math.abs(r.margen - 365000 / 1710000 * 100) < 1e-9, `margen ${r.margen}`);
    assert.equal(r.compras, 1000000);       // B 200.000 + D 400.000 + F 100.000 + G 300.000 (por buyDate)
    assert.equal(r.ing, 1400000);
    assert.equal(r.diasProm, 12);           // A 12d, B 3d, F 21d → 36/3
  });

  test('cats: clave "🏢 cat" para negocio y "👤 cat" para personal/sin tipo, sumando por categoría', () => {
    assert.deepEqual(monthStats(dbMS(), '2026-10').cats, {
      '🏢 Envíos': 20000, '🏢 Empaques': 25000, '👤 Comida': 48000, '👤 Entretenimiento': 50000, '👤 Otro': 7000,
    });
  });

  test('límites del mes: 31 de octubre cuenta en octubre; 1 de noviembre no', () => {
    const oct = monthStats(dbMS(), '2026-10');
    const nov = monthStats(dbMS(), '2026-11');
    assert.ok(oct.sold.some(i => i.id === 'F'));
    assert.ok(!oct.sold.some(i => i.id === 'G'));
    assert.deepEqual(nov.sold.map(i => i.id), ['G']);
    assert.equal(nov.gN, 9000);
  });

  test('septiembre: solo C; gastos de negocio 5.000; diasProm 27', () => {
    const r = monthStats(dbMS(), '2026-09');
    assert.deepEqual(r.sold.map(i => i.id), ['C']);
    assert.equal(r.ventas, 700000);
    assert.equal(r.bruta, 200000);
    assert.equal(r.gN, 5000);
    assert.equal(r.neta, 195000);
    assert.ok(Math.abs(r.margen - 195 / 700 * 100) < 1e-9);
    assert.equal(r.compras, 1500000);       // A (20-sep) + C (1-sep)
    assert.equal(r.ing, 500000);
    assert.equal(r.diasProm, 27);
  });

  test('ym = null → todo el histórico', () => {
    const r = monthStats(dbMS(), null);
    assert.equal(r.nVentas, 5);             // A B C F G (E borrado)
    assert.equal(r.ventas, 2810000);
    assert.equal(r.costo, 2100000);
    assert.equal(r.bruta, 710000);
    assert.equal(r.gN, 59000);              // 45.000 + 5.000 + 9.000 (el borrado no)
    assert.equal(r.neta, 651000);
    assert.equal(r.compras, 2500000);       // A+B+C+D+F+G
    assert.equal(r.ing, 1900000);
    assert.equal(r.diasProm, 15);           // 12+3+27+21+12 = 75 → /5
    assert.deepEqual(monthStats(dbMS()).nVentas, 5, 'sin segundo argumento = histórico');
  });

  test('mes sin ventas: nVentas 0, margen 0 (no NaN), diasProm null, sold [] y cats {}', () => {
    const r = monthStats(dbMS(), '2026-08');
    assert.equal(r.nVentas, 0);
    assert.deepEqual(r.sold, []);
    assert.equal(r.ventas, 0); assert.equal(r.costo, 0); assert.equal(r.bruta, 0);
    assert.equal(r.margen, 0);
    assert.equal(r.diasProm, null);
    assert.deepEqual(r.cats, {});
  });

  test('mes con gastos de negocio pero sin ventas: neta negativa y margen 0 (no -Infinity/NaN)', () => {
    const db = makeDB({ gastos: [B.gasto({ tipo: 'negocio', cat: 'Envíos', valor: 15000, fecha: '2026-10-02' })] });
    const r = monthStats(db, '2026-10');
    assert.equal(r.neta, -15000);
    assert.equal(r.margen, 0);
    assert.ok(Number.isFinite(r.margen));
  });

  test('margen negativo cuando se vende con pérdida', () => {
    const db = makeDB({
      items: [B.sold({ buyPrice: 150000, sellPrice: 100000, buyDate: '2026-10-01', sellDate: '2026-10-02' })],
      gastos: [B.gasto({ tipo: 'negocio', valor: 10000, fecha: '2026-10-02' })],
    });
    const r = monthStats(db, '2026-10');
    assert.equal(r.bruta, -50000);
    assert.equal(r.neta, -60000);
    assert.ok(Math.abs(r.margen - -60) < 1e-9);
  });

  test('negocio vs personal: tipo "negocio" va a gN; cualquier otro (personal, undefined, "") a gP', () => {
    const db = makeDB({
      gastos: [
        B.gasto({ tipo: 'negocio', valor: 1, fecha: '2026-10-01' }), B.gasto({ tipo: 'personal', valor: 10, fecha: '2026-10-01' }),
        B.gasto({ tipo: undefined, valor: 100, fecha: '2026-10-01' }), B.gasto({ tipo: '', valor: 1000, fecha: '2026-10-01' }),
      ],
    });
    const r = monthStats(db, '2026-10');
    assert.equal(r.gN, 1);
    assert.equal(r.gP, 1110);
  });

  test('una venta a crédito se reconoce completa al vender (ventas = precio, aunque parte esté por cobrar)', () => {
    const db = makeDB({ items: [B.sold({ buyPrice: 100, sellPrice: 300, sellPaid: 50, buyDate: '2026-10-01', sellDate: '2026-10-02' })] });
    const r = monthStats(db, '2026-10');
    assert.equal(r.ventas, 300);
    assert.equal(r.bruta, 200);
  });

  test('un producto en stock con sellDate en el mes NO cuenta como venta', () => {
    const db = makeDB({ items: [B.item({ status: 'stock', sellDate: '2026-10-02', sellPrice: 99999, buyPrice: 10, buyDate: '2026-10-01' })] });
    const r = monthStats(db, '2026-10');
    assert.equal(r.nVentas, 0);
    assert.equal(r.compras, 10);
  });

  test('un gasto sin cat no produce la clave "undefined" (usa "Otro")', () => {
    const g1 = B.gasto({ tipo: 'negocio', valor: 1000, fecha: '2026-10-01' }); delete g1.cat;
    const g2 = B.gasto({ tipo: 'personal', valor: 500, fecha: '2026-10-01' }); delete g2.cat;
    const r = monthStats(makeDB({ gastos: [g1, g2] }), '2026-10');
    assert.deepEqual(r.cats, { '🏢 Otro': 1000, '👤 Otro': 500 });
  });

  test('db vacía: todo en cero y sin romper', () => {
    const r = monthStats(emptyDB(), '2026-10');
    assert.deepEqual([r.nVentas, r.ventas, r.costo, r.bruta, r.gN, r.gP, r.neta, r.margen, r.compras, r.ing], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(r.diasProm, null);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   5. Fechas
════════════════════════════════════════════════════════════════════════════ */
describe('fechas: shiftDate / daysBetween / today', () => {
  const SHIFT = [
    ['2026-10-05', 0, '2026-10-05'], ['2026-10-05', 1, '2026-10-06'], ['2026-10-05', -5, '2026-09-30'],
    ['2026-10-05', -6, '2026-09-29'], ['2026-10-05', 30, '2026-11-04'], ['2026-10-05', -30, '2026-09-05'],
    ['2026-01-31', 1, '2026-02-01'], ['2026-02-28', 1, '2026-03-01'], ['2026-05-31', 1, '2026-06-01'],
    ['2026-03-31', -31, '2026-02-28'],
    ['2028-02-28', 1, '2028-02-29'], ['2028-02-29', 1, '2028-03-01'], ['2028-03-01', -1, '2028-02-29'], ['2027-03-01', -1, '2027-02-28'],
    ['2026-12-31', 1, '2027-01-01'], ['2026-01-01', -1, '2025-12-31'], ['2026-12-31', -365, '2025-12-31'],
    ['2026-10-05', 365, '2027-10-05'], ['2027-10-05', 366, '2028-10-05'], ['2024-02-29', 365, '2025-02-28'],
  ];
  for (const [s, n, esperado] of SHIFT)
    test(`shiftDate('${s}', ${n}) = ${esperado}`, () => assert.equal(shiftDate(s, n), esperado));

  const DIAS = [
    ['2026-10-05', '2026-10-05', 0], ['2026-10-01', '2026-10-05', 4], ['2026-09-30', '2026-10-01', 1],
    ['2026-02-28', '2026-03-01', 1], ['2028-02-28', '2028-03-01', 2], ['2026-12-31', '2027-01-01', 1],
    ['2025-10-05', '2026-10-05', 365], ['2027-10-05', '2028-10-05', 366], ['2026-01-01', '2026-12-31', 364],
    ['2026-09-05', '2026-10-05', 30],
  ];
  for (const [a, b, esperado] of DIAS)
    test(`daysBetween('${a}', '${b}') = ${esperado}`, () => assert.equal(daysBetween(a, b), esperado));

  test('daysBetween: si b es anterior a a devuelve 0 (no negativos) y con fechas vacías devuelve 0', () => {
    assert.equal(daysBetween('2026-10-05', '2026-10-01'), 0);
    for (const [a, b] of [['', '2026-10-01'], [undefined, '2026-10-01'], ['2026-10-01', null], [null, null], ['', '']])
      assert.equal(daysBetween(a, b), 0);
  });

  test('shiftDate y daysBetween NO dependen de la zona horaria del dispositivo (ni de su horario de verano)', () => {
    const zonas = ['UTC', 'America/Bogota', 'America/New_York', 'Europe/Madrid', 'Asia/Tokyo', 'Pacific/Auckland', 'America/Sao_Paulo', 'Asia/Kolkata'];
    const casos = [
      () => [shiftDate('2026-03-07', 1), '2026-03-08'], () => [shiftDate('2026-03-08', 1), '2026-03-09'],     // EE. UU. adelanta el reloj
      () => [shiftDate('2026-10-24', 1), '2026-10-25'], () => [shiftDate('2026-10-25', 1), '2026-10-26'],     // Europa atrasa
      () => [shiftDate('2026-11-01', 1), '2026-11-02'], () => [shiftDate('2026-09-26', 2), '2026-09-28'],     // EE. UU. atrasa / Nueva Zelanda adelanta
      () => [shiftDate('2018-11-03', 1), '2018-11-04'], () => [shiftDate('2018-11-04', 1), '2018-11-05'],     // São Paulo: la medianoche no existía
      () => [daysBetween('2026-03-07', '2026-03-09'), 2], () => [daysBetween('2026-10-24', '2026-10-26'), 2],
      () => [daysBetween('2026-10-31', '2026-11-02'), 2], () => [daysBetween('2026-09-26', '2026-09-28'), 2],
    ];
    for (const tz of zonas) withTZ(tz, () => casos.forEach((c, i) => { const [got, want] = c(); assert.equal(got, want, `${tz} caso ${i}`); }));
  });

  test('today() es la fecha LOCAL de Colombia: a las 10 p. m. (ya es mañana en UTC) sigue siendo hoy', () => {
    assert.equal(withNow('2026-10-05T22:00:00-05:00', today), '2026-10-05');   // 03:00 UTC del 6
    assert.equal(withNow('2026-10-05T23:59:59-05:00', today), '2026-10-05');
    assert.equal(withNow('2026-10-06T00:00:00-05:00', today), '2026-10-06');
    assert.equal(withNow('2026-10-05T00:00:00-05:00', today), '2026-10-05');
    assert.equal(withNow(NOW_ISO, today), HOY);
  });

  test('today() en Apps Script usa Utilities.formatDate(..., "America/Bogota", "yyyy-MM-dd"), aunque la zona del script sea otra', () => {
    const llamadas = [];
    globalThis.Utilities = {
      formatDate(d, tz, pat) {
        llamadas.push([tz, pat]);
        return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      },
    };
    try {
      withTZ('UTC', () => {
        // 10 p. m. del 5 en Bogotá = 03:00 UTC del 6: sin Utilities saldría 2026-10-06
        assert.equal(withNow('2026-10-05T22:00:00-05:00', today), '2026-10-05');
      });
    } finally { delete globalThis.Utilities; }
    assert.deepEqual(llamadas, [['America/Bogota', 'yyyy-MM-dd']]);
    // y sin Utilities (navegador), la fecha es la del teléfono
    assert.equal(withTZ('UTC', () => withNow('2026-10-05T22:00:00-05:00', today)), '2026-10-06');
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   6. Formato: fmt / full / fd / monthLabel
════════════════════════════════════════════════════════════════════════════ */
describe('formato: fmt / full / fd / monthLabel', () => {
  const FMT = [
    [0, '$0'], [999, '$999'], [1000, '$1K'], [1499, '$1K'], [12000, '$12K'], [50000, '$50K'], [999499, '$999K'],
    [999500, '$1M'], [999999, '$1M'],                                   // antes salía "$1000K"
    [1e6, '$1M'], [1.2e6, '$1.2M'], [1.25e6, '$1.3M'], [1.5e6, '$1.5M'], [9.96e6, '$10M'], [1e7, '$10M'], [12.5e6, '$13M'], [25e6, '$25M'], [1e9, '$1000M'],
    [-50000, '-$50K'], [-1.2e6, '-$1.2M'], [-999, '-$999'],
    [null, '$0'], [undefined, '$0'], ['abc', '$0'], ['50000', '$50K'], [NaN, '$0'],
  ];
  for (const [n, esperado] of FMT) test(`fmt(${String(n)}) = ${esperado}`, () => assert.equal(fmt(n), esperado));

  test('fmt redondea al millar por debajo de $10.000 (1.500 → "$2K"): comportamiento documentado, usa full() si necesitas exactitud', () => {
    assert.equal(fmt(1500), '$2K');
    assert.equal(fmt(2499), '$2K');
  });

  const FULL = [
    [0, '$0'], [7, '$7'], [999, '$999'], [1000, '$1.000'], [12345, '$12.345'], [1200000, '$1.200.000'], [12345678, '$12.345.678'],
    [-1200000, '-$1.200.000'], [-500, '-$500'], [1234.5, '$1.235'], ['5000', '$5.000'], [null, '$0'], [undefined, '$0'], [NaN, '$0'], [-0.4, '$0'],
  ];
  for (const [n, esperado] of FULL) test(`full(${String(n)}) = ${esperado}`, () => assert.equal(full(n), esperado));

  const FD = [['2026-10-05', '05/10/26'], ['2026-01-09', '09/01/26'], ['2027-12-31', '31/12/27'], ['2026-02-28', '28/02/26'], ['', '—'], [null, '—'], [undefined, '—']];
  for (const [d, esperado] of FD) test(`fd(${JSON.stringify(d)}) = ${esperado}`, () => assert.equal(fd(d), esperado));

  test('monthLabel y MESES', () => {
    assert.equal(core.MESES.length, 12);
    assert.deepEqual([core.MESES[0], core.MESES[11]], ['Ene', 'Dic']);
    assert.equal(core.monthLabel('2026-10'), 'Oct 26');
    assert.equal(core.monthLabel('2026-01'), 'Ene 26');
    assert.equal(core.monthLabel('2026-12'), 'Dic 26');
    assert.equal(core.monthLabel('2027-03'), 'Mar 27');
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   7. extractMonto / parseMoney
════════════════════════════════════════════════════════════════════════════ */
describe('extractMonto: montos en lenguaje natural colombiano', () => {
  const MONTOS = [
    // millones
    ['1.2M', 1200000], ['1,2M', 1200000], ['1.2 M', 1200000], ['1M', 1000000], ['0.5M', 500000], ['1.2m', 1200000],
    ['2.5 millones', 2500000], ['1,5 millones', 1500000], ['1 millón', 1000000], ['1 millon', 1000000], ['1 MILLÓN', 1000000],
    ['2 palos', 2000000], ['1 palo', 1000000], ['2 melones', 2000000], ['1 melón', 1000000],
    ['3 millones 500 mil', 3500000], ['1 millón 200 mil', 1200000], ['2 palos y 500 mil', 2500000], ['2 palos 300 lucas', 2300000],
    // miles
    ['50 lucas', 50000], ['1 luca', 1000], ['50 barras', 50000], ['18 mil', 18000], ['850k', 850000], ['12K', 12000],
    ['50 mil pesos', 50000], ['  50   mil  ', 50000], ['12,5 mil', 12500], ['50k.', 50000],
    // con puntos de miles y $
    ['$50.000', 50000], ['$ 50.000,00', 50000], ['1.200.000', 1200000], ['$1.200.000', 1200000], ['1.200.000,50', 1200000],
    ['12.500,00', 12500], ['$ 1.250.000 pesos', 1250000],
    // enteros pelados
    ['1500000', 1500000], ['4500', 4500], ['$50', 50], ['2000', 2000],
    // el $ pegado a k/mil/M
    ['$50k', 50000], ['$ 50 mil', 50000], ['$1.2M', 1200000],
    // signos de puntuación alrededor de la unidad
    ['(50k)', 50000], ['50k;', 50000], ['"2 millones"', 2000000], ['envío: 12k', 12000],
  ];
  for (const [txt, monto] of MONTOS)
    test(`${JSON.stringify(txt)} → ${monto}`, () => assert.equal(extractMonto(txt).monto, monto));

  const SIN_MONTO = [
    'iphone 13 128gb', 'ps5', 'xbox series s', 'xbox 360 500gb', 'galaxy s24 ultra 512gb', 'macbook air m1', 'macbook air m2 16gb',
    'iphone 15 pro max', 'iphone 14 mini', 'nike air max 90', 'camiseta talla m', 'tv 55 pulgadas', 'playstation 4', 'ps4 pro 1tb',
    '3 meses de garantía', '10 kilos', '1kg', '5 minutos', 'cargador 20w', 'mouse 2.4g',
    'hola', '', '   ', null, undefined, 0,
  ];
  for (const txt of SIN_MONTO)
    test(`sin monto: ${JSON.stringify(txt)} → 0`, () => assert.equal(extractMonto(txt).monto, 0));

  describe('años y modelos ("modelo 2024")', () => {
    // DECISIÓN QA: un número de 4 cifras pelado SÍ es un monto válido ("tinto 2500", "pasaje 2000"), así que no se
    // puede descartar por rango. Pero tras "modelo/año/del/versión/edición" es un año: no es plata (BUG corregido).
    const AÑOS = ['modelo 2024', 'año 2020', 'ano 2019', 'versión 2023', 'version 2023', 'del 2018', 'edición 2022', 'iphone 13 modelo 2021', 'moto mod 2022'];
    for (const txt of AÑOS) test(`${JSON.stringify(txt)} NO es un monto`, () => assert.equal(extractMonto(txt).monto, 0));

    test('el año se queda en la descripción (rest) y el precio real se toma de la unidad o del número', () => {
      assert.equal(extractMonto('compré moto modelo 2024 15M').monto, 15000000);
      assert.equal(extractMonto('compré moto modelo 2024 15M').rest.trim(), 'compré moto modelo 2024');
      assert.equal(extractMonto('compré moto modelo 2024 15000000').monto, 15000000);
      assert.equal(extractMonto('compré moto modelo 2024 15000000').rest.trim(), 'compré moto modelo 2024');
      assert.equal(extractMonto('carro del 2019 12.000.000').monto, 12000000);
    });

    test('un monto de 4 cifras NO se descarta aunque parezca año si no hay palabra de contexto (pasaje 2000, tinto 2500)', () => {
      assert.equal(extractMonto('pasaje 2000').monto, 2000);
      assert.equal(extractMonto('tinto 2024').monto, 2024);   // ambiguo: sin contexto se asume plata
    });
  });

  describe('rest: el texto sin el monto (en minúsculas y con espacios simples; recórtalo con trim)', () => {
    const REST = [
      ['compré ps5 1.2M nequi', 'compré ps5 nequi'], ['almuerzo 18 mil', 'almuerzo'], ['envío 12k nequi', 'envío nequi'],
      ['juan me debe 200k', 'juan me debe'], ['pagué 12.500 de taxi', 'pagué de taxi'], ['tinto 2500', 'tinto'],
      ['vendí iphone 13 128gb 1.5M efectivo', 'vendí iphone 13 128gb efectivo'], ['ps5 slim 2 palos', 'ps5 slim'],
      ['$50k gasolina', 'gasolina'], ['a $50 mil de gasolina', 'a de gasolina'], ['Juan ME DEBE 200K', 'juan me debe'],
      ['gasté $ 15.000,00 en taxi', 'gasté en taxi'], ['sin monto aquí', 'sin monto aquí'],
    ];
    for (const [txt, rest] of REST)
      test(`${JSON.stringify(txt)} → rest ${JSON.stringify(rest)}`, () => assert.equal(extractMonto(txt).rest.trim(), rest));

    test('quita la ocurrencia del monto, no otra igual que aparezca antes', () => {
      assert.equal(extractMonto('50k de 50k').rest.trim(), 'de 50k');       // gana el primero; el segundo queda en el texto
      const r = extractMonto('1500abc 1500');                              // "1500abc" no es monto; el segundo "1500" sí
      assert.equal(r.monto, 1500);
      assert.equal(r.rest.trim(), '1500abc');
    });

    test('rest nunca es undefined, incluso con entradas raras', () => {
      for (const x of [null, undefined, '', 0, 123, {}]) assert.equal(typeof extractMonto(x).rest, 'string');
    });
  });

  describe('LIMITACIONES conocidas (todo): no rompen la suite; si algún día pasan, quita el todo', () => {
    const LIM = [
      ['cincuenta mil', 50000, 'solo entiende dígitos: no reconoce números escritos con letras'],
      ['dos millones', 2000000, 'ídem'],
      ['un palo', 1000000, '"un" no cuenta como 1'],
      ['2 mil 500', 2500, 'miles + resto sin unidad: hoy da 2.000 y deja "500" en rest'],
      ['50 000', 50000, 'separador de miles con espacio: hoy da 0'],
      ['compré carro 2020 15000000', 15000000, 'año suelto ANTES del monto sin palabra de contexto: hoy gana el primero (2020)'],
      ['tenis talla 9 m 150k', 150000, '"m" suelta = millones choca con tallas ("9 m" → 9.000.000 y gana a 150k)'],
    ];
    for (const [txt, monto, porque] of LIM)
      test(`${JSON.stringify(txt)} → ${monto}  (${porque})`, { todo: porque }, () => assert.equal(extractMonto(txt).monto, monto));
  });
});

describe('parseMoney (campos de dinero del formulario)', () => {
  const CASOS = [
    ['', 0], ['   ', 0], [null, 0], [undefined, 0], ['abc', 0], ['0', 0], ['$0', 0], [NaN, 0],
    ['50000', 50000], [50000, 50000], ['1500000', 1500000], ['50', 50],
    ['50.000', 50000], ['1.200.000', 1200000], ['  1.200.000  ', 1200000], ['$50.000', 50000], ['$ 50.000,00', 50000],
    ['50k', 50000], ['50K', 50000], ['850k', 850000], ['50 mil', 50000], ['18 mil', 18000], ['50 lucas', 50000], ['50 barras', 50000],
    ['1.2M', 1200000], ['1,2M', 1200000], ['1,5 millones', 1500000], ['1 millón 200 mil', 1200000], ['2 palos', 2000000],
    [1200000, 1200000],
  ];
  for (const [entrada, esperado] of CASOS)
    test(`parseMoney(${JSON.stringify(entrada)}) = ${esperado}`, () => assert.equal(parseMoney(entrada), esperado));

  test('devuelve siempre un entero (COP no tiene decimales)', () => {
    for (const s of ['1.2M', '1,5 millones', '12,5 mil', '$ 50.000,00', '1200000.5', '12,5']) assert.ok(Number.isInteger(parseMoney(s)), s);
  });

  test('un número escrito con coma decimal sin unidad se redondea ("12,5" → 13)', () => {
    assert.equal(parseMoney('12,5'), 13);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   8. parseNoti
════════════════════════════════════════════════════════════════════════════ */
describe('parseNoti: notificaciones de Nequi / bancos', () => {
  const NOTIS = [
    ['Enviaste $50.000 a Juan Perez', { monto: 50000, dir: 'out', quien: 'Juan Perez' }],
    ['Recibiste $120.000 de Maria Lopez', { monto: 120000, dir: 'in', quien: 'Maria Lopez' }],
    ['Pagaste $12.500 en Exito Laureles', { monto: 12500, dir: 'out', quien: 'Exito Laureles' }],
    ['Retiraste $100.000 en cajero Bancolombia', { monto: 100000, dir: 'out', quien: 'cajero Bancolombia' }],
    ['Retiro exitoso por $100.000', { monto: 100000, dir: 'out', quien: '' }],
    ['Sacaste $100.000 del cajero', { monto: 100000, dir: 'out', quien: '' }],
    ['Recarga exitosa por $50.000', { monto: 50000, dir: 'in', quien: '' }],
    ['Te consignaron $80.000 de PEDRO GOMEZ', { monto: 80000, dir: 'in', quien: 'PEDRO GOMEZ' }],
    ['Te pagaron $20.000', { monto: 20000, dir: 'in', quien: '' }],
    ['Enviaste $50.000,00 a Carlos Ruiz', { monto: 50000, dir: 'out', quien: 'Carlos Ruiz' }],
    ['Enviaste $1.234.567,89 a Maria', { monto: 1234567, dir: 'out', quien: 'Maria' }],
    ['Enviaste $1.200.000 a Maria', { monto: 1200000, dir: 'out', quien: 'Maria' }],
    ['Enviaste $1,200,000 a Maria', { monto: 1200000, dir: 'out', quien: 'Maria' }],
    ['Recibiste 20.000 de Pedro', { monto: 20000, dir: 'in', quien: 'Pedro' }],
    ['Pagaste 8.500 en Rappi', { monto: 8500, dir: 'out', quien: 'Rappi' }],
    ['Compra aprobada por $45.900 en D1 Poblado', { monto: 45900, dir: 'out', quien: 'D1 Poblado' }],
    ['Débito por $15.000 - Netflix', { monto: 15000, dir: 'out', quien: '' }],
    ['Transferiste $200.000 a Juan Perez', { monto: 200000, dir: 'out', quien: 'Juan Perez' }],
    ['Pagaste $30.000 a la cuenta de Juan', { monto: 30000, dir: 'out', quien: 'Juan' }],
    ['Pagaste $80.000 en Servientrega por el envío', { monto: 80000, dir: 'out', quien: 'Servientrega' }],
    ['Recibiste $50.000 de JUAN PEREZ. Tu saldo es $200.000', { monto: 50000, dir: 'in', quien: 'JUAN PEREZ' }],
    ['Enviaste $50.000. Ref 123456', { monto: 50000, dir: 'out', quien: '' }],
    ['Nequi\nEnviaste $50.000\na Juan Perez', { monto: 50000, dir: 'out', quien: 'Juan Perez' }],           // título + texto de MacroDroid
    ['Nequi Enviaste $50.000 a Juan Perez desde tu cuenta Nequi', { monto: 50000, dir: 'out', quien: 'Juan Perez' }],
    ['Pago recibido por $50.000 de Juan', { monto: 50000, dir: 'in', quien: 'Juan' }],                         // BUG corregido: salía "out"
    ['Enviaste $50.000 a Juan Perez el 05/10/2026 a las 10:30 am', { monto: 50000, dir: 'out', quien: 'Juan Perez' }], // BUG corregido: quien traía la fecha
    ['Enviaste $50.000 a Juan Perez el día 5', { monto: 50000, dir: 'out', quien: 'Juan Perez' }],
  ];
  for (const [txt, esperado] of NOTIS)
    test(JSON.stringify(txt), () => assert.deepEqual(parseNoti(txt), esperado));

  describe('sin monto (la captura debe ignorarlas: monto 0)', () => {
    const PROMOS = [
      '¡Gana descuentos en tus compras con Nequi!', 'Aprovecha cashback del 10% en tus compras', 'Tienes un nuevo mensaje en Nequi',
      'Ingresaste a Nequi desde un nuevo dispositivo', 'Actualiza la app para disfrutar de lo nuevo', 'Enviaste $ 0 a Maria',
    ];
    for (const txt of PROMOS) test(JSON.stringify(txt), () => assert.equal(parseNoti(txt).monto, 0));

    for (const x of ['', '   ', null, undefined, 0])
      test(`entrada vacía ${JSON.stringify(x)} → {0,'?',''}`, () => assert.deepEqual(parseNoti(x), { monto: 0, dir: '?', quien: '' }));
  });

  describe('decisión de producto: ¿un banco o un celular como origen/destino cuenta como "quien"?', () => {
    // Hoy la lista negra BL de core.js descarta los bancos (quien = ''); docs/parseNoti-propuesta.js los devuelve.
    // Ambas respuestas son defendibles, así que aquí solo se exige lo que NO puede cambiar: monto y dir.
    const CASOS = [
      ['Recargaste $50.000 desde Bancolombia', 50000, 'in', ['', 'Bancolombia']],
      ['Te enviaron $30.000 desde Bancolombia', 30000, 'in', ['', 'Bancolombia']],
      ['Recarga exitosa de $300.000 desde Bancolombia', 300000, 'in', ['', 'Bancolombia']],
      ['Enviaste $50.000 a 3001234567', 50000, 'out', ['', '3001234567']],
    ];
    for (const [txt, monto, dir, quienes] of CASOS)
      test(`${JSON.stringify(txt)}: monto ${monto}, dir ${dir}, quien ∈ ${JSON.stringify(quienes)}`, () => {
        const r = parseNoti(txt);
        assert.equal(r.monto, monto);
        assert.equal(r.dir, dir);
        assert.ok(quienes.includes(r.quien), `quien = ${JSON.stringify(r.quien)}`);
      });
  });

  test('si hay varios montos con $, toma el PRIMERO (el del movimiento, no el saldo)', () => {
    assert.equal(parseNoti('Pagaste $12.500 en Exito. Tu saldo es $1.234.567').monto, 12500);
  });

  test('dir "?" cuando no hay verbo reconocible (el usuario elige entre todos los botones)', () => {
    assert.equal(parseNoti('Movimiento de $20.000 en tu cuenta').dir, '?');
  });

  test('devuelve siempre las 3 claves con los tipos correctos', () => {
    for (const t of ['Enviaste $5.000 a X', 'hola', '', null]) {
      const r = parseNoti(t);
      assert.deepEqual(Object.keys(r).sort(), ['dir', 'monto', 'quien']);
      assert.equal(typeof r.monto, 'number'); assert.ok(['in', 'out', '?'].includes(r.dir)); assert.equal(typeof r.quien, 'string');
    }
  });

  describe('promos, saldos y remitente antes del verbo (parseNoti de DOCS integrada en core.js, SPEC §10.6)', () => {
    test('formato "Fulano te envió $X" (el remitente va ANTES del verbo)', () => {
      assert.deepEqual(parseNoti('Juan Perez te envió $20.000'), { monto: 20000, dir: 'in', quien: 'Juan Perez' });
    });
    test('promo CON monto ("Gana $20.000 invitando a un amigo") NO es un movimiento: monto 0', () => {
      assert.equal(parseNoti('Gana $20.000 invitando a un amigo').monto, 0);
    });
    test('promo con "mil" sin $ ("Recibe 20 mil de regalo si invitas") tampoco', () => {
      assert.equal(parseNoti('Recibe 20 mil de regalo si invitas a un amigo').monto, 0);
    });
    test('aviso de SALDO ("Tu saldo en Nequi es $1.234.567") no es un movimiento', () => {
      assert.equal(parseNoti('Tu saldo en Nequi es $1.234.567').monto, 0);
    });
    test('pero un movimiento que menciona el saldo SÍ cuenta, con el monto del movimiento y no el del saldo', () => {
      assert.deepEqual(parseNoti('Recibiste $50.000 de JUAN PEREZ. Tu saldo ahora es $170.000'), { monto: 50000, dir: 'in', quien: 'JUAN PEREZ' });
      assert.equal(parseNoti('Retiro en cajero Bancolombia por $200.000. Tu saldo es $5.000').monto, 200000);
      assert.equal(parseNoti('Retiro en cajero Bancolombia por $200.000. Tu saldo es $5.000').dir, 'out');
    });
    test('un código numérico (OTP, código de retiro) sin "$" nunca es plata', () => {
      for (const t of ['Tu código de seguridad de Nequi es 482913', 'Tu código para sacar plata es 123456 y vence en 30 minutos', 'Código 4821'])
        assert.equal(parseNoti(t).monto, 0, t);
    });
    test('una solicitud ("te pidió") o un pago pendiente conservan el monto pero dir "?" (todavía no se movió plata)', () => {
      assert.equal(parseNoti('CARLOS RUIZ te pidió $30.000').dir, '?');
      assert.equal(parseNoti('Tienes un pago pendiente de $45.000 en NETFLIX. Acéptalo o recházalo').dir, '?');
    });
    test('DECISIÓN PENDIENTE: recarga de CELULAR ("Recargaste $5.000 a tu celular Claro") es un gasto (out), pero toda "recarga" se marca in', { todo: 'ambigüedad: recargar Nequi (in) vs recargar celular (out); ver REPORTE-QA.md' }, () => {
      assert.equal(parseNoti('Recargaste $5.000 a tu celular Claro').dir, 'out');
    });
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   9. summaryText / remindersText   (hoy = 2026-10-05 10:00 Bogotá)
════════════════════════════════════════════════════════════════════════════ */
describe('summaryText', () => {
  // Ventana de 7 días = 2026-09-29 … 2026-10-05 (ambos inclusive).
  const dbResumen = () => makeDB({
    bolsillos: [B.bolsillo('efectivo', 'Efectivo', 100000), B.bolsillo('nequi', 'Nequi', 500000)],
    items: [
      B.sold({ desc: 'iPhone 13', buyDate: '2026-09-10', buyPrice: 1000000, buyPocket: 'nequi', sellDate: '2026-10-02', sellPrice: 1300000, sellPaid: 1300000, sellPocket: 'nequi' }),
      B.sold({ desc: 'PS5', buyDate: '2026-09-01', buyPrice: 1500000, buyPocket: 'nequi', sellDate: '2026-09-29', sellPrice: 1800000, sellPocket: 'nequi' }),   // primer día de la ventana: entra
      B.sold({ desc: 'Switch', buyDate: '2026-09-01', buyPrice: 900000, buyPocket: 'nequi', sellDate: '2026-09-28', sellPrice: 1000000, sellPocket: 'nequi' }),   // un día antes: NO entra
      B.item({ desc: 'Xbox Series S', buyDate: '2026-09-05', buyPrice: 800000 }),                                                                                  // 30 días: quieto
      B.item({ desc: 'AirPods', buyDate: '2026-09-06', buyPrice: 250000 }),                                                                                         // 29 días: no
      B.item({ desc: 'Tenis', buyDate: '2026-08-01', buyPrice: 300000 }),                                                                                           // 65 días: quieto
      B.item({ desc: 'Casco', buyDate: '2026-07-01', buyPrice: 120000 }),                                                                                           // 96 días: quieto (no cabe en el texto)
    ],
    gastos: [
      B.gasto({ tipo: 'negocio', valor: 20000, fecha: '2026-10-03', bolsillo: 'nequi' }),
      B.gasto({ tipo: 'negocio', valor: 15000, fecha: '2026-09-29', bolsillo: 'nequi' }),
      B.gasto({ tipo: 'personal', valor: 18000, fecha: '2026-10-05', bolsillo: 'efectivo' }),
      B.gasto({ tipo: 'personal', valor: 12000, fecha: '2026-10-01', bolsillo: 'efectivo' }),
      B.gasto({ tipo: 'negocio', valor: 100000, fecha: '2026-09-28', bolsillo: 'nequi' }),     // fuera de la ventana
      B.gasto({ tipo: 'personal', valor: 5000, fecha: '2026-10-06', bolsillo: 'efectivo' }),   // futuro: fuera
      B.gasto({ tipo: 'negocio', valor: 777, fecha: '2026-10-02', bolsillo: 'nequi', del: 1 }), // borrado
    ],
    cobros: [
      B.cobro({ id: 'cJ', nombre: 'Juan Pérez Gómez', total: 200000, pagado: 50000 }),                      // debe 150.000
      B.cobro({ id: 'cA', nombre: 'Ana', total: 80000, pagado: 0 }),                                        // debe 50.000 tras el abono
      B.cobro({ id: 'cC', nombre: 'Camilo', total: 300000, pagado: 0, bolsillo: 'nequi' }),                 // préstamo: debe 300.000
      B.cobro({ id: 'cP', nombre: 'Pedro', total: 10000, pagado: 0 }),                                      // 4.º: cuenta en el total pero no se lista
      B.cobro({ id: 'cL', nombre: 'Luis', total: 100000, pagado: 0, bolsillo: 'efectivo' }),                // saldado con abono
    ],
    abonos: [B.abono({ cobroId: 'cA', monto: 30000, bolsillo: 'efectivo' }), B.abono({ cobroId: 'cL', monto: 100000, bolsillo: 'efectivo' })],
    pend: [B.pend(), B.pend(), B.pend({ del: 1 })],
  });

  test('resumen completo de 7 días (cálculo a mano)', () => {
    // ventas: 1.300.000 + 1.800.000 = 3.100.000 · costo 2.500.000 → bruta 600.000 − gastos negocio 35.000 = 565.000
    // gastos: negocio 35.000 · personal 30.000 → 65.000
    // caja: nequi 500.000 −1.000.000+1.300.000 −1.500.000+1.800.000 −900.000+1.000.000 −20.000−15.000−100.000 −300.000(préstamo) = 765.000
    //       efectivo 100.000 −18.000−12.000−5.000 +30.000 −100.000(préstamo Luis) +100.000(abono) = 95.000 → caja 860.000
    // stock: 800.000+250.000+300.000+120.000 = 1.470.000 (4)
    // te deben: 150.000+50.000+300.000+10.000 = 510.000
    assert.equal(hoy(() => summaryText(dbResumen())), [
      '📊 2 ventas por $3.1M · utilidad $565K',
      '💸 Gastos $65K (negocio $35K · personal $30K)',
      '💵 Caja $860K · 📦 Stock $1.5M (4)',
      // apartados (SPEC §13): negocio = ventas 3.4M − compras vendidas 3.4M… a mano: (1.3M−1M)+(1.8M−1.5M)+(1M−0.9M) − gastos negocio 135.000 = 565.000
      // personal = ini 600.000 − gastos personales 35.000 − préstamos 400.000 + abonos 130.000 = 295.000  (565K + 295K = caja 860K)
      '💼 Negocio $565K · 👤 Personal $295K',
      '🤝 Te deben $510K: Juan $150K, Ana $50K, Camilo $300K',
      '⚠️ 3 productos con +30 días: Xbox Series S, Tenis',
      '📲 2 movimientos por clasificar',
      // monthInsight (SPEC §14): en octubre (hasta el 5) solo el iPhone 13 se vendió (+300.000); a 5-sep no había ventas
      '🏆 Lo más rentable: iPhone 13 (+$300K)',
    ].join('\n'));
  });

  test('base vacía: solo las 3 primeras líneas + apartados, sin avisos', () => {
    assert.equal(hoy(() => summaryText(emptyDB())), [
      '📊 Sin ventas esta semana',
      '💸 Gastos $0 (negocio $0 · personal $0)',
      '💵 Caja $0 · 📦 Stock $0 (0)',
      '💼 Negocio $0 · 👤 Personal $0',
    ].join('\n'));
  });

  test('singulares: 1 venta, 1 producto, 1 movimiento', () => {
    const db = makeDB({
      items: [B.sold({ desc: 'X', buyPrice: 100000, sellPrice: 130000, sellDate: '2026-10-04' }), B.item({ desc: 'Viejo', buyDate: '2026-08-01', buyPrice: 50000 })],
      pend: [B.pend()],
    });
    const s = hoy(() => summaryText(db));
    assert.match(s, /^📊 1 venta por \$130K · utilidad \$30K$/m);
    assert.match(s, /^⚠️ 1 producto con \+30 días: Viejo$/m);
    assert.match(s, /^📲 1 movimiento por clasificar$/m);
  });

  test('ventana de 7 días: entra hoy-6, no entra hoy-7 ni mañana', () => {
    const venta = f => makeDB({ items: [B.sold({ sellPrice: 1000, buyPrice: 0, sellDate: f })] });
    const hay = f => /Sin ventas/.test(hoy(() => summaryText(venta(f)))) ? 'no' : 'si';
    assert.equal(hay('2026-09-29'), 'si');
    assert.equal(hay('2026-10-05'), 'si');
    assert.equal(hay('2026-09-28'), 'no');
    assert.equal(hay('2026-10-06'), 'no');
  });

  test('con otro "hoy" la ventana se mueve (no está pegada a una fecha fija)', () => {
    const db = makeDB({ items: [B.sold({ sellPrice: 1000, buyPrice: 0, sellDate: '2026-10-02' })] });
    assert.match(withNow('2026-10-08T10:00:00-05:00', () => summaryText(db)), /1 venta/);
    assert.match(withNow('2026-10-09T10:00:00-05:00', () => summaryText(db)), /Sin ventas/);
  });

  test('"+30 días": 30 cuenta, 29 no; los vendidos nunca cuentan', () => {
    const db = makeDB({ items: [B.item({ desc: 'A30', buyDate: '2026-09-05' }), B.item({ desc: 'B29', buyDate: '2026-09-06' }), B.sold({ desc: 'C99', buyDate: '2026-06-01', sellDate: '2026-06-10', sellPrice: 1 })] });
    const s = hoy(() => summaryText(db));
    assert.match(s, /⚠️ 1 producto con \+30 días: A30$/m);
  });

  test('"Te deben": nombres de pila (primera palabra), máximo 3, total con TODOS los pendientes', () => {
    const s = hoy(() => summaryText(dbResumen()));
    assert.match(s, /Juan \$150K, Ana \$50K, Camilo \$300K$/m);
    assert.doesNotMatch(s, /Pedro|Luis|Pérez|Gómez/);
  });
});

describe('remindersText', () => {
  const cuando = (dias, horas = 0) => NOW_MS - dias * DAY - horas * HOUR;       // epoch ms relativo a "ahora"
  const reciente = () => B.gasto({ u: NOW_MS - 2 * HOUR });                     // actividad de hace 2 horas
  const R = db => hoy(() => remindersText(db));

  test("'' cuando no hay nada que avisar (base vacía)", () => assert.equal(R(emptyDB()), ''));
  test("'' con actividad reciente y sin pendientes", () => assert.equal(R(makeDB({ gastos: [reciente()] })), ''));

  describe('compromisos de cobro', () => {
    test('vencido: "debía pagarte el dd/mm/aa" con lo que falta (no el total) y el nombre completo', () => {
      const db = makeDB({ cobros: [B.cobro({ nombre: 'Juan Pérez', total: 200000, pagado: 50000, compromiso: '2026-10-01' })], gastos: [reciente()] });
      assert.equal(R(db), '🤝 Juan Pérez debía pagarte el 01/10/26: $150K');
    });
    test('de hoy: "prometió pagarte hoy"', () => {
      const db = makeDB({ cobros: [B.cobro({ nombre: 'Ana', total: 80000, compromiso: '2026-10-05' })], gastos: [reciente()] });
      assert.equal(R(db), '🤝 Ana prometió pagarte hoy: $80K');
    });
    test('de mañana o futuro, sin fecha, saldados o borrados: no avisa', () => {
      const db = makeDB({
        cobros: [
          B.cobro({ nombre: 'Mañana', total: 1000, compromiso: '2026-10-06' }), B.cobro({ nombre: 'SinFecha', total: 1000, compromiso: '' }),
          B.cobro({ nombre: 'SinCampo', total: 1000, compromiso: undefined }), B.cobro({ nombre: 'Saldado', total: 1000, pagado: 1000, compromiso: '2026-09-01' }),
          B.cobro({ nombre: 'Borrado', total: 1000, compromiso: '2026-09-01', del: 1 }),
        ],
        gastos: [reciente()],
      });
      assert.equal(R(db), '');
    });
    test('un abono que cubre el saldo apaga el aviso', () => {
      const c = B.cobro({ id: 'c1', nombre: 'Juan', total: 100000, compromiso: '2026-10-01' });
      const db = makeDB({ cobros: [c], abonos: [B.abono({ cobroId: 'c1', monto: 100000 })], gastos: [reciente()] });
      assert.equal(R(db), '');
    });
    test('varios: una línea por cobro, en el orden de la colección', () => {
      const db = makeDB({
        cobros: [B.cobro({ nombre: 'A', total: 1000, compromiso: '2026-10-05' }), B.cobro({ nombre: 'B', total: 2000, compromiso: '2026-09-30' })],
        gastos: [reciente()],
      });
      assert.equal(R(db), ['🤝 A prometió pagarte hoy: $1K', '🤝 B debía pagarte el 30/09/26: $2K'].join('\n'));
    });
  });

  describe('movimientos por clasificar (pend)', () => {
    test('1 → singular, 3 → plural; los borrados no cuentan', () => {
      assert.equal(R(makeDB({ pend: [B.pend()], gastos: [reciente()] })), '📲 Tienes 1 movimiento por clasificar');
      assert.equal(R(makeDB({ pend: [B.pend(), B.pend(), B.pend(), B.pend({ del: 1 })], gastos: [reciente()] })), '📲 Tienes 3 movimientos por clasificar');
    });
  });

  describe('empujón de inactividad (3+ días sin registrar)', () => {
    const conActividad = u => makeDB({ gastos: [B.gasto({ u })] });
    const MSG = n => `📝 Llevas ${n} días sin registrar nada. ¿Compraste, vendiste o gastaste algo?`;

    test('exactamente 3 días → avisa; un milisegundo menos → todavía no', () => {
      assert.equal(R(conActividad(cuando(3))), MSG(3));
      assert.equal(R(conActividad(cuando(3) + 1)), '');
      assert.equal(R(conActividad(cuando(2, 23))), '');
    });
    test('4 y 30 días → cuenta los días completos', () => {
      assert.equal(R(conActividad(cuando(4))), MSG(4));
      assert.equal(R(conActividad(cuando(30, 5))), MSG(30));
    });
    test('no aparece si hay actividad reciente (aunque haya registros viejos)', () => {
      // (con un cuadre reciente, para que no salga el aviso 🧮 de SPEC §13.2, que se prueba en core.fondos.test.js)
      const db = makeDB({ gastos: [B.gasto({ u: cuando(20) }), B.gasto({ u: cuando(0, 1) })], items: [B.item({ u: cuando(40) })], ajustes: [B.ajuste()] });
      assert.equal(R(db), '');
    });
    test('no aparece si NUNCA hubo registros (base vacía o solo semillas u:1)', () => {
      assert.equal(R(emptyDB()), '');
      assert.equal(R(makeDB({ ajustes: [], pend: [] })), '');
    });
    test('con solo un pend viejo (nunca registró nada) avisa del pend pero NO del empujón', () => {
      assert.equal(R(makeDB({ pend: [B.pend({ u: cuando(10) })] })), '📲 Tienes 1 movimiento por clasificar');
    });
    test('cuenta la última modificación de items, gastos, ingresos, abonos, transfers y cobros', () => {
      const viejo = cuando(10);
      const base = () => ({ items: [B.item({ u: viejo })], gastos: [B.gasto({ u: viejo })], ingresos: [B.ingreso({ u: viejo })], abonos: [B.abono({ u: viejo })], transfers: [B.transfer({ u: viejo })], cobros: [B.cobro({ u: viejo })], ajustes: [B.ajuste()] });
      assert.equal(R(makeDB(base())), MSG(10));
      const nuevo = cuando(0, 1);
      const poner = { items: B.item({ u: nuevo }), gastos: B.gasto({ u: nuevo }), ingresos: B.ingreso({ u: nuevo }), abonos: B.abono({ u: nuevo }), transfers: B.transfer({ u: nuevo }), cobros: B.cobro({ u: nuevo }) };
      for (const [col, r] of Object.entries(poner)) {
        const b = base(); b[col].push(r);
        assert.equal(R(makeDB(b)), '', `actividad reciente en ${col} debe apagar el empujón`);
      }
    });
    test('ajustes y pend NO cuentan como actividad del usuario (un pend lo crea el servidor al capturar)', () => {
      const db = makeDB({ gastos: [B.gasto({ u: cuando(10) })], ajustes: [B.ajuste({ u: cuando(0, 1) })], pend: [B.pend({ u: cuando(0, 1) })] });
      assert.equal(R(db), ['📲 Tienes 1 movimiento por clasificar', MSG(10)].join('\n'));
    });
    test('los registros borrados no cuentan como actividad', () => {
      const db = makeDB({ gastos: [B.gasto({ u: cuando(10) }), B.gasto({ u: cuando(0, 1), del: 1 })] });
      assert.equal(R(db), MSG(10));
    });
  });

  test('orden de las líneas: compromisos → por clasificar → inactividad', () => {
    const db = makeDB({
      cobros: [B.cobro({ nombre: 'Juan', total: 5000, compromiso: '2026-10-05', u: cuando(9) })],
      pend: [B.pend(), B.pend()],
    });
    assert.equal(R(db), ['🤝 Juan prometió pagarte hoy: $5K', '📲 Tienes 2 movimientos por clasificar', '📝 Llevas 9 días sin registrar nada. ¿Compraste, vendiste o gastaste algo?'].join('\n'));
  });
});
