'use strict';
// IA opcional: con clave, la frase pasa por la IA (simulada) y su respuesta abre el formulario/lote; si falla, el lector local.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../helpers/core');
const { bootApp, e2eSkipReason, norm } = require('../e2e/harness');
const SKIP = e2eSkipReason();

async function conIA(app, impl) {
  app.window.iaLlamar = impl;
  app.type('#qInput', 'bendí el trece pro en uno seis'); app.submit('#qForm');
  await app.settle(); await app.advance(50);
}
describe('IA opcional', { skip: SKIP }, () => {
  test('sin clave: nada cambia (lector local, sin llamar a la IA)', async () => {
    const app = await bootApp({ db: core.emptyDB(), cfg: { onboarded: true } });
    try {
      let llamada = false; app.window.iaLlamar = async () => { llamada = true; };
      app.type('#qInput', 'almuerzo 18 mil'); app.submit('#qForm'); await app.settle();
      assert.equal(llamada, false);
      assert.ok(app.$('#sheetForm'));
    } finally { app.close(); }
  });
  test('con clave: usa lo que entendió la IA, le pasa la pista local y el contexto', async () => {
    const app = await bootApp({ db: core.emptyDB(), cfg: { onboarded: true, iaKey: 'K' } });
    try {
      let args;
      await conIA(app, async (t, ctx, o) => { args = { t, ctx, o }; return { modelo: 'm1', ops: [{ kind: 'gasto', d: { desc: 'Almuerzo', cat: 'Comida', valor: 18000 } }] }; });
      assert.equal(args.o.key, 'K'); assert.ok(Array.isArray(args.o.pista)); assert.ok(Array.isArray(args.ctx.bolsillos));
      const v = app.$('#f-valor'); assert.ok(v); assert.equal(String(v.value).replace(/\D/g, ''), '18000');
      // al guardar, la frase queda como ejemplo de cómo habla
      app.submit('#sheetForm'); await app.settle();
      const ej = JSON.parse(app.window.localStorage.getItem('miapp_ia_ej'));
      assert.equal(ej.length, 1); assert.equal(ej[0].ops[0].kind, 'gasto'); assert.equal(ej[0].ops[0].monto, 18000);
    } finally { app.close(); }
  });
  test('si la IA falla (cuota), abre lo del lector local y avisa', async () => {
    const app = await bootApp({ db: core.emptyDB(), cfg: { onboarded: true, iaKey: 'K' } });
    try {
      await conIA(app, async () => { throw new Error('cuota'); });
      assert.ok(app.$('#sheetForm') || app.$('#sheetBody'));
      assert.match(norm(app.text('body')), /se acabo la ia gratis/);
    } finally { app.close(); }
  });
  test('Ajustes muestra la sección de IA', async () => {
    const app = await bootApp({ db: core.emptyDB(), cfg: { onboarded: true } });
    try {
      app.click('[data-testid="tab-mas"]'); app.click('#masSeg [data-seg="ajustes"]'); await app.settle();
      assert.ok(app.$('[data-testid="cfg-ia"]')); assert.match(norm(app.text('[data-testid="ia-estado"]')), /sin clave/);
    } finally { app.close(); }
  });
});
