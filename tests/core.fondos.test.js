'use strict';
/**
 * SPEC §13 — Bolsillos con alias y APARTADOS (fondos/repartos) en app/core.js.
 *   node --test tests/core.fondos.test.js
 *
 * Lo más importante: el INVARIANTE §13.1  →  sum(balancesFondos(db)) === sum(balances(db))  SIEMPRE.
 * Se prueba con miles de bases aleatorias (deterministas: misma semilla → mismas bases) que mezclan TODOS
 * los tipos de registro y los casos raros (borrados, fondos borrados/inexistentes, iniFondos parciales,
 * bolsillos inexistentes, montos como texto…). Además se compara contra un ORÁCULO independiente
 * (helpers/oracle.ledger + las reglas de fondoDe escritas desde el SPEC) para que el invariante no se
 * cumpla "de mentiras" (p. ej. mandando todo a 'personal').
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { hoy, withNow } = require('./helpers/clock');
const core = require('./helpers/core');
const B = require('./helpers/builders');
const { rng } = require('./helpers/rng');
const { ledger } = require('./helpers/oracle');

const { COLS, emptyDB, mergeDB, balances, balancesFondos, fondoDe, ensureSeeds, summaryText, remindersText, L } = core;
const { norm, clone, deepFreeze } = B;
const total = o => Object.values(o).reduce((s, v) => s + v, 0);
const sinCeros = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== 0));

/* ═════════════ Oráculo independiente de apartados (desde SPEC §13.2, sin usar core) ═════════════ */
function oracleFondos(db) {
  const live = c => ((db && db[c]) || []).filter(x => x && !x.del);
  const vivos = new Set(live('fondos').map(f => f.id));
  const ok = id => (id === 'personal' || vivos.has(id) ? id : 'personal');
  const byId = c => new Map(((db && db[c]) || []).filter(x => x && !x.del).map(x => [x.id, x]));
  const allCobros = new Map();
  ((db && db.cobros) || []).forEach(c => { if (c && (!allCobros.has(c.id) || !c.del)) allCobros.set(c.id, c); });
  const regla = (col, r) => {
    if (r.fondo != null && r.fondo !== '') return ok(r.fondo);
    if (col === 'items') return ok('negocio');
    if (col === 'gastos') return ok(r.tipo === 'negocio' ? 'negocio' : 'personal');
    if (col === 'cobros') return ok(r.itemId ? 'negocio' : 'personal');
    if (col === 'abonos') { const c = allCobros.get(r.cobroId); return c ? regla('cobros', c) : 'personal'; }
    return 'personal';
  };
  const colDe = { compra: 'items', venta: 'items', gasto: 'gastos', ingreso: 'ingresos', abono: 'abonos', prestamo: 'cobros', ajuste: 'ajustes' };
  const idx = {}; for (const c of new Set(Object.values(colDe))) idx[c] = byId(c);
  const f = {};
  const put = (k, v) => { f[k] = (Object.prototype.hasOwnProperty.call(f, k) ? f[k] : 0) + (Number(v) || 0); };
  // saldo inicial (último bolsillo vivo por id, como balances)
  const ini = new Map();
  live('bolsillos').forEach(p => ini.set(String(p.id), p));
  for (const p of ini.values()) {
    const parts = p.iniFondos && typeof p.iniFondos === 'object' && !Array.isArray(p.iniFondos) ? p.iniFondos : {};
    let resto = Number(p.ini) || 0;
    for (const [k, v] of Object.entries(parts)) { const n = Number(v) || 0; put(ok(k), n); resto -= n; }
    put('personal', resto);
  }
  for (const r of ledger(db)) {
    // mover de bolsillo no cambia para qué es la plata (neto 0); un transfer cojo (un lado vacío) crea/borra plata → personal
    if (r.kind.startsWith('transfer')) { put('personal', r.delta); continue; }
    put(regla(colDe[r.kind], idx[colDe[r.kind]].get(r.ref)), r.delta);
  }
  for (const r of live('repartos')) { const m = Number(r.monto) || 0; put(ok(r.from), -m); put(ok(r.to), m); }
  return f;
}

/* ═════════════ Generador de bases aleatorias ═════════════ */
function randomDB(seed) {
  const r = rng(seed);
  let n = 0;
  const id = p => p + seed.toString(36) + '_' + (n++).toString(36);
  const money = () => {
    const v = r.pick([0, 1000, 5000, 12000, 50000, 85000, 120000, 300000, 1200000, 2100000, r.int(1, 3000) * 1000]);
    if (r.chance(0.04)) return String(v);                 // monto como texto (importado / formulario viejo)
    if (r.chance(0.02)) return r.pick([null, undefined, 'abc', '']);
    return v;
  };
  const fecha = () => '2026-' + String(r.int(7, 10)).padStart(2, '0') + '-' + String(r.int(1, 28)).padStart(2, '0');
  const del = () => (r.chance(0.12) ? { del: 1 } : {});
  const u = () => r.int(2, 1e6);

  // bolsillos: semillas + extras, algunos borrados
  const pockets = ['efectivo', 'nequi', 'nequi_pareja', 'daviplata', 'banco'];
  const fondos = [{ id: 'negocio', nombre: 'Negocio', u: 1 }, { id: 'personal', nombre: 'Personal', u: 1 }];
  if (r.chance(0.05)) fondos[0].del = 1;                  // apartado Negocio borrado
  if (r.chance(0.03)) fondos[1].del = 1;                  // incluso Personal borrado (no debería pasar: igual cuadra)
  for (let i = 0, k = r.int(0, 4); i < k; i++) fondos.push({ id: id('f'), nombre: 'F' + i, u: u(), ...del() });
  if (r.chance(0.1)) fondos.push({ id: 'constructor', nombre: 'raro', u: 5 }); // id que choca con Object.prototype
  const fondoIds = fondos.map(f => f.id);
  const fondoRaro = () => r.pick([...fondoIds, ...fondoIds, 'no_existe', '', null, undefined]);
  const conFondo = () => (r.chance(0.35) ? { fondo: fondoRaro() } : {});
  const pocket = () => r.pick([...pockets, 'efectivo', 'nequi', '', '', 'fantasma', null, undefined]);

  const bolsillos = pockets.slice(0, r.int(1, pockets.length)).map(p => {
    const b = { id: p, nombre: p, ini: money(), u: u(), ...(r.chance(0.08) ? { del: 1 } : {}) };
    if (r.chance(0.5)) {
      const it = {};
      for (let i = 0, k = r.int(0, 3); i < k; i++) it[fondoRaro() || 'x'] = money();
      b.iniFondos = it;                                    // reparto parcial (o mayor que el ini: personal queda negativo)
    } else if (r.chance(0.05)) b.iniFondos = r.pick([null, [1, 2], 'texto', 7]);
    return b;
  });
  if (r.chance(0.05)) bolsillos.push({ ...bolsillos[0], ini: 999, u: u() }); // id repetido (base importada sin merge)

  const items = [], cobros = [];
  for (let i = 0, k = r.int(0, 25); i < k; i++) {
    const it = { id: id('i'), desc: 'P' + i, cat: 'Otro', buyPrice: money(), buyPocket: r.chance(0.2) ? '' : pocket(), buyDate: fecha(), status: 'stock', u: u(), ...conFondo(), ...del() };
    if (r.chance(0.55)) {
      const precio = money();
      Object.assign(it, { status: 'sold', sellPrice: precio, sellPocket: pocket(), sellDate: fecha() });
      const tipo = r.int(0, 3);
      if (tipo === 1) it.sellPaid = Math.floor((+precio || 0) / 2);           // venta a crédito
      if (tipo === 2) it.sellPaid = r.pick([null, undefined]);                // sin sellPaid → cuenta sellPrice
      if (tipo === 1 && r.chance(0.8)) cobros.push({ id: id('c'), nombre: 'C', total: (+precio || 0) - it.sellPaid, pagado: 0, bolsillo: '', fecha: fecha(), itemId: it.id, u: u(), ...conFondo(), ...del() });
      if (r.chance(0.2)) {                                                     // parte de pago: entra sin salir de bolsillo
        const ti = { id: id('i'), desc: 'TI', cat: 'Celulares', buyPrice: money(), buyPocket: '', buyDate: it.sellDate, status: 'stock', fromTradeOf: it.id, u: u(), ...del() };
        it.tradeInId = ti.id; it.tradeInValor = ti.buyPrice; items.push(ti);
      }
    }
    items.push(it);
  }
  for (let i = 0, k = r.int(0, 6); i < k; i++) // préstamos (sale plata) y "me deben" sin bolsillo
    cobros.push({ id: id('c'), nombre: 'L', total: money(), pagado: r.chance(0.3) ? money() : 0, bolsillo: r.chance(0.6) ? pocket() : '', fecha: fecha(), ...conFondo(), ...del() });
  const cobroIds = cobros.map(c => c.id);
  const gastos = Array.from({ length: r.int(0, 25) }, () => ({ id: id('g'), desc: 'G', valor: money(), cat: 'Otro', tipo: r.pick(['negocio', 'personal', undefined, 'raro']), bolsillo: pocket(), fecha: fecha(), u: u(), ...conFondo(), ...del() }));
  const ingresos = Array.from({ length: r.int(0, 6) }, () => ({ id: id('n'), desc: 'I', valor: money(), bolsillo: pocket(), fecha: fecha(), u: u(), ...conFondo(), ...del() }));
  const abonos = Array.from({ length: r.int(0, 10) }, () => ({ id: id('a'), cobroId: r.pick([...cobroIds, ...cobroIds, 'huerfano']), monto: money(), bolsillo: pocket(), fecha: fecha(), u: u(), ...conFondo(), ...del() }));
  const transfers = Array.from({ length: r.int(0, 8) }, () => ({ id: id('t'), from: pocket(), to: pocket(), monto: money(), fecha: fecha(), u: u(), ...del() }));
  const ajustes = Array.from({ length: r.int(0, 5) }, () => ({ id: id('j'), bolsillo: pocket(), delta: r.chance(0.5) ? -money() : money(), fecha: fecha(), nota: '', u: u(), ...conFondo(), ...del() }));
  const repartos = Array.from({ length: r.int(0, 8) }, () => ({ id: id('r'), from: fondoRaro(), to: fondoRaro(), monto: money(), fecha: fecha(), nota: '', u: u(), ...del() }));
  const pend = Array.from({ length: r.int(0, 3) }, () => ({ id: id('p'), raw: 'x', monto: money(), dir: 'out', quien: '', fecha: fecha(), bolsillo: pocket(), u: u(), ...del() }));
  const db = { items, gastos, ingresos, cobros, abonos, transfers, ajustes, pend, bolsillos, reglas: [], fondos, repartos };
  if (r.chance(0.05)) delete db.fondos;   // base vieja sin apartados
  if (r.chance(0.05)) delete db.repartos;
  return db;
}

const N = 3000;

describe('INVARIANTE §13.1: suma de apartados = suma de bolsillos', () => {
  test(`${N} bases aleatorias con TODOS los tipos de registro: sum(balancesFondos) === sum(balances)`, () => {
    for (let s = 1; s <= N; s++) {
      const db = randomDB(s);
      const tb = total(balances(db)), tf = total(balancesFondos(db));
      if (tf !== tb) assert.fail(`semilla ${s}: apartados ${tf} ≠ bolsillos ${tb}\n${JSON.stringify(db).slice(0, 2000)}`);
    }
  });

  test(`${N} bases aleatorias: cada apartado coincide con el oráculo independiente (no basta con que la suma cuadre)`, () => {
    for (let s = 1; s <= N; s++) {
      const db = randomDB(s);
      assert.deepEqual(sinCeros(balancesFondos(db)), sinCeros(oracleFondos(db)), `semilla ${s}`);
    }
  });

  test('se mantiene después de mergeDB entre dos bases y de ensureSeeds (como al sincronizar dos celulares)', () => {
    for (let s = 1; s <= 600; s++) {
      const m = ensureSeeds(mergeDB(randomDB(s), randomDB(s + 7919)));
      assert.equal(total(balancesFondos(m)), total(balances(m)), `semilla ${s}`);
    }
  });

  test('los transfers (bien formados) no cambian ningún apartado; los repartos no cambian ningún bolsillo', () => {
    const lado = x => x != null && x !== '';
    for (let s = 1; s <= 500; s++) {
      const db = randomDB(s);
      const sinT = { ...db, transfers: db.transfers.filter(t => !(lado(t.from) && lado(t.to))) }, sinR = { ...db, repartos: [] };
      assert.deepEqual(balancesFondos(sinT), balancesFondos(db), `transfers, semilla ${s}`);
      assert.deepEqual(balances(sinR), balances(db), `repartos, semilla ${s}`);
    }
  });

  test('no muta la base (acepta objetos congelados) y tolera null / {} / base vieja de 10 colecciones', () => {
    const db = deepFreeze(randomDB(42));
    const antes = clone(db);
    assert.doesNotThrow(() => balancesFondos(db));
    assert.deepEqual(clone(db), antes);
    assert.deepEqual(balancesFondos(null), { personal: 0 });
    assert.deepEqual(balancesFondos({}), { personal: 0 });
    const vieja = { items: [], gastos: [B.gasto({ valor: 1000, bolsillo: 'nequi' })], bolsillos: [B.bolsillo('nequi', 'Nequi', 5000)] };
    assert.deepEqual(balancesFondos(vieja), { personal: 4000 }, 'sin colección fondos: todo cae en personal y cuadra');
    assert.equal(total(balancesFondos(vieja)), total(balances(vieja)));
  });

  test('ejemplo SPEC §11.5 + §13: compra 3M (Nequi), venta 2M + parte de pago 2.1M, reparto de ganancia', () => {
    const db = B.makeDB({
      bolsillos: [B.bolsillo('efectivo', 'Efectivo', 0), B.bolsillo('nequi', 'Nequi', 5000000, { iniFondos: { negocio: 4000000 } })],
      items: [
        B.sold({ id: 'v', buyPrice: 3000000, buyPocket: 'nequi', sellPrice: 4100000, sellPaid: 2000000, sellPocket: 'efectivo', tradeInId: 'ti', tradeInValor: 2100000 }),
        B.item({ id: 'ti', buyPrice: 2100000, buyPocket: '', fromTradeOf: 'v' }),
      ],
      repartos: [{ id: 'r1', from: 'negocio', to: 'personal', monto: 500000, fecha: '2026-10-05', nota: 'saqué ganancia', u: 5 }],
    });
    assert.deepEqual(balances(db), { efectivo: 2000000, nequi: 2000000 });
    // negocio: 4M − 3M + 2M − 0.5M = 2.5M · personal: 1M + 0.5M = 1.5M  (2.5M + 1.5M = 4M = caja)
    assert.deepEqual(balancesFondos(db), { negocio: 2500000, personal: 1500000 });
  });

  test('un apartado puede quedar negativo (el negocio usó plata personal) y aun así todo cuadra', () => {
    const db = B.makeDB({ bolsillos: [B.bolsillo('nequi', 'Nequi', 100000)], items: [B.item({ buyPrice: 300000, buyPocket: 'nequi' })] });
    assert.deepEqual(balancesFondos(db), { negocio: -300000, personal: 100000 });
    assert.equal(total(balancesFondos(db)), total(balances(db)));
  });

  test('iniFondos: reparte el saldo inicial; lo no repartido (o un apartado inexistente/borrado) va a personal', () => {
    const db = B.makeDB({
      fondos: [...emptyDB().fondos, { id: 'arriendo', nombre: 'Arriendo', u: 5 }, { id: 'viejo', nombre: 'Viejo', u: 5, del: 1 }],
      bolsillos: [
        B.bolsillo('nequi', 'Nequi', 1000000, { iniFondos: { negocio: 600000, arriendo: 100000, viejo: 50000, nadie: 25000 } }),
        B.bolsillo('efectivo', 'Efectivo', 200000, { iniFondos: { negocio: 300000 } }), // más de lo que hay: personal −100.000
        B.bolsillo('banco', 'Banco', 70000, { del: 1, iniFondos: { negocio: 70000 } }),  // borrado: no cuenta (igual que balances)
      ],
    });
    // nequi: 1M − 775.000 repartidos = 225.000 + viejo 50.000 + nadie 25.000 → personal 300.000 · efectivo: 200.000 − 300.000 → personal −100.000
    assert.deepEqual(balancesFondos(db), { negocio: 900000, personal: 200000, arriendo: 100000 });
    assert.equal(total(balancesFondos(db)), 1200000);
  });
});

describe('fondoDe(col, rec, db)', () => {
  const db = B.makeDB({
    fondos: [...emptyDB().fondos, { id: 'ahorro', nombre: 'Ahorro', u: 9 }, { id: 'viejo', nombre: 'Viejo', u: 9, del: 1 }],
    cobros: [
      B.cobro({ id: 'cred', itemId: 'i1' }), B.cobro({ id: 'prest', bolsillo: 'nequi' }),
      B.cobro({ id: 'conF', fondo: 'ahorro' }), B.cobro({ id: 'borrado', itemId: 'i9', del: 1 }),
    ],
  });
  test('reglas por defecto (SPEC §13.2)', () => {
    assert.equal(fondoDe('items', B.item(), db), 'negocio');
    assert.equal(fondoDe('items', B.sold(), db), 'negocio');
    assert.equal(fondoDe('gastos', B.gasto({ tipo: 'negocio' }), db), 'negocio');
    assert.equal(fondoDe('gastos', B.gasto({ tipo: 'personal' }), db), 'personal');
    assert.equal(fondoDe('gastos', B.gasto({ tipo: undefined }), db), 'personal');
    assert.equal(fondoDe('ingresos', B.ingreso(), db), 'personal');
    assert.equal(fondoDe('cobros', db.cobros[0], db), 'negocio', 'venta a crédito (con itemId)');
    assert.equal(fondoDe('cobros', db.cobros[1], db), 'personal', 'préstamo');
    assert.equal(fondoDe('ajustes', B.ajuste(), db), 'personal');
  });
  test('abonos: el apartado de su cobro (aunque el cobro esté borrado); huérfano → personal', () => {
    assert.equal(fondoDe('abonos', B.abono({ cobroId: 'cred' }), db), 'negocio');
    assert.equal(fondoDe('abonos', B.abono({ cobroId: 'prest' }), db), 'personal');
    assert.equal(fondoDe('abonos', B.abono({ cobroId: 'conF' }), db), 'ahorro');
    assert.equal(fondoDe('abonos', B.abono({ cobroId: 'borrado' }), db), 'negocio');
    assert.equal(fondoDe('abonos', B.abono({ cobroId: 'nadie' }), db), 'personal');
    assert.equal(fondoDe('abonos', B.abono({ cobroId: 'prest', fondo: 'ahorro' }), db), 'ahorro', 'el campo propio gana');
  });
  test('rec.fondo gana si el apartado existe; inexistente o borrado → personal; vacío → regla por defecto', () => {
    assert.equal(fondoDe('items', B.item({ fondo: 'ahorro' }), db), 'ahorro');
    assert.equal(fondoDe('gastos', B.gasto({ tipo: 'negocio', fondo: 'personal' }), db), 'personal');
    assert.equal(fondoDe('items', B.item({ fondo: 'viejo' }), db), 'personal');
    assert.equal(fondoDe('items', B.item({ fondo: 'nadie' }), db), 'personal');
    assert.equal(fondoDe('items', B.item({ fondo: '' }), db), 'negocio');
    assert.equal(fondoDe('items', B.item({ fondo: null }), db), 'negocio');
  });
  test('si el apartado Negocio está borrado, lo del negocio cae en personal', () => {
    const sinNeg = B.makeDB({ fondos: [{ ...emptyDB().fondos[0], del: 1, u: 5 }, emptyDB().fondos[1]] });
    assert.equal(fondoDe('items', B.item(), sinNeg), 'personal');
    assert.equal(fondoDe('gastos', B.gasto({ tipo: 'negocio' }), sinNeg), 'personal');
  });
  test('transfers y repartos no tienen apartado (null); colección desconocida → personal; sin db no revienta', () => {
    assert.equal(fondoDe('transfers', B.transfer(), db), null);
    assert.equal(fondoDe('repartos', {}, db), null);
    assert.equal(fondoDe('otra', {}, db), 'personal');
    assert.equal(fondoDe('items', B.item(), undefined), 'personal', 'sin db no hay apartados vivos → personal');
    assert.equal(fondoDe('items', B.item(), emptyDB()), 'negocio');
  });
});

describe('ensureSeeds(db) y semillas', () => {
  const viejaDB = () => ({ // así guardaba la app ANTES de SPEC §13 (10 colecciones, 2 bolsillos sin alias)
    items: [B.item({ id: 'i1', u: 50 })], gastos: [], ingresos: [], cobros: [], abonos: [], transfers: [], ajustes: [], pend: [], reglas: [],
    bolsillos: [{ id: 'efectivo', nombre: 'Efectivo', ini: 0, u: 1 }, { id: 'nequi', nombre: 'Nequi', ini: 0, u: 1 }],
  });

  test('emptyDB trae las semillas exactas del SPEC', () => {
    const d = emptyDB();
    assert.deepEqual(d.bolsillos.find(b => b.id === 'nequi_pareja'), { id: 'nequi_pareja', nombre: 'Nequi pareja', ini: 0, alias: ['nequi de mi pareja', 'pareja', 'mi novia', 'mi esposa', 'mi mujer', 'mi amor', 'de ella'], u: 1 });
    assert.deepEqual(d.bolsillos.find(b => b.id === 'efectivo').alias, ['efectivo', 'cash', 'fisico', 'billete', 'plata en mano', 'en mano']);
    assert.deepEqual(d.bolsillos.find(b => b.id === 'nequi').alias, ['nequi', 'mi nequi', 'neki', 'nequy']);
    assert.deepEqual(d.fondos.map(f => [f.id, f.emoji, f.alias, f.u]), [
      ['negocio', '💼', ['negocio', 'capital', 'del negocio', 'plata del negocio'], 1],
      ['personal', '👤', ['personal', 'lo personal', 'mi plata', 'para mi'], 1]]);
    assert.deepEqual(d.repartos, []);
  });

  test('a una base vieja le agrega colecciones y semillas que faltan, y alias a las semillas intactas', () => {
    const d = ensureSeeds(viejaDB());
    assert.ok(COLS.every(c => Array.isArray(d[c])));
    assert.deepEqual(d.bolsillos.map(b => b.id), ['efectivo', 'nequi', 'nequi_pareja']);
    assert.deepEqual(d.fondos.map(f => f.id), ['negocio', 'personal']);
    assert.deepEqual(d.bolsillos[0].alias, emptyDB().bolsillos[0].alias);
    assert.equal(d.bolsillos[0].u, 1, 'no cambia u (sigue siendo semilla: no gana a ediciones de otro celular)');
    assert.deepEqual(d.items, viejaDB().items, 'no toca los datos del usuario');
  });

  test('es idempotente y no duplica', () => {
    const una = ensureSeeds(viejaDB());
    const dos = ensureSeeds(clone(una));
    assert.deepEqual(dos, una);
    assert.equal(dos.bolsillos.filter(b => b.id === 'nequi_pareja').length, 1);
    assert.deepEqual(ensureSeeds(emptyDB()), emptyDB());
  });

  test('NO pisa un bolsillo/apartado editado por el usuario ni revive uno borrado', () => {
    const d = viejaDB();
    d.bolsillos[1] = { id: 'nequi', nombre: 'Mi Nequi', ini: 800000, u: 1790000000000 };      // editado, sin alias (app vieja)
    d.bolsillos.push({ id: 'nequi_pareja', nombre: 'Nequi de Caro', ini: 5, alias: ['caro'], u: 1790000000001 });
    d.fondos = [{ id: 'negocio', nombre: 'Mi negocio', emoji: '🛒', u: 1790000000002 }, { id: 'personal', del: 1, u: 1790000000003 }];
    const antes = clone(d);
    const r = ensureSeeds(d);
    assert.deepEqual(r.bolsillos[1], antes.bolsillos[1]);
    assert.deepEqual(r.bolsillos.find(b => b.id === 'nequi_pareja'), antes.bolsillos[2]);
    assert.deepEqual(r.fondos, antes.fondos, 'el apartado borrado sigue borrado; el editado queda igual');
  });

  test('acepta registros congelados (no los muta: los reemplaza)', () => {
    const d = viejaDB();
    d.bolsillos.forEach(Object.freeze);
    const r = ensureSeeds(d);
    assert.ok(Array.isArray(r.bolsillos[0].alias));
  });

  test('mergeDB de una base VIEJA (sin semillas nuevas) con una nueva converge, en cualquier orden', () => {
    const vieja = viejaDB();
    vieja.bolsillos[1] = { id: 'nequi', nombre: 'Nequi', ini: 800000, u: 1790000000000 }; // onboarding en el celular viejo
    const nueva = emptyDB();
    nueva.gastos.push(B.gasto({ id: 'g1', u: 60 }));
    nueva.repartos.push({ id: 'r1', from: 'personal', to: 'negocio', monto: 100, fecha: '2026-10-05', nota: '', u: 61 });
    const ab = ensureSeeds(mergeDB(vieja, nueva)), ba = ensureSeeds(mergeDB(nueva, vieja));
    assert.deepEqual(norm(ab), norm(ba));
    assert.equal(ab.bolsillos.find(b => b.id === 'nequi').ini, 800000, 'el onboarding (u real) gana a la semilla');
    assert.ok(ab.bolsillos.find(b => b.id === 'efectivo').alias, 'la semilla intacta queda con alias');
    assert.equal(ab.bolsillos.filter(b => b.id === 'nequi_pareja').length, 1);
    assert.equal(ab.repartos.length, 1);
    // punto fijo: volver a mezclar con cualquiera de los dos (como en cada sync) no cambia nada
    assert.deepEqual(norm(ensureSeeds(mergeDB(ab, vieja))), norm(ab));
    assert.deepEqual(norm(ensureSeeds(mergeDB(nueva, ab))), norm(ab));
    // dos celulares nuevos crean las mismas semillas por separado → no se duplican
    assert.equal(mergeDB(emptyDB(), emptyDB()).fondos.length, 2);
  });
});

describe('textos con apartados y cuadre', () => {
  test('summaryText: línea de apartados en orden (orden, luego nombre) con emoji', () => {
    const db = B.makeDB({
      fondos: [...emptyDB().fondos, { id: 'a', nombre: 'Arriendo', emoji: '🏠', orden: 2, u: 5 }, { id: 'b', nombre: 'Ahorro', emoji: '🐷', orden: 2, u: 5 }],
      bolsillos: [B.bolsillo('nequi', 'Nequi', 1500000, { iniFondos: { negocio: 1000000, a: 300000, b: 50000 } })],
    });
    const s = hoy(() => summaryText(db));
    assert.match(s, /^💼 Negocio \$1M · 👤 Personal \$150K · 🐷 Ahorro \$50K · 🏠 Arriendo \$300K$/m);
  });

  describe('remindersText: aviso de cuadre (🧮) si hace 15+ días no hay ajuste', () => {
    const MSG = '🧮 Hace rato no cuadras: compara tus saldos con Nequi y el efectivo real';
    const R = db => hoy(() => remindersText(db)); // hoy = 2026-10-05
    const reciente = { u: Date.now() };          // actividad reciente: sin empujón de inactividad
    test('movimientos desde hace 15+ días y ningún ajuste → avisa', () => {
      assert.equal(R(B.makeDB({ gastos: [B.gasto({ fecha: '2026-09-20', ...reciente })] })), MSG);
    });
    test('último ajuste hace 14 días → no; hace 15 → sí; borrado no cuenta', () => {
      const g = [B.gasto({ fecha: '2026-08-01', ...reciente })];
      assert.equal(R(B.makeDB({ gastos: g, ajustes: [B.ajuste({ fecha: '2026-09-21' })] })), '');
      assert.equal(R(B.makeDB({ gastos: g, ajustes: [B.ajuste({ fecha: '2026-09-20' })] })), MSG);
      assert.equal(R(B.makeDB({ gastos: g, ajustes: [B.ajuste({ fecha: '2026-10-01', del: 1 })] })), MSG);
    });
    test('sin movimientos, o usuario nuevo (primer movimiento hace < 15 días) → no avisa', () => {
      assert.equal(R(emptyDB()), '');
      assert.equal(R(B.makeDB({ gastos: [B.gasto({ fecha: '2026-09-25', ...reciente })] })), '');
      assert.equal(R(B.makeDB({ gastos: [B.gasto({ fecha: '2026-09-01', del: 1 })] })), '');
    });
    test('va al final, después de los demás avisos', () => {
      const db = B.makeDB({ pend: [B.pend()], gastos: [B.gasto({ fecha: '2026-09-01', ...reciente })] });
      assert.equal(R(db), ['📲 Tienes 1 movimiento por clasificar', MSG].join('\n'));
    });
  });
});

describe('API nueva exportada y disponible como global (Apps Script / navegador)', () => {
  test('exports y COLS', () => {
    for (const n of ['ensureSeeds', 'fondoDe', 'balancesFondos', 'fondosOrdenados', 'fondosLinea', 'SEED_BOLSILLOS', 'SEED_FONDOS'])
      assert.notEqual(typeof core[n], 'undefined', n);
    assert.ok(COLS.includes('fondos') && COLS.includes('repartos'));
    const m = mergeDB({ repartos: [{ id: 'r', u: 1, monto: 1 }] }, { repartos: [{ id: 'r', u: 2, monto: 2 }], fondos: [{ id: 'f', u: 1 }] });
    assert.deepEqual([m.repartos, m.fondos], [[{ id: 'r', u: 2, monto: 2 }], [{ id: 'f', u: 1 }]]);
  });
  test('L() con las nuevas colecciones', () => {
    assert.deepEqual(L({ fondos: [{ id: 'a' }, { id: 'b', del: 1 }] }, 'fondos'), [{ id: 'a' }]);
  });
});
