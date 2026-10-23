'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('./helpers/core');
Object.assign(global, core);
Object.assign(global, require('./../app/quick.js'));
const A = require('../app/asistente.js');

function db0() {
  const db = core.emptyDB();
  db.bolsillos = db.bolsillos.map(b => Object.assign({}, b, { ini: b.id === 'nequi' ? 1000000 : 0, u: 5 }));
  db.gastos = [
    { id: 'g1', desc: 'D1', valor: 45300, cat: 'Comida', tipo: 'personal', bolsillo: 'nequi', fecha: '2026-10-16', u: 1 },
    { id: 'g2', desc: 'D1 Villa', valor: 45300, cat: 'Comida', tipo: 'personal', bolsillo: 'nequi', fecha: '2026-10-16', u: 1 },
    { id: 'g3', desc: 'Distracom', valor: 10000, cat: 'Transporte', tipo: 'personal', bolsillo: 'nequi', fecha: '2026-10-15', u: 1 },
    { id: 'g4', desc: 'Terpel', valor: 20000, cat: 'Transporte', tipo: 'personal', bolsillo: 'nequi', fecha: '2026-10-02', u: 1 }
  ];
  db.items = [{ id: 'i13', desc: 'iPhone 13', cat: 'Celulares', buyPrice: 1200000, buyPocket: 'nequi', buyDate: '2026-10-01', status: 'sold', sellPrice: 1600000, sellPaid: 1600000, sellPocket: 'nequi', sellDate: '2026-10-10', u: 1 }];
  return db;
}
const ctx = db => ({ hoy: '2026-10-17', bolsillos: core.L(db, 'bolsillos').map(b => ({ id: b.id, nombre: b.nombre })) });
const guion = respuestas => { let i = 0; const vistos = []; return { llamar: async (sys, usr) => { vistos.push(usr); return JSON.stringify(respuestas[i++]); }, usrs: vistos }; };

test('borrar repetidos: busca con la herramienta, propone y la app arma el texto', async () => {
  const db = db0(), g = guion([
    { llamar: [{ fn: 'repetidos', args: { col: 'gastos', desde: '2026-10-16', hasta: '2026-10-16' } }] },
    { responder: 'Encontré un D1 repetido.', cambios: [{ accion: 'borrar', col: 'gastos', id: 'g2' }] }
  ]);
  const r = await A.asistente('borra los repetidos de ayer', db, ctx(db), { llamar: g.llamar });
  assert.match(g.usrs[1], /g1/); assert.match(g.usrs[1], /g2/);
  assert.equal(r.cambios.length, 1); assert.equal(r.cambios[0].id, 'g2');
  assert.match(r.cambios[0].texto, /Borrar gasto · D1 Villa/);
});

test('anti-alucinación: id inventado o que no buscó → rechazado', async () => {
  const db = db0(), g = guion([{ responder: 'listo', cambios: [{ accion: 'borrar', col: 'gastos', id: 'g3' }, { accion: 'borrar', col: 'gastos', id: 'nope' }] }]);
  const r = await A.asistente('borra la gasolina', db, ctx(db), { llamar: g.llamar });
  assert.equal(r.cambios.length, 0); assert.equal(r.rechazados.length, 2);
});

test('editar valida campos y valores; corrige el precio de venta', async () => {
  const db = db0(), g = guion([
    { llamar: [{ fn: 'buscar', args: { col: 'items', texto: '13', estado: 'vendido' } }] },
    { responder: 'Corrijo la venta.', cambios: [
      { accion: 'editar', col: 'items', id: 'i13', campos: { sellPrice: 1700000 } },
      { accion: 'editar', col: 'items', id: 'i13', campos: { status: 'stock' } },
      { accion: 'editar', col: 'items', id: 'i13', campos: { sellPocket: 'banco-falso' } }
    ] }
  ]);
  const r = await A.asistente('la venta del 13 fue en 1.7', db, ctx(db), { llamar: g.llamar });
  assert.equal(r.cambios.length, 1);
  assert.deepEqual(r.cambios[0].campos, { sellPrice: 1700000 });
  assert.match(r.cambios[0].texto, /\$1\.600\.000 → \$1\.700\.000/);
  assert.equal(r.rechazados.length, 2);
});

test('preguntas: los números salen de la app (totales y saldos)', () => {
  const db = db0(), vistos = new Set();
  const t = A.asHerramienta(db, { fn: 'totales', args: { col: 'gastos', cat: 'Transporte', desde: '2026-10-01', hasta: '2026-10-31' } }, ctx(db), vistos);
  assert.equal(t.total, 30000); assert.equal(t.cantidad, 2);
  const v = A.asHerramienta(db, { fn: 'totales', args: { col: 'ventas', desde: '2026-10-01' } }, ctx(db), vistos);
  assert.deepEqual([v.total, v.costo, v.ganancia], [1600000, 1200000, 400000]);
  const s = A.asHerramienta(db, { fn: 'saldos', args: {} }, ctx(db), vistos);
  assert.equal(s.bolsillos['Nequi (nequi)'], 1000000 - 1200000 + 1600000 - 120600);
});

test('cuadrar calcula la diferencia la app', () => {
  const db = db0();
  const v = A.asValidar(db, { accion: 'cuadrar', bolsillo: 'nequi', real: 1200000 }, ctx(db), new Set());
  assert.equal(v.ok.delta, 1200000 - (1000000 - 1200000 + 1600000 - 120600));
});

test('respuesta basura o demasiadas vueltas → mensaje claro sin cambios', async () => {
  const db = db0();
  let r = await A.asistente('x', db, ctx(db), { llamar: async () => 'hola' });
  assert.equal(r.cambios.length, 0); assert.match(r.respuesta, /no te entend/i);
  r = await A.asistente('x', db, ctx(db), { llamar: async () => JSON.stringify({ llamar: [{ fn: 'saldos', args: {} }] }) });
  assert.equal(r.cambios.length, 0);
});

test('crear y preguntar pasan tal cual', async () => {
  const db = db0();
  const r = await A.asistente('x', db, ctx(db), { llamar: async () => JSON.stringify({ responder: 'ok', crear: [{ frase: 'almuerzo 18 mil' }], preguntar: '¿Cuál de los dos?' }) });
  assert.deepEqual(r.crear, ['almuerzo 18 mil']); assert.equal(r.pregunta, '¿Cuál de los dos?');
});
