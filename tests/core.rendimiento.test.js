'use strict';
// Patrimonio y rendimiento: el cambio de patrimonio de un mes cuadra con la contabilidad del mes.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const c = require('../app/core.js');
const demo = require('./fixtures/demo-db.json');

function esperado(db, ym){
  const s = c.monthStats(db, ym);
  const inM = d => String(d || '').slice(0, 7) === ym;
  const aj = c.sum(c.L(db, 'ajustes').filter(a => inM(a.fecha)), 'delta');
  // productos que entran sin salir plata y sin venta asociada (regalo, "no salió de mis bolsillos", lista "recibido")
  const sinPlata = c.sum(c.L(db, 'items').filter(i => inM(i.buyDate) && (i.buyPocket === '' || i.buyPocket == null) && !i.fromTradeOf), 'buyPrice');
  return s.neta + s.ing - s.gP + aj + sinPlata;
}
test('demo: en cada mes, cambio de patrimonio = ganancia + ingresos − gasto personal + ajustes', () => {
  const meses = [...new Set(c.L(demo, 'items').map(i => String(i.buyDate).slice(0, 7)))].sort();
  meses.forEach(ym => {
    const r = c.rendimiento(demo, ym);
    assert.equal(r.cambio, esperado(demo, ym), ym);
  });
});
test('venta con parte de pago y venta fiada no inventan ni pierden patrimonio', () => {
  const db = c.emptyDB();
  db.bolsillos = db.bolsillos.map(b => Object.assign({}, b, {ini: b.id === 'nequi' ? 5000000 : 0}));
  db.items = [
    {id: 'a', desc: 'iPhone 15', buyPrice: 3000000, buyPocket: 'nequi', buyDate: '2026-10-01', status: 'sold', sellPrice: 4100000, sellPaid: 2000000, sellPocket: 'efectivo', sellDate: '2026-10-05', tradeInId: 'b', u: 1},
    {id: 'b', desc: 'iPhone 13', buyPrice: 2100000, buyPocket: '', buyDate: '2026-10-05', fromTradeOf: 'a', status: 'stock', u: 1},
    {id: 'c', desc: 'iPhone 12', buyPrice: 800000, buyPocket: 'nequi', buyDate: '2026-10-02', status: 'sold', sellPrice: 1100000, sellPaid: 0, sellPocket: 'efectivo', sellDate: '2026-10-06', u: 1}];
  db.cobros = [{id: 'k', nombre: 'Mateo', total: 1100000, pagado: 0, bolsillo: '', fecha: '2026-10-06', itemId: 'c', u: 1}];
  db.gastos = [{id: 'g', desc: 'Almuerzo', valor: 50000, tipo: 'personal', bolsillo: 'efectivo', fecha: '2026-10-07', u: 1}];
  const r = c.rendimiento(db, '2026-10');
  assert.equal(r.neta, 1100000 + 300000);
  assert.equal(r.cambio, 1400000 - 50000);
  assert.equal(r.pFin.deben, 1100000);
  assert.equal(r.estado, 'creciendo');
});
test('gastar más de lo que se gana = "comiendo" capital, con el monto', () => {
  const db = c.emptyDB();
  db.bolsillos = db.bolsillos.map(b => Object.assign({}, b, {ini: b.id === 'nequi' ? 2000000 : 0}));
  db.items = [{id: 'a', desc: 'X', buyPrice: 500000, buyPocket: 'nequi', buyDate: '2026-10-01', status: 'sold', sellPrice: 700000, sellPocket: 'nequi', sellDate: '2026-10-03', u: 1}];
  db.gastos = [{id: 'g', desc: 'Salida', valor: 450000, tipo: 'personal', bolsillo: 'nequi', fecha: '2026-10-04', u: 1}];
  const r = c.rendimiento(db, '2026-10');
  assert.equal(r.estado, 'comiendo'); assert.equal(r.comido, 250000); assert.equal(Math.round(r.pctGasto * 100), 225);
});
