'use strict';
/**
 * Constructores de registros para tests. Cada uno devuelve un registro COMPLETO según SPEC §3
 * con valores neutros; pasa solo lo que te interesa:  gasto({valor: 5000, tipo: 'negocio'}).
 * Los ids son únicos en todo el proceso (g001, i002, …).
 */
const { COLS, emptyDB } = require('./core');

let seq = 0;
const nid = p => `${p}${String(++seq).padStart(3, '0')}`;
const U = 1790000000000; // un "u" cualquiera (~ sept-2026)

const item = (o = {}) => ({ id: nid('i'), desc: 'Producto', cat: 'Otro', cond: 'bueno', notes: '', buyPrice: 0, buyPocket: '', buyDate: '2026-09-01', targetPrice: null, status: 'stock', u: U, ...o });
const sold = (o = {}) => item({ status: 'sold', sellPrice: 0, sellPocket: '', sellDate: '2026-09-10', sellNotes: '', ...o });
const gasto = (o = {}) => ({ id: nid('g'), desc: 'Gasto', valor: 0, cat: 'Otro', tipo: 'personal', bolsillo: 'efectivo', fecha: '2026-10-01', u: U, ...o });
const ingreso = (o = {}) => ({ id: nid('n'), desc: 'Ingreso', valor: 0, bolsillo: 'nequi', fecha: '2026-10-01', u: U, ...o });
const cobro = (o = {}) => ({ id: nid('c'), nombre: 'Cliente', tel: '', total: 0, pagado: 0, bolsillo: '', fecha: '2026-10-01', compromiso: '', notas: '', u: U, ...o });
const abono = (o = {}) => ({ id: nid('a'), cobroId: '', monto: 0, bolsillo: 'nequi', fecha: '2026-10-01', u: U, ...o });
const transfer = (o = {}) => ({ id: nid('t'), from: 'nequi', to: 'efectivo', monto: 0, fecha: '2026-10-01', u: U, ...o });
const ajuste = (o = {}) => ({ id: nid('j'), bolsillo: 'nequi', delta: 0, fecha: '2026-10-01', nota: '', u: U, ...o });
const pend = (o = {}) => ({ id: nid('p'), raw: 'Enviaste $1.000 a PRUEBA', monto: 1000, dir: 'out', quien: 'PRUEBA', fecha: '2026-10-05', bolsillo: 'nequi', u: U, ...o });
const bolsillo = (id, nombre, ini = 0, o = {}) => ({ id, nombre, ini, u: U, ...o });
const regla = (o = {}) => ({ id: 'rappi', kind: 'gasto', desc: 'Rappi', cat: 'Comida', tipo: 'personal', u: U, ...o });

/** DB a partir de colecciones; lo que no pases queda vacío (bolsillos: efectivo/nequi con ini 0). */
function makeDB(parts = {}) {
  const d = emptyDB();
  // contrato de este builder: bolsillos efectivo/nequi (la semilla nequi_pareja de SPEC §13 se pasa explícita si se necesita)
  d.bolsillos = d.bolsillos.filter(b => b.id === 'efectivo' || b.id === 'nequi');
  for (const [k, v] of Object.entries(parts)) d[k] = v;
  return d;
}

/** Normaliza una DB para comparar: colecciones ordenadas por id (mergeDB NO garantiza el orden). */
function norm(db) {
  const o = {};
  for (const c of COLS) o[c] = [...((db && db[c]) || [])].sort((x, y) => (String(x.id) < String(y.id) ? -1 : String(x.id) > String(y.id) ? 1 : 0));
  return o;
}

/** Copia profunda (JSON) para comparar "antes/después" y probar que una función no muta su entrada. */
const clone = x => JSON.parse(JSON.stringify(x));

/** Congela en profundidad: cualquier mutación lanza TypeError en modo estricto. */
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

module.exports = { U, item, sold, gasto, ingreso, cobro, abono, transfer, ajuste, pend, bolsillo, regla, makeDB, norm, clone, deepFreeze };
