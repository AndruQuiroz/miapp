'use strict';
/**
 * Ronda 6 — "📷 Leer datos de una foto" (app/ocr.js) con jsdom. `leerImagenes` se reemplaza por un stub (sin Tesseract).
 *   · ficha → foto → progreso → "Esto encontré" (casillas, editar, "antes: X") → Guardar → la ficha muestra IMEI, IMEI 2, batería…
 *   · sin datos: consejos + ver el texto leído
 *   · modelo distinto: aviso suave
 *   · falla la descarga del lector: toast y nada se rompe
 *   · desde el formulario de Compra: llena los campos
 *
 *   node --test tests/frontend/ui-ocr.test.js        (se salta solo si no hay jsdom)
 */
const fs = require('node:fs');
const path = require('node:path');
const FRONT_JSDOM = '/tmp/claude-0/-home-claude/06e1c601-47b9-59d5-b935-12c557c2f42b/scratchpad/frontend/node_modules';
if (!process.env.JSDOM_DIR && fs.existsSync(path.join(FRONT_JSDOM, 'jsdom'))) process.env.JSDOM_DIR = FRONT_JSDOM;

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../helpers/core');
const { bootApp, e2eSkipReason, norm } = require('../e2e/harness');

const SKIP = e2eSkipReason();
const OK_CFG = { onboarded: true, fondosIntro: 'no' };
const IMEI1 = '356789012345678', IMEI2 = '356789012345686';

function dbCon(extra = {}) {
  const db = core.emptyDB();
  db.items.push(Object.assign({ id: 'ip13', desc: 'iPhone 13 128GB', cat: 'Celulares', cond: 'bueno', buyPrice: 1300000, buyPocket: 'nequi', buyDate: '2026-09-28', status: 'stock', u: 10 }, extra));
  return db;
}
/* stub: guarda las llamadas, emite progreso como Tesseract y devuelve `res` (o lanza `err`) */
const stub = (app, res, err) => app.evalInPage(`window.__ocrCalls = []; leerImagenes = async (files, prog) => {
  window.__ocrCalls.push(files.length);
  prog({status: 'loading language traineddata', progress: 0.5});
  prog({status: 'recognizing text', progress: 0.45});
  ${err ? `throw new Error(${JSON.stringify(err)});` : ''}
  return ${JSON.stringify(res)};
};`);
const run = async (app, n = 2) => { app.evalInPage(`ocrRun(Array.from({length: ${n}}, (_, i) => ({name: 'foto' + i + '.png'})))`); await app.settle(); };
const ficha = app => { app.click('[data-testid="tab-stock"]'); app.click('#stockBody [data-testid="item"][data-id="ip13"] [data-a="ficha"]'); };
const item = app => core.L(app.db, 'items').find(i => i.id === 'ip13');

describe('ui-ocr: leer datos de una foto desde la ficha', { skip: SKIP }, () => {
  test('flujo completo: progreso → "Esto encontré" → editar/desmarcar → Guardar → la ficha lo muestra', async () => {
    const app = await bootApp({ db: dbCon({ bateria: 90 }), cfg: OK_CFG });
    try {
      ficha(app);
      assert.ok(app.$('[data-testid="ocr-ficha"]'), 'botón en la ficha');
      stub(app, { imei: IMEI1, imei2: IMEI2, imeis: [IMEI1, IMEI2], bateria: 86, almac: '128 GB', modelo: 'iPhone 13', serie: 'F2LXK0ABCD12', texto: 'IMEI ' + IMEI1 });
      app.click('[data-testid="ocr-ficha"]');
      // el progreso se ve mientras lee (antes de resolver la promesa)
      app.evalInPage(`ocrRun([{name:'a.png'},{name:'b.png'}])`);
      assert.match(norm(app.text('[data-testid="ocr-progreso"]')), /leyendo foto 1 de 2… 45%|descargando el lector/);
      await app.settle();
      assert.deepEqual(JSON.parse(app.evalInPage('JSON.stringify(window.__ocrCalls)')), [2]);
      assert.equal(app.text('#sheetTitle'), '📷 Esto encontré');
      const rows = app.$$('[data-testid="ocr-row"]').map(r => r.dataset.k);
      assert.deepEqual(rows, ['imei', 'imei2', 'bateria', 'almac', 'serie']);
      assert.match(app.text('[data-testid="ocr-row"][data-k="imei"]'), /✅ IMEI válido/);
      assert.equal(app.$('[data-testid="ocr-v-almac"]').value, '128GB');
      assert.match(app.text('[data-testid="ocr-antes-bateria"]'), /antes: 90%/);
      assert.equal(app.$('[data-testid="ocr-modelo"]'), null, 'mismo modelo: sin aviso');
      // corrige la batería y no guarda la serie
      app.type('[data-testid="ocr-v-bateria"]', '87');
      app.$('[data-testid="ocr-on-serie"]').checked = false;
      app.click('[data-testid="ocr-save"]'); await app.settle();
      const it = item(app);
      assert.deepEqual({ i: it.imei, i2: it.imei2, b: it.bateria, a: it.almac, s: it.serie }, { i: IMEI1, i2: IMEI2, b: 87, a: '128GB', s: undefined });
      assert.equal(app.$('#sheetBody').dataset.ficha, 'ip13', 'vuelve a la ficha');
      const t = app.text('#sheetBody');
      assert.match(t, new RegExp('IMEI\\s*' + IMEI1)); assert.match(t, new RegExp('IMEI 2\\s*' + IMEI2)); assert.match(t, /87%/);
      assert.match(app.text('#toast'), /iPhone 13 128GB: IMEI · IMEI 2 · 🔋 87% · 128GB/);
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('IMEI corregido a mano debe tener 15 dígitos', async () => {
    const app = await bootApp({ db: dbCon(), cfg: OK_CFG });
    try {
      ficha(app); stub(app, { imei: IMEI1, imeis: [IMEI1], texto: 'x' });
      app.click('[data-testid="ocr-ficha"]'); await run(app, 1);
      app.type('[data-testid="ocr-v-imei"]', '12345');
      app.click('[data-testid="ocr-save"]'); await app.settle();
      assert.match(app.text('#toast'), /15 dígitos/);
      assert.ok(!item(app).imei);
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('sin datos: mensaje con consejos y botón para ver el texto leído', async () => {
    const app = await bootApp({ db: dbCon(), cfg: OK_CFG });
    try {
      ficha(app); stub(app, { imeis: [], texto: 'Hola <b>mundo</b> sin datos' });
      app.click('[data-testid="ocr-ficha"]'); await run(app, 1);
      assert.ok(app.$('[data-testid="ocr-nada"]'));
      assert.match(app.text('#sheetBody'), /Ajustes → General → Información/);
      assert.match(app.text('#sheetBody'), /Estado y carga/);
      assert.ok(app.isHidden('[data-testid="ocr-texto"]'));
      app.click('[data-testid="ocr-ver-texto"]');
      assert.ok(!app.isHidden('[data-testid="ocr-texto"]'));
      assert.equal(app.text('[data-testid="ocr-texto"]'), 'Hola <b>mundo</b> sin datos', 'texto escapado');
      assert.equal(app.$('[data-testid="ocr-texto"] b'), null);
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('modelo distinto: aviso suave (igual deja guardar)', async () => {
    const app = await bootApp({ db: dbCon(), cfg: OK_CFG });
    try {
      ficha(app); stub(app, { imei: IMEI1, imeis: [IMEI1], almac: '256GB', modelo: 'iPhone 15 Pro', texto: 'x' });
      app.click('[data-testid="ocr-ficha"]'); await run(app, 1);
      assert.match(app.text('[data-testid="ocr-modelo"]'), /La foto parece de un iPhone 15 Pro y este producto es iPhone 13 128GB: ¿seguro\?/);
      app.click('[data-testid="ocr-save"]'); await app.settle();
      assert.equal(item(app).imei, IMEI1); assert.equal(item(app).almac, '256GB');
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('sin internet para descargar el lector: toast claro, vuelve a la ficha y nada cambia', async () => {
    const app = await bootApp({ db: dbCon(), cfg: OK_CFG });
    try {
      ficha(app); stub(app, null, 'No se pudo descargar el lector (¿sin internet?)');
      app.click('[data-testid="ocr-ficha"]'); await run(app, 1);
      assert.match(app.text('#toast'), /No pude descargar el lector de fotos\. Revisa tu internet/);
      assert.equal(app.$('#sheetBody').dataset.ficha, 'ip13');
      assert.ok(!item(app).imei);
      // se puede volver a intentar
      stub(app, { imei: IMEI1, imeis: [IMEI1], texto: 'x' });
      app.click('[data-testid="ocr-ficha"]'); await run(app, 1);
      assert.equal(app.text('#sheetTitle'), '📷 Esto encontré');
      app.assertNoErrors();
    } finally { app.close(); }
  });
});

describe('ui-ocr: desde el formulario de Compra', { skip: SKIP }, () => {
  test('"Datos del equipo" → foto → llena IMEI, batería y almacenamiento; se guardan al comprar', async () => {
    const app = await bootApp({ db: core.emptyDB(), cfg: OK_CFG });
    try {
      app.click('[data-testid="act-compra"]');
      app.type('#f-desc', 'iPhone 13'); app.type('#f-buyPrice', '1.3M');
      app.click('[data-testid="f-_equipo"]');
      stub(app, { imei: IMEI1, imei2: IMEI2, imeis: [IMEI1, IMEI2], bateria: 88, almac: '128GB', modelo: 'iPhone 13', texto: 'x' });
      app.click('[data-testid="ocr-form"]'); await run(app, 2);
      assert.equal(app.$('#f-imei').value, IMEI1); assert.equal(app.$('#f-imei2').value, IMEI2);
      assert.ok(!app.isHidden('[data-fk="imei2"]'));
      assert.equal(app.$('#f-bateria').value, '88'); assert.equal(app.$('#f-almac').value, '128GB');
      assert.match(app.text('[data-testid="ocr-form-msg"]'), /✅/);
      app.submit('#sheetForm'); await app.settle();
      const it = core.L(app.db, 'items')[0];
      assert.deepEqual({ i: it.imei, i2: it.imei2, b: it.bateria, a: it.almac }, { i: IMEI1, i2: IMEI2, b: 88, a: '128GB' });
      app.assertNoErrors();
    } finally { app.close(); }
  });
});
