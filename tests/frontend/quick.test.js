'use strict';
/**
 * Registro rápido (app/quick.js) — los 8 casos obligatorios del SPEC §6.3 + las decisiones del lead §10.2.
 *   node --test tests/frontend/quick.test.js
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Q = require(path.resolve(__dirname, '../../app/quick.js'));

const BOLS = [{ id: 'efectivo', nombre: 'Efectivo' }, { id: 'nequi', nombre: 'Nequi' }];
const CTX = {
  bolsillos: BOLS,
  stock: [{ id: 'it-ps5', desc: 'PS5 Slim 1TB' }, { id: 'it-tenis', desc: 'Tenis Jordan 1' }],
  cobros: [{ id: 'cb-juan', nombre: 'Juan' }, { id: 'cb-maria', nombre: 'María Gómez' }],
};
const parse = (t, ctx = CTX) => Q.parseQuick(t, ctx);
function caso(t, kind, campos, ctx) {
  const r = parse(t, ctx);
  assert.equal(r.kind, kind, `${t} → kind ${r.kind}; esperado ${kind}. ${JSON.stringify(r)}`);
  for (const [k, v] of Object.entries(campos)) assert.deepEqual(r.d[k], v, `${t} → d.${k} = ${JSON.stringify(r.d[k])}; esperado ${JSON.stringify(v)}`);
  return r.d;
}

describe('SPEC §6.3: los 8 casos obligatorios', () => {
  test('"compré ps5 1.2M nequi" → compra', () => caso('compré ps5 1.2M nequi', 'compra', { desc: 'Ps5', buyPrice: 1200000, buyPocket: 'nequi', cat: 'Consolas' }));
  test('"vendí ps5 1.5M efectivo" (PS5 en stock) → venta', () => caso('vendí ps5 1.5M efectivo', 'venta', { itemId: 'it-ps5', sellPrice: 1500000, sellPocket: 'efectivo' }));
  test('"envío 12k nequi" → gasto de negocio', () => caso('envío 12k nequi', 'gasto', { valor: 12000, cat: 'Envíos', tipo: 'negocio', bolsillo: 'nequi' }));
  test('"almuerzo 18 mil" → gasto personal', () => caso('almuerzo 18 mil', 'gasto', { valor: 18000, cat: 'Comida', tipo: 'personal' }));
  test('"juan me debe 200k" → cobro', () => caso('juan me debe 200k', 'cobro', { nombre: 'Juan', total: 200000 }));
  test('"juan abonó 50k nequi" (cobro de Juan) → abono', () => caso('juan abonó 50k nequi', 'abono', { cobroId: 'cb-juan', monto: 50000, bolsillo: 'nequi' }));
  test('"retiré 100k nequi" → transfer Nequi → Efectivo', () => caso('retiré 100k nequi', 'transfer', { from: 'nequi', to: 'efectivo', monto: 100000 }));
  test('"sueldo 1.3M nequi" → ingreso', () => caso('sueldo 1.3M nequi', 'ingreso', { valor: 1300000, bolsillo: 'nequi' }));
});

describe('SPEC §10.2: decisiones del lead', () => {
  test('"pesos"/"pesitos" son relleno', () => {
    caso('gasté 18.000 pesos en almuerzo', 'gasto', { valor: 18000, desc: 'Almuerzo' });
    caso('gasté 5 mil pesitos en dulces', 'gasto', { valor: 5000, desc: 'Dulces' });
    caso('juan me debe 50 mil pesos', 'cobro', { nombre: 'Juan', total: 50000 });
  });
  test('el relleno se quita solo en los bordes del nombre', () => {
    caso('luis del río me debe 50k', 'cobro', { nombre: 'Luis del Río' });
    caso('le presté 300k a juan de dios', 'cobro', { nombre: 'Juan de Dios', total: 300000 });
    caso('vendí tenis 250k fiado a luis del río', 'venta', { itemId: 'it-tenis', cliente: 'Luis del Río', completo: 'no' });
  });
  test('"pagué (el) préstamo" = gasto, y la palabra queda en la descripción', () => {
    caso('pagué el préstamo 100k nequi', 'gasto', { valor: 100000, desc: 'Préstamo', bolsillo: 'nequi' });
    caso('le hice un préstamo a juan 100k', 'cobro', { nombre: 'Juan', total: 100000 });
  });
  test('"__proto__" / "constructor" no son palabras clave ni bolsillos', () => {
    for (const w of ['__proto__', 'constructor', 'toString']) {
      const r = parse(`gasté 5k ${w}`);
      assert.equal(r.kind, 'gasto');
      assert.ok(r.d.bolsillo === undefined, JSON.stringify(r));
    }
  });
});

describe('formas que el formulario espera', () => {
  test('venta a crédito con dos montos → sellPaid = total − lo que quedó debiendo', () => {
    const d = caso('vendí ps5 1.5M fiado a juan 500k', 'venta', { itemId: 'it-ps5', sellPrice: 1500000, completo: 'no', cliente: 'Juan' });
    assert.equal(d.sellPaid, 1000000);
  });
  test('venta de algo que no está en stock → itemId "__nuevo" con desc y categoría', () => caso('vendí camiseta 40k efectivo', 'venta', { itemId: '__nuevo', desc: 'Camiseta', cat: 'Ropa' }));
  test('abono de alguien sin cobro → cobroId vacío y _nombre para el aviso', () => {
    const d = caso('andrés abonó 30k', 'abono', { monto: 30000 });
    assert.ok(!d.cobroId);
  });
});
