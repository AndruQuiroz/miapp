'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('./helpers/core');
Object.assign(global, core);
const Q = require('../app/quick.js'); Object.assign(global, Q);
const M = require('../app/movs.js');
const HOY = '2026-10-16';
const P = t => M.parseMovimientos(t, { hoy: HOY });

test('Nequi: encabezados de día, Para/De, signos y saldo', () => {
  const t = `Movimientos
Saldo disponible $ 2.345.678,00
Hoy
Pago en D1 VILLA HERMOSA -$ 45.300,00
Para JUAN PEREZ -$ 1.900.000,00
De CAMILO RAMIREZ $ 1.600.000,00
Ayer
Pago en UBER RIDES -$ 18.500,00
Recarga desde Bancolombia $ 500.000,00
14 de octubre de 2026
4x1000 -$ 7.600,00
Intereses $ 1.234,00`;
  const r = P(t);
  assert.equal(r.saldo, 2345678);
  assert.deepEqual(r.map(x => [x.fecha, x.monto, x.dir]), [
    ['2026-10-16', 45300, 'out'], ['2026-10-16', 1900000, 'out'], ['2026-10-16', 1600000, 'in'],
    ['2026-10-15', 18500, 'out'], ['2026-10-15', 500000, 'in'], ['2026-10-14', 7600, 'out'], ['2026-10-14', 1234, 'in']]);
  assert.equal(r[1].quien, 'Juan Perez'); assert.equal(r[2].quien, 'Camilo Ramirez'); assert.equal(r[0].quien, 'D1 Villa Hermosa');
});

test('descripción en una línea y monto en la siguiente, fecha debajo', () => {
  const t = `Envío a ANDREA LOPEZ
-$ 120.000
15 oct 2026 · 3:45 p.m.
Recibiste de TIENDA EL COMPA
$ 80.000
13 oct 2026`;
  const r = P(t);
  assert.deepEqual(r.map(x => [x.desc, x.monto, x.dir, x.fecha]), [
    ['Envío a ANDREA LOPEZ', 120000, 'out', '2026-10-15'], ['Recibiste de TIENDA EL COMPA', 80000, 'in', '2026-10-13']]);
});

test('Bancolombia: fechas dd/mm/aaaa, montos sin $ con ,00, OCR $→S', () => {
  const t = `16/10/2026 COMPRA EN RAPPI COLOMBIA -32.900,00
15/10/2026 TRANSFERENCIA DE NEQUI 200.000,00
12/10/2026 RETIRO CAJERO EXITO -S 300.000`;
  const r = P(t);
  assert.deepEqual(r.map(x => [x.fecha, x.monto, x.dir]), [['2026-10-16', 32900, 'out'], ['2026-10-15', 200000, 'in'], ['2026-10-12', 300000, 'out']]);
});

test('diciembre leído en enero es del año pasado', () => {
  assert.equal(M.mvFecha('28 dic', '2026-01-03'), '2025-12-28');
  assert.equal(M.mvFecha('Oct 16, 2026', HOY), '2026-10-16');
});

test('clasifica: comercio→gasto con categoría, deudor→abono, grande→por clasificar, ya registrado→ignorar, regla aprendida', () => {
  const db = core.emptyDB();
  db.cobros = [{ id: 'c1', nombre: 'Camilo Ramírez', total: 2000000, pagado: 0, bolsillo: '', fecha: '2026-10-01', u: 1 }];
  db.gastos = [{ id: 'g1', desc: 'uber', valor: 18500, cat: 'Transporte', tipo: 'personal', bolsillo: 'nequi', fecha: '2026-10-15', u: 1 }];
  db.reglas = [{ id: 'andrea lopez', kind: 'gasto', desc: 'Arriendo', cat: 'Servicios', tipo: 'personal', u: 1 }];
  const movs = P(`Hoy
Pago en D1 -$ 45.300,00
Para JUAN PEREZ -$ 1.900.000,00
De CAMILO RAMIREZ $ 1.600.000,00
Para ANDREA LOPEZ -$ 900.000
De PEDRO GIL $ 350.000
Ayer
Pago en UBER RIDES -$ 18.500,00
4x1000 -$ 7.600,00
Retiro en cajero -$ 200.000`);
  const c = M.clasificarMovs(db, movs, { bolsillo: 'nequi' });
  assert.deepEqual(c.map(x => x.accion), ['gasto', 'pend', 'abono', 'gasto', 'pend', 'ignorar', 'gasto', 'mover']);
  assert.equal(c[7].otro, 'efectivo');
  assert.equal(c[0].cat, 'Comida');
  assert.equal(c[2].cobroId, 'c1');
  assert.equal(c[3].cat, 'Servicios'); assert.equal(c[3].desc2, 'Arriendo');
  assert.equal(c[6].cat, 'Comisiones'); assert.equal(c[6].tipo, 'negocio');
  assert.equal(c[5].ya, 'gasto');
});

test('limpia la basura del lector ("O) Juan"), reconoce gasolineras y la recarga desde otra cuenta tuya', () => {
  const db = core.emptyDB();
  db.bolsillos.push({ id: 'banco', nombre: 'Bancolombia', ini: 0, u: 2 });
  const movs = P(`Hoy
O) Juan Carlos Gallego Cardona -$ 7.000
0) DISTRACOM APOLO -$ 10.000
Recarga desde Bancolombia $ 500.000`);
  assert.equal(movs[0].quien, 'Juan Carlos Gallego Cardona');
  const c = M.clasificarMovs(db, movs, { bolsillo: 'nequi' });
  assert.equal(c[1].accion, 'gasto'); assert.equal(c[1].cat, 'Transporte');
  assert.equal(c[2].accion, 'mover'); assert.equal(c[2].otro, 'banco');
});

test('desde "Por clasificar": no se marca a sí mismo como repetido', () => {
  const db = core.emptyDB();
  db.pend = [{ id: 'p1', raw: 'x', monto: 7000, dir: 'out', quien: 'Juan', fecha: HOY, bolsillo: 'nequi', u: 1 }];
  const c = M.clasificarMovs(db, [{ pendId: 'p1', raw: 'x', fecha: HOY, desc: 'Juan', quien: 'Juan', monto: 7000, dir: 'out' }], { bolsillo: 'nequi' });
  assert.equal(c[0].ya, undefined); assert.equal(c[0].accion, 'pend');
});
