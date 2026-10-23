'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('./helpers/core');
Object.assign(global, core);
Object.assign(global, require('../app/quick.js'));
const IA = require('../app/ia.js');
const ctx = require('./corpus/ctx-base.json');

test('iaToOps: venta del stock + gasto, con montos, bolsillos e ids validados', () => {
  const ops = IA.iaToOps(JSON.stringify({ ops: [
    { kind: 'venta', ref: 'i13', monto: 1600000, bolsillo: 'nequi', nombre: 'Camilo' },
    { kind: 'gasto', desc: 'Almuerzo', cat: 'Comida', monto: '18000', bolsillo: 'banco-inventado', tipo: 'personal' },
    { kind: 'raro', monto: 5 }
  ], duda: null }), ctx);
  assert.equal(ops.length, 2);
  assert.deepEqual(ops[0], { kind: 'venta', d: { itemId: 'i13', sellPrice: 1600000, sellPocket: 'nequi', cliente: 'Camilo' } });
  assert.equal(ops[1].d.valor, 18000); assert.equal(ops[1].d.bolsillo, undefined); assert.equal(ops[1].d.cat, 'Comida');
});

test('iaToOps: compra + venta "__prev" con parte de pago; ref inexistente cae a desc', () => {
  const ops = IA.iaToOps('```json\n{"ops":[{"kind":"compra","desc":"17 Pro Max","cat":"Celulares","monto":3000000,"bateria":91},{"kind":"venta","ref":"__prev","monto":2000000,"tradeIn":{"desc":"16 Pro Max","valor":2100000}},{"kind":"venta","ref":"no-existe","desc":"PS5","monto":1200000}]}\n```', ctx);
  assert.equal(ops[0].d.buyPrice, 3000000); assert.equal(ops[0].d.bateria, 91);
  assert.equal(ops[1].d.itemId, '__prev'); assert.equal(ops[1].d.desc, '17 Pro Max'); assert.equal(ops[1].d.tradeIn.valor, 2100000);
  assert.equal(ops[2].d.itemId, undefined); assert.equal(ops[2].d.desc, 'PS5'); assert.equal(ops[2].d.cat, 'Consolas');
});

test('iaToOps: abono a un deudor, fiado parcial, transfer y duda', () => {
  const ops = IA.iaToOps({ ops: [
    { kind: 'abono', ref: 'cb-mono', monto: 70000 },
    { kind: 'venta', desc: '14 Pro', monto: 2000000, pagado: 500000, nombre: 'Juan' },
    { kind: 'transfer', from: 'nequi', to: 'efectivo', monto: 300000 }
  ], duda: '¿De qué bolsillo?' }, ctx);
  assert.equal(ops[0].d.cobroId, 'cb-mono');
  assert.equal(ops[1].d.completo, 'no'); assert.equal(ops[1].d.sellPaid, 500000);
  assert.deepEqual(ops[2].d, { from: 'nequi', to: 'efectivo', monto: 300000 });
  assert.equal(ops.duda, '¿De qué bolsillo?');
});

test('iaToOps: basura → null', () => {
  assert.equal(IA.iaToOps('no sé', ctx), null);
  assert.equal(IA.iaToOps({ ops: [] }, ctx), null);
});

test('iaSimple ida y vuelta con lo que entiende el parser local', () => {
  const loc = parseQuickMulti('compré un 17 pro max en 3 y lo vendí en 2M y un 16 pro max valorado como compra en 2,1', ctx);
  const s = loc.map(IA.iaSimple);
  assert.equal(s[0].kind, 'compra'); assert.equal(s[0].monto, 3000000);
  assert.equal(s[1].ref, '__prev'); assert.equal(s[1].tradeIn.valor, 2100000);
  const back = IA.iaToOps({ ops: s }, ctx);
  assert.equal(back[1].d.itemId, '__prev'); assert.equal(back[1].d.sellPrice, 2000000);
});

test('iaPrompt lleva contexto, ejemplos, pista y la fecha', () => {
  const p = IA.iaPrompt('vendí el trece', ctx, [{ t: 'almuerzo 18', ops: [{ kind: 'gasto', monto: 18000 }] }], parseQuickMulti('vendí el 13 en 1.6', ctx), '2026-10-17');
  assert.match(p.sys, /i13/); assert.match(p.sys, /2026-10-17/); assert.match(p.sys, /palo/);
  assert.match(p.usr, /almuerzo 18/); assert.match(p.usr, /programa sencillo/); assert.match(p.usr, /FRASE: "vendí el trece"/);
});

test('iaLlamar: salta modelos que no existen (404), avisa cuota (429) y clave mala (403)', async () => {
  const llamadas = [];
  const resp = (status, body) => ({ status, ok: status < 300, json: async () => body });
  global.fetch = async (url, init) => {
    llamadas.push(url);
    if (/flash-lite-latest/.test(url)) return resp(404, {});
    assert.equal(init.headers['x-goog-api-key'], 'K');
    return resp(200, { candidates: [{ content: { parts: [{ text: '{"ops":[{"kind":"gasto","desc":"Almuerzo","monto":18000}]}' }] } }] });
  };
  const r = await IA.iaLlamar('almuerzo 18', ctx, { key: 'K', hoy: '2026-10-17' });
  assert.equal(r.modelo, 'gemini-flash-latest'); assert.equal(r.ops[0].d.valor, 18000); assert.equal(llamadas.length, 2);
  global.fetch = async () => resp(429, {});
  await assert.rejects(IA.iaLlamar('x', ctx, { key: 'K' }), /cuota/);
  global.fetch = async () => resp(403, {});
  await assert.rejects(IA.iaLlamar('x', ctx, { key: 'K' }), /clave/);
  await assert.rejects(IA.iaLlamar('x', ctx, {}), /sin-clave/);
  delete global.fetch;
});

test('iaAplicarMovs: la IA mejora lo dudoso, no toca duplicados y valida ids', () => {
  const lista = [
    { fecha: '2026-10-17', desc: 'Juan', monto: 7000, dir: 'out', accion: 'pend', bolsillo: 'nequi' },
    { fecha: '2026-10-17', desc: 'D1', monto: 45000, dir: 'out', accion: 'ignorar', ya: 'gasto', bolsillo: 'nequi' },
    { fecha: '2026-10-17', desc: 'Mono', monto: 70000, dir: 'in', accion: 'pend', bolsillo: 'nequi' },
    { fecha: '2026-10-17', desc: 'X', monto: 9000, dir: 'out', accion: 'pend', bolsillo: 'nequi' }
  ];
  const r = IA.iaAplicarMovs(lista, JSON.stringify({ filas: [
    { i: 0, accion: 'gasto', cat: 'Comida', tipo: 'personal', desc: 'Juan (almuerzo)', porque: 'como antes' },
    { i: 1, accion: 'gasto', cat: 'Comida' },
    { i: 2, accion: 'abono', cobro: 'cb-mono' },
    { i: 3, accion: 'mover', otro: 'banco-que-no-existe' }
  ] }), ctx);
  assert.equal(r[0].accion, 'gasto'); assert.equal(r[0].cat, 'Comida'); assert.ok(r[0].ia);
  assert.equal(r[1].accion, 'ignorar');
  assert.equal(r[2].accion, 'abono'); assert.equal(r[2].cobroId, 'cb-mono');
  assert.equal(r[3].accion, 'pend');
  assert.equal(r.cambios, 2);
});
