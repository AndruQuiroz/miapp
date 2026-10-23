'use strict';
// Modo discreto: el botón 👁️ oculta (difumina) todos los montos en cualquier pantalla, y recuerda la elección.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../helpers/core');
const { bootApp, e2eSkipReason } = require('../e2e/harness');
const SKIP = e2eSkipReason();

function db0() {
  const db = core.emptyDB();
  db.bolsillos = db.bolsillos.map(b => Object.assign({}, b, { ini: b.id === 'nequi' ? 2500000 : 0, u: 5 }));
  db.gastos = [{ id: 'g1', desc: 'Rappi', valor: 35500, cat: 'Comida', tipo: 'personal', bolsillo: 'nequi', fecha: require('../helpers/clock').NOW_ISO.slice(0, 10), u: 2 }];
  return db;
}
describe('modo discreto', { skip: SKIP }, () => {
  test('marca los montos y los oculta al tocar 👁️; el texto no cambia', async () => {
    const app = await bootApp({ db: db0(), cfg: { onboarded: true } });
    try {
      await app.advance(50);
      const antes = app.text('#v-inicio');
      assert.ok(app.$$('#v-inicio .plata').length >= 1, 'no marcó los montos de Inicio');
      assert.ok(app.$$('#hdrDate .plata').length === 1, 'la caja del encabezado no quedó marcada');
      assert.equal(app.document.body.classList.contains('discreto'), false);
      app.click('[data-testid="discreto"]'); await app.settle();
      assert.equal(app.document.body.classList.contains('discreto'), true);
      assert.equal(app.text('#v-inicio'), antes, 'el texto no debe cambiar, solo verse borroso');
      app.click('[data-testid="tab-movs"]'); await app.advance(50);
      const ms = app.$$('#movsBody .plata').map(e => e.textContent);
      assert.ok(ms.some(t => /35\.500/.test(t)), 'el gasto del historial también queda oculto');
      assert.equal(app.cfg.discreto, true, 'recuerda la elección');
    } finally { app.close(); }
  });
  test('si estaba prendido, arranca oculto', async () => {
    const app = await bootApp({ db: db0(), cfg: { onboarded: true, discreto: true } });
    try {
      await app.advance(50);
      assert.equal(app.document.body.classList.contains('discreto'), true);
      assert.equal(app.$('#discretoBtn').textContent, '🙈');
    } finally { app.close(); }
  });
});
