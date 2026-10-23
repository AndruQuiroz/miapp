'use strict';
// 💬 Asistente: la IA (simulada) pide datos, propone; la app muestra la lista exacta y aplica solo con "Aplicar" (+ Deshacer).
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../helpers/core');
const { bootApp, e2eSkipReason, norm } = require('../e2e/harness');
const SKIP = e2eSkipReason();
const HOY = require('../helpers/clock').NOW_ISO.slice(0, 10);

function db0() {
  const db = core.emptyDB();
  db.gastos = [
    { id: 'g1', desc: 'D1', valor: 45300, cat: 'Comida', tipo: 'personal', bolsillo: 'nequi', fecha: HOY, u: 1 },
    { id: 'g2', desc: 'D1', valor: 45300, cat: 'Comida', tipo: 'personal', bolsillo: 'nequi', fecha: HOY, u: 1 }
  ];
  return db;
}
function guion(app, resps) { let i = 0; app.window.iaPost = async () => ({ modelo: 'm', texto: JSON.stringify(resps[Math.min(i++, resps.length - 1)]) }); }
async function decir(app, t) { app.type('#asisTxt', t); app.submit('#sheetForm'); await app.settle(); await app.advance(20); await app.settle(); }

describe('asistente', { skip: SKIP }, () => {
  test('sin IA: el botón 💬 explica que hay que prenderla', async () => {
    const app = await bootApp({ db: db0(), cfg: { onboarded: true } });
    try {
      app.click('[data-testid="asis-abrir"]'); await app.settle();
      assert.match(norm(app.text('#sheetBody')), /necesito la ia prendida/);
    } finally { app.close(); }
  });
  test('borrar el repetido: propone, Aplicar lo borra y Deshacer existe', async () => {
    const app = await bootApp({ db: db0(), cfg: { onboarded: true, iaKey: 'K' } });
    try {
      guion(app, [
        { llamar: [{ fn: 'repetidos', args: { col: 'gastos' } }] },
        { responder: 'Hay un D1 repetido.', cambios: [{ accion: 'borrar', col: 'gastos', id: 'g2' }] }
      ]);
      app.click('[data-testid="asis-abrir"]'); await app.settle();
      await decir(app, 'borra el gasto repetido del D1');
      assert.match(norm(app.text('[data-testid="asis-prop"]')), /borrar gasto · d1 \$45\.300/);
      assert.equal(core.L(app.db, 'gastos').length, 2, 'nada se aplica sin Aplicar');
      app.click('[data-testid="asis-aplicar"]'); await app.settle();
      assert.deepEqual(core.L(app.db, 'gastos').map(g => g.id), ['g1']);
      assert.match(norm(app.text('body')), /deshacer/);
    } finally { app.close(); }
  });
  test('la barra de siempre manda las preguntas al asistente', async () => {
    const app = await bootApp({ db: db0(), cfg: { onboarded: true, iaKey: 'K' } });
    try {
      guion(app, [{ llamar: [{ fn: 'totales', args: { col: 'gastos', cat: 'Comida' } }] }, { responder: 'Llevas $90.600 en comida.' }]);
      app.type('#qInput', '¿cuánto gasté en comida?'); app.submit('#qForm'); await app.settle(); await app.advance(20); await app.settle();
      assert.match(norm(app.text('[data-testid="asis-log"]')), /llevas \$90\.600 en comida/);
      assert.equal(app.$('#qInput').value, '');
    } finally { app.close(); }
  });
  test('una frase normal NO se va al asistente', async () => {
    const app = await bootApp({ db: db0(), cfg: { onboarded: true } });
    try {
      app.type('#qInput', 'almuerzo 18 mil'); app.submit('#qForm'); await app.settle();
      assert.ok(app.$('#f-valor'));
    } finally { app.close(); }
  });
});
