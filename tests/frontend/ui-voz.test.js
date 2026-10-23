'use strict';
// Modo voz: botón de la cortina (?voz=1) y aviso de Nequi (?voz=1&noti=…&bol=…), y ?q= directo.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../helpers/core');
const { bootApp, e2eSkipReason, norm } = require('../e2e/harness');
const SKIP = e2eSkipReason();
const CFG = { onboarded: true };
const wait = ms => new Promise(r => setTimeout(r, ms));
const enc = encodeURIComponent;
const NOTI = 'Recibiste $1.600.000 de CAMILO PEREZ en tu Nequi';

describe('modo voz', { skip: SKIP }, () => {
  test('?voz=1 abre "¿Qué hiciste?" con el micrófono', async () => {
    const app = await bootApp({ db: core.emptyDB(), cfg: CFG, search: '?voz=1' });
    try {
      await app.advance(800);
      assert.ok(app.$('[data-testid="voz-mic"]'));
      assert.match(norm(app.text('#sheetTitle')), /que hiciste/i);
    } finally { app.close(); }
  });
  test('con notificación: muestra el monto y si digo solo "abono de camilo" completa monto y bolsillo', async () => {
    const app = await bootApp({ db: core.emptyDB(), cfg: CFG, search: `?voz=1&noti=${enc(NOTI)}&bol=nequi` });
    try {
      await app.advance(800);
      assert.match(norm(app.text('[data-testid="voz-noti"]')), /1\.600\.000/);
      app.type('#vozTxt', 'venta del 13 pro');
      app.click('[data-testid="voz-ok"]'); await app.advance(800);
      const q = app.$('#qInput').value;
      assert.match(q, /1600000/); assert.match(q, /nequi/i);
    } finally { app.close(); }
  });
  test('"Luego" deja la notificación en Por clasificar', async () => {
    const app = await bootApp({ db: core.emptyDB(), cfg: CFG, search: `?voz=1&noti=${enc('Enviaste $45.000 a TIENDA X')}&bol=nequi` });
    try {
      await app.advance(800);
      app.click('[data-testid="voz-luego"]'); await app.settle();
      const p = core.L(app.db, 'pend');
      assert.equal(p.length, 1); assert.equal(p[0].monto, 45000); assert.equal(p[0].dir, 'out');
    } finally { app.close(); }
  });
  test('registrar desde la notificación borra el pendiente con el mismo texto', async () => {
    const db = core.emptyDB();
    db.pend = [{ id: 'p1', raw: NOTI, monto: 1600000, dir: 'in', quien: 'camilo perez', fecha: '2026-10-16', bolsillo: 'nequi', u: 1 }];
    const app = await bootApp({ db, cfg: CFG, search: `?voz=1&noti=${enc(NOTI)}&bol=nequi` });
    try {
      await app.advance(800);
      app.type('#vozTxt', 'abono de camilo');
      app.click('[data-testid="voz-ok"]'); await app.advance(800);
      assert.equal(core.L(app.db, 'pend').length, 0);
    } finally { app.close(); }
  });
  test('?q= registra la frase directo', async () => {
    const app = await bootApp({ db: core.emptyDB(), cfg: CFG, search: `?q=${enc('almuerzo 18 mil')}` });
    try {
      await app.advance(800);
      assert.ok(app.$('#sheetForm') || app.$('#sheetBody'));
      const m = app.$('#f-monto') || app.$('#f-valor'); assert.ok(m); assert.equal(String(m.value).replace(/\D/g,''), '18000');
    } finally { app.close(); }
  });
});
