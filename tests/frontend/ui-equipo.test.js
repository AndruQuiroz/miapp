'use strict';
// Ronda 11: pegar/foto de reporte de equipo (3uTools / Ajustes) → arma la Compra; verificar IMEI.
const fs = require('node:fs');
const path = require('node:path');
const FRONT_JSDOM = '/tmp/claude-0/-home-claude/06e1c601-47b9-59d5-b935-12c557c2f42b/scratchpad/frontend/node_modules';
if (!process.env.JSDOM_DIR && fs.existsSync(path.join(FRONT_JSDOM, 'jsdom'))) process.env.JSDOM_DIR = FRONT_JSDOM;
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../helpers/core');
const { bootApp, e2eSkipReason, norm } = require('../e2e/harness');
const SKIP = e2eSkipReason();
const CFG = { onboarded: true };
const IMEI = '353911104869129';

async function leerReporte(app, r) {
  app.window.leerImagenes = async () => Object.assign({ imeis: r.imei ? [r.imei] : [], texto: 'reporte' }, r);
  app.window.ocrPick('movs');
  await app.window.ocrRun([{ name: 'x.png' }]);
  await app.settle();
}

describe('ingreso de equipo por reporte', { skip: SKIP }, () => {
  test('reporte de 3uTools → abre Compra prellenada (modelo, imei, batería, ciclos, color, almac)', async () => {
    const app = await bootApp({ db: core.emptyDB(), cfg: CFG });
    try {
      await leerReporte(app, { imei: IMEI, modelo: 'iPhone 16 Pro Max', almac: '256GB', color: 'Desert Titanium', bateria: 88, ciclos: 312 });
      assert.ok(app.$('#sheetForm'), 'abrió un formulario');
      assert.match(norm(app.text('#sheetTitle')), /compr/);
      assert.equal(app.$('#f-desc').value, 'iPhone 16 Pro Max');
      assert.equal(app.$('#f-imei').value, IMEI);
      assert.equal(String(app.$('#f-bateria').value), '88');
      assert.equal(String(app.$('#f-ciclos').value), '312');
      assert.equal(app.$('#f-almac').value, '256GB');
      assert.equal(app.$('#f-color').value, 'Desert Titanium');
      app.type('#f-buyPrice', '2100000'); app.submit('#sheetForm'); await app.settle();
      const it = core.L(app.db, 'items')[0];
      assert.equal(it.desc, 'iPhone 16 Pro Max'); assert.equal(it.imei, IMEI);
      assert.equal(it.bateria, 88); assert.equal(it.ciclos, 312); assert.equal(it.buyPrice, 2100000);
    } finally { app.close(); }
  });

  test('con un pago grande de Nequi por clasificar: la Compra toma precio y proveedor, y el pendiente desaparece', async () => {
    const db = core.emptyDB();
    db.pend = [{ id: 'p1', raw: 'Enviaste $2.100.000 a JUAN PEREZ', monto: 2100000, dir: 'out', quien: 'JUAN PEREZ', fecha: core.today(), bolsillo: 'nequi', t: Date.now(), u: 1 }];
    const app = await bootApp({ db, cfg: CFG });
    try {
      await leerReporte(app, { imei: IMEI, modelo: 'iPhone 15 Pro', almac: '128GB', bateria: 95 });
      assert.equal(String(app.$('#f-buyPrice').value).replace(/\D/g, ''), '2100000');
      assert.match(app.$('#f-proveedor').value, /juan/i);
      app.submit('#sheetForm'); await app.settle();
      assert.equal(core.L(app.db, 'pend').length, 0, 'el pago quedó como la compra');
      const it = core.L(app.db, 'items')[0];
      assert.equal(it.buyPrice, 2100000); assert.equal(it.buyPocket, 'nequi');
    } finally { app.close(); }
  });

  test('verificar IMEI: copia, abre la consulta y registra el resultado', async () => {
    const db = core.emptyDB();
    db.items.push({ id: 'ip', desc: 'iPhone 14', cat: 'Celulares', cond: 'bueno', buyPrice: 1800000, buyPocket: 'nequi', buyDate: '2026-10-01', status: 'stock', imei: IMEI, u: 5 });
    const app = await bootApp({ db, cfg: CFG });
    try {
      app.click('[data-testid="tab-stock"]'); await app.settle();
      app.click('[data-testid="item"] [data-a="ficha"]'); await app.settle();
      assert.ok(app.$('[data-testid="verif-imei"]'), 'hay botón verificar IMEI');
      app.click('[data-testid="verif-imei"]'); await app.settle();
      assert.ok(app.$('[data-testid="verif-abrir"]').getAttribute('href').includes(IMEI));
      app.click('[data-testid="verif-ok"]'); await app.settle();
      const it = core.L(app.db, 'items').find(x => x.id === 'ip');
      assert.equal(it.imeiReporte, 'ok'); assert.ok(it.imeiVerif);
    } finally { app.close(); }
  });
});
