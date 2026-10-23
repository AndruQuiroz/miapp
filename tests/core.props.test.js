'use strict';
/**
 * Pruebas de PROPIEDADES / fuzz de core.js con semilla fija (deterministas y rápidas).
 * Complementan a core.test.js: aquí no se prueban casos escritos a mano sino leyes que deben
 * cumplirse para MILES de entradas generadas (mergeDB converge, balances = oráculo, etc.).
 *   node --test tests/core.props.test.js
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { withTZ } = require('./helpers/clock');
const core = require('./helpers/core');
const { rng } = require('./helpers/rng');
const { norm } = require('./helpers/builders');
const { ledgerBalances } = require('./helpers/oracle');

const { COLS, emptyDB, mergeDB, balances, monthStats, fmt, full, parseMoney, extractMonto, shiftDate, daysBetween } = core;

const shuffle = (r, a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = r.int(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ── generador de bases para mergeDB: pocos ids y pocos u → MUCHOS empates y conflictos ── */
const POOL = ['a', 'b', 'c', 'd', 'e', 'f'];
function randMergeDB(r) {
  const d = {};
  for (const c of COLS) {
    d[c] = [];
    for (const id of POOL) if (r.chance(0.55)) { const rec = { id, u: r.int(1, 4), v: r.int(0, 2) }; if (r.chance(0.3)) rec.del = 1; d[c].push(rec); }
  }
  return d;
}

describe('mergeDB: leyes del merge con 500 tríos aleatorios (muchos empates de u)', () => {
  test('conmutativa, idempotente, absorbente y asociativa', () => {
    const r = rng(1234);
    for (let k = 0; k < 500; k++) {
      const a = randMergeDB(r), b = randMergeDB(r), c = randMergeDB(r);
      const ab = mergeDB(a, b);
      assert.deepEqual(norm(ab), norm(mergeDB(b, a)), `conmutativa (iteración ${k})`);
      assert.deepEqual(norm(mergeDB(ab, ab)), norm(ab), `idempotente (${k})`);
      assert.deepEqual(norm(mergeDB(ab, a)), norm(ab), `absorbe a (${k})`);
      assert.deepEqual(norm(mergeDB(ab, b)), norm(ab), `absorbe b (${k})`);
      assert.deepEqual(norm(mergeDB(mergeDB(a, b), c)), norm(mergeDB(a, mergeDB(b, c))), `asociativa (${k})`);
    }
  });

  test('el ganador de cada id tiene el máximo u de los dos lados (nunca se pierde una edición más nueva)', () => {
    const r = rng(5);
    for (let k = 0; k < 300; k++) {
      const a = randMergeDB(r), b = randMergeDB(r), m = mergeDB(a, b);
      for (const c of COLS) {
        for (const rec of m[c]) {
          const versiones = [...a[c], ...b[c]].filter(x => x.id === rec.id);
          assert.equal(rec.u, Math.max(...versiones.map(x => x.u)), `${c}/${rec.id}`);
        }
        const idsEntrada = new Set([...a[c], ...b[c]].map(x => x.id));
        assert.deepEqual(m[c].map(x => x.id).sort(), [...idsEntrada].sort(), `${c}: ni se pierden ni se inventan ids`);
      }
    }
  });

  test('simulación: 3 dispositivos + servidor editan, borran y sincronizan en orden aleatorio → todos convergen al "último que escribió"', () => {
    const r = rng(2026);
    for (let k = 0; k < 120; k++) {
      let t = 100;                                               // reloj global estrictamente creciente → u únicos
      const best = {};                                           // id → versión con mayor u creada por CUALQUIERA (la verdad)
      const devices = [emptyDB(), emptyDB(), emptyDB()];
      const server = { db: emptyDB() };
      const sync = i => { server.db = mergeDB(server.db, devices[i]); devices[i] = mergeDB(devices[i], server.db); };
      for (let paso = 0; paso < 40; paso++) {
        const i = r.int(0, 2);
        if (r.chance(0.7)) {                                     // el dispositivo i crea/edita/borra un registro
          const id = r.pick(POOL);
          const prev = devices[i].gastos.find(x => x.id === id);
          const rec = { id, u: ++t, valor: r.int(1, 99) * 1000 };
          if (r.chance(0.2)) rec.del = 1;
          devices[i] = { ...devices[i], gastos: [...devices[i].gastos.filter(x => x.id !== id), rec] };
          best[id] = rec;
          void prev;
        } else sync(i);                                          // o sincroniza
      }
      for (const i of shuffle(r, [0, 1, 2])) sync(i);            // pasada final en orden aleatorio…
      for (const i of [0, 1, 2]) sync(i);                        // …y otra para que todos reciban lo último
      for (const i of [0, 1, 2]) assert.deepEqual(norm(devices[i]), norm(server.db), `dispositivo ${i} (sim ${k})`);
      for (const [id, rec] of Object.entries(best)) assert.deepEqual(server.db.gastos.find(x => x.id === id), rec, `id ${id}: debe ganar la última escritura (sim ${k})`);
    }
  });
});

/* ── generador de bases financieras ── */
function randFinDB(r) {
  const POCKETS = ['efectivo', 'nequi', '', 'daviplata'];                // '' = no salió de mis bolsillos; daviplata = desconocido
  const P = () => r.pick(POCKETS);
  const amt = () => r.int(0, 60) * 1000;
  const date = () => `2026-0${r.int(7, 9)}-${String(r.int(1, 28)).padStart(2, '0')}`;
  const del = () => (r.chance(0.12) ? { del: 1 } : {});
  const many = (k, f) => Array.from({ length: r.int(0, k) }, (_, i) => f(i));
  const d = emptyDB();
  d.bolsillos = [{ id: 'efectivo', nombre: 'Efectivo', ini: amt(), u: 1 }, { id: 'nequi', nombre: 'Nequi', ini: amt(), u: 1 }];
  if (r.chance(0.3)) d.bolsillos.push({ id: 'extra', nombre: 'Extra', ini: amt(), u: 1, ...del() });
  d.items = many(10, i => {
    const sold = r.chance(0.6);
    const it = { id: 'i' + i, desc: 'p' + i, cat: 'Otro', status: sold ? 'sold' : 'stock', buyPrice: amt(), buyPocket: P(), buyDate: date(), u: 5, ...del() };
    if (sold) {
      Object.assign(it, { sellPrice: amt(), sellPocket: P(), sellDate: date() });
      const paid = r.int(0, 3);
      if (paid === 0) it.sellPaid = 0; else if (paid === 1) it.sellPaid = it.sellPrice; else if (paid === 2) it.sellPaid = null;   // 3 → sin campo
    }
    return it;
  });
  d.gastos = many(12, i => ({ id: 'g' + i, desc: 'g', valor: amt(), cat: r.pick(['Envíos', 'Comida', 'Otro']), tipo: r.pick(['negocio', 'personal']), bolsillo: P(), fecha: date(), u: 5, ...del() }));
  d.ingresos = many(5, i => ({ id: 'n' + i, desc: 'n', valor: amt(), bolsillo: P(), fecha: date(), u: 5, ...del() }));
  d.cobros = many(6, i => ({ id: 'c' + i, nombre: 'N' + i, total: amt(), pagado: r.chance(0.5) ? 0 : amt() / 2, bolsillo: P(), fecha: date(), u: 5, ...del() }));
  d.abonos = many(8, i => ({ id: 'a' + i, cobroId: 'c' + r.int(0, 6), monto: amt() / 2, bolsillo: P(), fecha: date(), u: 5, ...del() }));
  d.transfers = many(5, i => ({ id: 't' + i, from: r.pick(['efectivo', 'nequi', 'daviplata']), to: r.pick(['efectivo', 'nequi', 'daviplata']), monto: amt(), fecha: date(), u: 5, ...del() }));
  d.ajustes = many(4, i => ({ id: 'j' + i, bolsillo: P(), delta: r.int(-20, 20) * 1000, fecha: date(), u: 5, ...del() }));
  return d;
}

describe('balances: 600 bases aleatorias', () => {
  test('coincide EXACTAMENTE con el oráculo independiente (libro mayor)', () => {
    const r = rng(77);
    for (let k = 0; k < 600; k++) {
      const db = randFinDB(r);
      assert.deepEqual(balances(db), ledgerBalances(db), `iteración ${k}`);
    }
  });

  test('los transfers conservan el total de plata (con ambos extremos definidos)', () => {
    const r = rng(78);
    for (let k = 0; k < 300; k++) {
      const db = randFinDB(r);
      const sinT = { ...db, transfers: [] };
      const total = o => Object.values(balances(o)).reduce((s, x) => s + x, 0);
      assert.equal(total(db), total(sinT), `iteración ${k}`);
    }
  });

  test('borrar un registro es igual a no haberlo creado (tombstone ≡ ausencia)', () => {
    const r = rng(79);
    for (let k = 0; k < 300; k++) {
      const db = randFinDB(r);
      const sinBorrados = {};
      for (const c of COLS) sinBorrados[c] = db[c].filter(x => !x.del);
      assert.deepEqual(balances(db), balances(sinBorrados), `iteración ${k}`);
    }
  });

  test('mergeDB no cambia los saldos de una base consigo misma ni con una vacía', () => {
    const r = rng(80);
    for (let k = 0; k < 200; k++) {
      const db = randFinDB(r);
      assert.deepEqual(balances(mergeDB(db, db)), balances(db));
      assert.deepEqual(balances(mergeDB(db, emptyDB())), balances({ ...db, bolsillos: mergeDB(db, emptyDB()).bolsillos }));
    }
  });
});

describe('monthStats: 400 bases aleatorias', () => {
  test('los meses suman el histórico en los campos aditivos (y en cada categoría de gasto)', () => {
    const r = rng(81);
    const meses = ['2026-07', '2026-08', '2026-09'];
    for (let k = 0; k < 400; k++) {
      const db = randFinDB(r);
      const total = monthStats(db, null), por = meses.map(m => monthStats(db, m));
      for (const f of ['nVentas', 'ventas', 'costo', 'bruta', 'gN', 'gP', 'neta', 'compras', 'ing'])
        assert.equal(por.reduce((s, x) => s + x[f], 0), total[f], `${f} (iteración ${k})`);
      const cats = {};
      por.forEach(x => Object.entries(x.cats).forEach(([c, v]) => { cats[c] = (cats[c] || 0) + v; }));
      assert.deepEqual(cats, total.cats);
      assert.ok(Number.isFinite(total.margen));
      assert.equal(total.neta, total.bruta - total.gN);
      assert.equal(total.bruta, total.ventas - total.costo);
    }
  });
});

describe('formato y montos: ida y vuelta', () => {
  // 3.000 aleatorios de todas las magnitudes + los bordes donde fmt cambia de unidad (999.499 / 999.500 / 1M / 9,99M / 10M…)
  const BORDES = [0, 1, 7, 999, 1000, 1500, 9999, 10000, 99999, 100000, 999499, 999500, 999999, 1000000, 1049999, 1050000, 9949999, 9950000, 9999999, 10000000, 10499999, 10500000, 99999999, 100000000, 999999999, 1000000000];
  const numeros = () => { const r = rng(2468); return [...BORDES, ...Array.from({ length: 3000 }, () => Math.floor(r() * 10 ** r.int(0, 10)))]; };

  test('parseMoney(full(n)) === n y extractMonto("gasto " + full(n) + " nequi") === n para 3.000 enteros hasta 10.000 millones', () => {
    for (const n of numeros()) {
      assert.equal(parseMoney(full(n)), n, `full(${n}) = ${full(n)}`);
      assert.equal(extractMonto('gasto ' + full(n) + ' nequi').monto, n, `en frase: ${full(n)}`);
    }
  });

  test('parseMoney(String(n)) === n (lo que escribe el usuario sin formato)', () => {
    for (const n of numeros()) assert.equal(parseMoney(String(n)), n);
  });

  test('fmt(n): siempre con forma $123 / $12K / $1.2M / $12M (con signo) y volver a leerlo se desvía menos de 5% desde $10.000', () => {
    for (const n of numeros()) {
      const s = fmt(n);
      assert.match(s, /^\$\d+(\.\d)?[KM]?$/, `fmt(${n}) = ${s}`);
      assert.doesNotMatch(s, /1000K|NaN|undefined/);
      if (n >= 10000) assert.ok(Math.abs(parseMoney(s) - n) <= 0.05 * n + 1, `fmt(${n}) = ${s} → ${parseMoney(s)}`);
      assert.equal(fmt(-n), n === 0 ? '$0' : '-' + s);
    }
  });
});

describe('fechas: ida y vuelta (en Bogotá y en una zona con horario de verano)', () => {
  for (const tz of ['America/Bogota', 'Pacific/Auckland', 'America/New_York']) {
    test(`shiftDate / daysBetween consistentes con 800 fechas aleatorias (TZ=${tz})`, () => withTZ(tz, () => {
      const r = rng(13579);
      for (let k = 0; k < 800; k++) {
        const y = r.int(2020, 2030), m = r.int(1, 12), dd = r.int(1, 28);
        const d = `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        const n = r.int(-800, 800);
        const s = shiftDate(d, n);
        assert.match(s, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(shiftDate(s, -n), d, `ida y vuelta ${d} ${n}`);
        assert.equal(daysBetween(d, s), Math.max(n, 0), `daysBetween(${d}, ${s})`);
        assert.equal(daysBetween(s, d), Math.max(-n, 0));
        assert.ok((n >= 0) === (s >= d));
      }
    }));
  }
});
