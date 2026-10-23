'use strict';
// Ronda 5 (SPEC §14.3): parte de pago con valor estimado, gasto ligado a producto, datos del equipo, proveedor y cliente.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../app/quick.js');
const ctx = require('./corpus/ctx-base.json');
const P = s => Q.parseQuickMulti(s, ctx);

test('parte de pago: "que vale", "estimado en", "que calculo vale"', () => {
  let r = P('compré un 15 pro en 2.8 y lo vendí en 3.5 y me dieron un 13 que vale 1.4');
  assert.equal(r[0].kind, 'compra'); assert.equal(r[0].d.buyPrice, 2800000);
  assert.equal(r[1].d.sellPrice, 3500000); assert.equal(r[1].d.tradeIn.valor, 1400000);
  assert.equal(P('vendí el 16 pro max en 2 palos más un 14 estimado en 1.8')[0].d.tradeIn.valor, 1800000);
  assert.equal(P('vendí el s23 en 800 y me dejaron un 12 que calculo vale 900 mil')[0].d.tradeIn.valor, 900000);
});
test('gasto de un producto del stock queda ligado (costo real)', () => {
  const r = P('arreglo de pantalla del 13 180 mil')[0];
  assert.equal(r.kind, 'gasto'); assert.equal(r.d.itemId, 'i13'); assert.equal(r.d.tipo, 'negocio');
  assert.equal(P('cambio de aceite de la moto 45 mil')[0].d.itemId, undefined);   // la moto propia no es del stock
});
test('datos del equipo y proveedor en la compra', () => {
  const d = P('compré un 14 pro de 256 azul con 89% de batería a un man de bello en 2.3')[0].d;
  assert.equal(d.buyPrice, 2300000); assert.equal(d.bateria, 89); assert.equal(d.almac, '256GB'); assert.equal(d.color, 'azul');
  assert.match(d.proveedor, /man de bello/i);
  assert.equal(P('le compré a doña rosa un 12 en 800')[0].d.proveedor, 'Doña Rosa');
});
test('cliente en venta de contado', () => {
  assert.equal(P('vendí el 13 a mateo en 1.6 nequi')[0].d.cliente, 'Mateo');
  assert.equal(P('vendí el 13 en 1.6 nequi')[0].d.cliente, undefined);
});
