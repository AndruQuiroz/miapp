'use strict';
/**
 * Humo e2e de la APP REAL (app/index.html + core.js + quick.js + app.js) con jsdom: arranque, números de Inicio, nube, SW,
 * onboarding. Solo comprueba lo que fija el SPEC (no depende de ids ni clases del Frontend; busca por texto).
 * Se salta solo si jsdom no está instalado o si la app aún no tiene los 4 archivos (el Frontend la está escribiendo).
 *
 *   node --test tests/e2e/smoke.test.js
 *   APP_DIR_E2E=/otra/carpeta node --test tests/e2e/smoke.test.js     (probar otra copia de la app)
 *
 * Las pruebas de flujos completos (registrar con la barra, clasificar un pend, cobros, WhatsApp, respaldo…) se escriben en la
 * FASE 2 sobre este mismo harness (tests/e2e/harness.js); aquí queda el esqueleto que ya corre.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = require('../helpers/core');
const { HOY } = require('../helpers/clock');
const { bootApp, e2eSkipReason, APP_DIR, norm } = require('./harness');
const { createFakeServer } = require('./fake-server');

const DIR = process.env.APP_DIR_E2E ? path.resolve(process.env.APP_DIR_E2E) : APP_DIR;
const SKIP = e2eSkipReason(DIR);
const DEMO = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/demo-db.json'), 'utf8'));
const KEY = 'CLAVE-DE-PRUEBA', URL_EXEC = 'https://script.google.com/macros/s/AKfycbFAKE/exec';
const CFG_NUBE = { url: URL_EXEC, key: KEY, onboarded: true };
const boot = (o = {}) => bootApp({ appDir: DIR, ...o });

/** ¿el texto de la página contiene este monto, en formato corto ($2.7M) o completo ($2.698.900)? */
const muestra = (app, n) => { const t = app.text(); return t.includes(core.fmt(n)) || t.includes(core.full(n)); };

describe('app real: arranque (e2e con jsdom)', { skip: SKIP }, () => {
  test('el HTML carga core.js → quick.js → app.js en ese orden, con rutas relativas (SPEC §6.6 y §10.1)', () => {
    const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
    const srcs = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
    const locales = srcs.filter(s => !/^(https?:)?\/\//.test(s));
    // ronda 6: ocr.js (lector de fotos) se permite entre core.js y quick.js; el orden core → quick → app se mantiene
    assert.deepEqual(locales.map(s => path.basename(s.split('?')[0])).filter(f => f !== 'ocr.js' && f !== 'movs.js' && f !== 'ia.js' && f !== 'asistente.js'), ['core.js', 'quick.js', 'app.js'].filter(f => locales.some(s => path.basename(s.split('?')[0]) === f)));
    for (const f of ['core.js', 'quick.js', 'app.js']) assert.ok(locales.some(s => path.basename(s.split('?')[0]) === f), `index.html no carga ${f}`);
    for (const s of locales) assert.ok(!s.startsWith('/'), `ruta absoluta "${s}": en GitHub Pages /miapp/ debe ser relativa`);
    assert.doesNotMatch(html, /type\s*=\s*["']module["']/i, 'scripts clásicos, no módulos (SPEC §6.6)');
  });

  test('arranca con la base demo sin errores no controlados, y Inicio muestra Caja hoy y Te deben calculados (SPEC §6.1)', async () => {
    const app = await boot({ db: DEMO, cfg: { onboarded: true } });
    try {
      await app.idle(2000);
      app.assertNoErrors();
      const caja = Object.values(core.balances(DEMO)).reduce((a, b) => a + b, 0);
      const debenTotal = core.cobrosPend(DEMO).reduce((a, c) => a + c.pend, 0);
      assert.ok(muestra(app, caja), `Inicio no muestra la caja (${core.fmt(caja)} / ${core.full(caja)})`);
      assert.ok(muestra(app, debenTotal), `Inicio no muestra lo que te deben (${core.fmt(debenTotal)} / ${core.full(debenTotal)})`);
      assert.match(norm(app.text()), /caja/);
      assert.match(norm(app.text()), /deben/);
    } finally { app.close(); }
  });

  test('sin nube configurada no hace ningún fetch (offline-first) y la base queda en miapp_db_v2', async () => {
    const app = await boot({ db: DEMO, cfg: { onboarded: true } });
    try {
      await app.idle(130000);
      assert.equal(app.fetchLog.length, 0, `fetch inesperado: ${JSON.stringify(app.fetchLog.map(f => f.url))}`);
      assert.ok(app.db && Array.isArray(app.db.items));
    } finally { app.close(); }
  });

  test('con nube: sincroniza al abrir con POST text/plain SIN preflight y mezcla lo del servidor (SPEC §5 y §6.5)', async () => {
    const server = createFakeServer({ key: KEY, db: { ...core.emptyDB(), pend: [{ id: 'p1', raw: 'Recibiste $50.000 de JUAN', monto: 50000, dir: 'in', quien: 'JUAN', fecha: HOY, bolsillo: 'nequi', u: 5 }] } });
    const app = await boot({ db: DEMO, cfg: CFG_NUBE, server });
    try {
      await app.idle(5000);
      const syncs = server.callsTo('sync');
      assert.ok(syncs.length >= 1, 'no sincronizó al abrir');
      assert.equal(server.preflightViolations, 0, 'el fetch puso Content-Type JSON o cabeceras propias: Apps Script no contesta el preflight');
      assert.equal(syncs[0].method, 'POST');
      const cuerpo = JSON.parse(syncs[0].body);
      assert.equal(cuerpo.key, KEY);
      assert.equal(cuerpo.action, 'sync');
      assert.ok(cuerpo.db && Array.isArray(cuerpo.db.items));
      assert.ok(app.db.pend.some(p => p.id === 'p1'), 'el pend del servidor no llegó a la base local');
      assert.ok(server.db.items.length >= DEMO.items.length, 'la base local no llegó al servidor');
      assert.ok(app.cfg && app.cfg.url === URL_EXEC, 'la configuración de nube se perdió');
    } finally { app.close(); }
  });

  test('registra el service worker con ruta relativa (SPEC §10.1)', async () => {
    const app = await boot({ db: DEMO, cfg: { onboarded: true } });
    try {
      await app.idle(1000);
      assert.ok(app.sw.registrations.length >= 1, 'no registró sw.js');
      assert.ok(!String(app.sw.registrations[0].url).startsWith('/'), `ruta absoluta del SW: ${app.sw.registrations[0].url}`);
      assert.match(String(app.sw.registrations[0].url), /sw\.js/);
    } finally { app.close(); }
  });

  test('sin Chart.js (CDN caído / offline) y sin dictado la app arranca igual (SPEC §6.6)', async () => {
    const app = await boot({ db: DEMO, cfg: { onboarded: true }, chart: 'absent', speech: false });
    try { await app.idle(2000); app.assertNoErrors(); assert.ok(app.text().length > 20, "la página quedó vacía"); } finally { app.close(); }
  });
});

describe('app real: primera vez y onboarding (SPEC §6.2 y §10.3)', { skip: SKIP }, () => {
  test('instalación nueva: pregunta si es primera vez o ya la usa en otro celular, y no toca la nube todavía', async () => {
    const app = await boot({});
    try {
      await app.idle(1000);
      assert.match(norm(app.text()), /primera vez/, 'la primera pantalla debe preguntar "¿Primera vez o ya usas Mi App en otro celular?"');
      assert.match(norm(app.text()), /otro celular/);
      assert.equal(app.fetchLog.length, 0);
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('si tras sincronizar existen bolsillos con u > 1 (venían de la nube) NUNCA se pide el saldo inicial', async () => {
    const db = core.emptyDB();
    db.bolsillos = [{ id: 'efectivo', nombre: 'Efectivo', ini: 450000, u: 1700000000000 }, { id: 'nequi', nombre: 'Nequi', ini: 4000000, u: 1700000000000 }];
    const server = createFakeServer({ key: KEY, db });
    const app = await boot({ cfg: { url: URL_EXEC, key: KEY }, server });   // sin onboarded: como quien ya la usa en otro celular
    try {
      await app.idle(5000);
      assert.doesNotMatch(norm(app.text()), /cuanto tienes hoy/, 'mostró el onboarding de saldos pese a que la nube ya trae bolsillos');
      const b = app.db.bolsillos.find(x => x.id === 'nequi');
      assert.equal(b.ini, 4000000, 'se pisó el saldo inicial de la nube');
    } finally { app.close(); }
  });
});
