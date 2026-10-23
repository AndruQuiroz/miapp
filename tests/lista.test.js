'use strict';
// §15: pegar una lista y crear el inventario (una línea = un producto).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../app/quick.js');

test('la nota real del usuario', () => {
  const r = Q.parseLista('Negro 512 2 palos\nNegro 256 fisura recibido 2\nDesert 256 2.2\nDesert recibido 2', {});
  assert.equal(r.items.length, 4);
  const [a, b, c, d] = r.items;
  assert.deepEqual([a.color, a.almac, a.buyPrice, !!a.recibido], ['Negro', '512GB', 2000000, false]);
  assert.deepEqual([b.color, b.almac, b.buyPrice, b.recibido, b.notas, b.cond], ['Negro', '256GB', 2000000, true, 'fisura', 'regular']);
  assert.deepEqual([c.color, c.almac, c.buyPrice], ['Desert', '256GB', 2200000]);
  assert.deepEqual([d.color, d.almac, d.buyPrice, d.recibido], ['Desert', undefined, 2000000, true]);
  assert.equal(r.faltaModelo, true);
  assert.match(r.sugerido, /iPhone 16 Pro/);
  assert.equal(Q.listaDesc(c, 'iPhone 16 Pro Max'), 'iPhone 16 Pro Max 256GB Desert');
});
test('con modelo, viñetas, batería, TB y montos compuestos', () => {
  const r = Q.parseLista('15 pro max azul 256 2.6\n- 13 128 blanco 85% bateria 1.2 recibido\n14 pro morado 1tb rayado 2 millones 300\niphone 12 64 negro 750', {});
  assert.equal(r.faltaModelo, false);
  assert.deepEqual(r.items.map(x => [x.modelo, x.almac, x.buyPrice]), [
    ['iPhone 15 Pro Max', '256GB', 2600000], ['iPhone 13', '128GB', 1200000], ['iPhone 14 Pro', '1TB', 2300000], ['iPhone 12', '64GB', 750000]]);
  assert.equal(r.items[1].bateria, 85); assert.equal(r.items[1].recibido, true);
});
test('ignora líneas vacías o sin números', () => {
  assert.equal(Q.parseLista('Inventario\n\nNegro 256 2\n', {}).items.length, 1);
});
