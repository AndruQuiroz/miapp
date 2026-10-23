'use strict';
// Texto para publicar: distinto cada vez, con los datos del equipo y el precio.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../helpers/core');
const { bootApp, e2eSkipReason, norm } = require('../e2e/harness');
const SKIP = e2eSkipReason();

describe('texto para publicar', { skip: SKIP }, () => {
  test('arma el texto con batería, IMEI y precio; "otra versión" lo cambia', async () => {
    const db = core.emptyDB();
    db.items = [{ id: 'i1', desc: 'iPhone 15 Pro 256', cat: 'Celulares', buyPrice: 2800000, buyPocket: 'nequi', buyDate: '2026-10-10', targetPrice: 3400000, bateria: 92, ciclos: 120, imei: '358090000000006', cond: 'bueno', status: 'stock', u: 2 }];
    const app = await bootApp({ db, cfg: { onboarded: true } });
    try {
      app.click('[data-testid="tab-mas"]'); app.click('[data-testid="mas-extras"]'); await app.settle();
      app.click('[data-testid="publicar-elegir"]'); await app.settle();
      app.click('[data-testid="pub-item"][data-id="i1"]'); await app.settle();
      const t1 = app.$('#pubTxt').value;
      assert.match(t1, /iPhone 15 Pro 256/);
      assert.match(t1, /92%/); assert.match(t1, /3\.400\.000/); assert.match(norm(t1), /medellin/);
      // "otra versión" produce (casi siempre) un texto distinto
      let distinto = false;
      for (let i = 0; i < 8 && !distinto; i++) { app.click('[data-testid="pub-otra"]'); await app.settle(); if (app.$('#pubTxt').value !== t1) distinto = true; }
      assert.ok(distinto, 'debería variar entre versiones');
    } finally { app.close(); }
  });
});
