'use strict';
/**
 * Autoprueba del harness e2e con una MINI app (tests/e2e/fixtures/mini): comprueba que jsdom + reloj falso + stubs + servidor
 * falso funcionan antes de apuntar el harness a la app real. Se salta sola si jsdom no está instalado.
 * (La mini app usa core.js real y la referencia de quick: no depende de lo que escriba el Frontend.)
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = require('../helpers/core');
const { HOY } = require('../helpers/clock');
const { bootApp, jsdomAvailable, appFiles, e2eSkipReason } = require('./harness');
const { createFakeServer } = require('./fake-server');

const MINI = path.join(__dirname, 'fixtures/mini');
const FIXTURES = path.resolve(__dirname, '../fixtures');
const DEMO = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'demo-db.json'), 'utf8'));
const KEY = 'CLAVE-DE-PRUEBA', URL_EXEC = 'https://script.google.com/macros/s/AKfycbFAKE/exec';
const CFG = { url: URL_EXEC, key: KEY, onboarded: true };
const SKIP = jsdomAvailable() ? false : 'jsdom no está instalado (ver tests/README.md)';

const boot = (o = {}) => bootApp({ appDir: MINI, extraDirs: [FIXTURES], db: DEMO, ...o });
const status = app => app.text('#status');
const nuevo = app => app.db.gastos.find(g => !DEMO.gastos.some(d => d.id === g.id));   // el gasto recién creado

describe('harness e2e: arranque', { skip: SKIP }, () => {
  test('carga los scripts en el orden del HTML (el CDN no se descarga), sin errores, con la hora de la ventana = hoy', async () => {
    const app = await boot();
    try {
      assert.deepEqual(app.ran.map(r => r.src), ['https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js', 'core.js', 'quick.reference.js', 'mini.js']);
      assert.ok(app.ran[0].skipped);
      app.assertNoErrors();
      assert.match(app.text('#count'), new RegExp(`gastos: 25 \\| hoy: ${HOY}`));
      assert.equal(app.window.Date.now(), app.clock.now);
    } finally { app.close(); }
  });

  test('el localStorage se siembra antes de los scripts y se puede leer como objetos (app.db / app.cfg)', async () => {
    const app = await boot({ cfg: CFG });
    try {
      assert.equal(app.db.gastos.length, 25);
      assert.deepEqual(app.cfg, CFG);
      assert.equal(app.evalInPage('DB.items.length'), 20);   // accede a los const/let globales de la página
    } finally { app.close(); }
  });

  test('un script que falta, uno type=module o una ruta absoluta se reportan como error (no se tragan)', async () => {
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'harness-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><body><script src="no-existe.js"></script><script type="module">1</script><script src="/core.js"></script><script>throw new Error("boom")</script></body>');
    const app = await bootApp({ appDir: dir, extraDirs: [] });
    try {
      const msgs = app.errors.map(e => e.message).join('\n');
      assert.match(msgs, /no existe el script no-existe\.js/);
      assert.match(msgs, /type=module/);
      assert.match(msgs, /ruta absoluta "\/core\.js"/);
      assert.match(msgs, /boom/);
      assert.throws(() => app.assertNoErrors(), /errores en la página/);
    } finally { app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('e2eSkipReason: dice qué falta; appFiles() sobre una carpeta vacía lista los 4 archivos', () => {
    const vacio = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'vacio-'));
    try {
      assert.deepEqual(appFiles(vacio).missing, ['index.html', 'core.js', 'quick.js', 'app.js']);
      assert.match(e2eSkipReason(vacio), /faltan .*index\.html, core\.js, quick\.js, app\.js/);
    } finally { fs.rmSync(vacio, { recursive: true, force: true }); }
  });
});

describe('harness e2e: DOM, registro rápido y persistencia', { skip: SKIP }, () => {
  test('escribir una frase y tocar ➤ guarda el gasto en localStorage con la fecha de hoy', async () => {
    const app = await boot();
    try {
      app.type('#q', 'almuerzo ejecutivo 18 mil nequi');
      app.click('#go');
      const g = nuevo(app);
      assert.ok(g, 'no se guardó el gasto');
      assert.equal(g.desc, 'Almuerzo ejecutivo');
      assert.deepEqual({ valor: g.valor, cat: g.cat, tipo: g.tipo, bolsillo: g.bolsillo, fecha: g.fecha }, { valor: 18000, cat: 'Comida', tipo: 'personal', bolsillo: 'nequi', fecha: HOY });
      assert.match(app.text('#count'), /gastos: 26/);
      assert.ok(app.byText('gastos: 26'));
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('a las 10:30 p. m. en Bogotá la fecha guardada sigue siendo la de HOY (no la de UTC)', async () => {
    const app = await boot({ now: '2026-10-05T22:30:00-05:00' });
    try {
      app.type('#q', 'uber 12k'); app.click('#go');
      assert.equal(nuevo(app).fecha, '2026-10-05');
    } finally { app.close(); }
  });
});

describe('harness e2e: nube (fetch falso, reloj falso, CORS)', { skip: SKIP }, () => {
  test('al abrir sincroniza (POST text/plain sin preflight) y mezcla lo del servidor', async () => {
    const server = createFakeServer({ key: KEY, db: { ...core.emptyDB(), pend: [{ id: 'p1', raw: 'Recibiste $50.000 de JUAN', monto: 50000, dir: 'in', quien: 'JUAN', fecha: HOY, bolsillo: 'nequi', u: 5 }] } });
    const app = await boot({ cfg: CFG, server });
    try {
      await app.advance(0);
      assert.equal(server.callsTo('sync').length, 1);
      assert.equal(server.preflightViolations, 0);
      assert.equal(server.calls[0].method, 'POST');
      const cuerpo = JSON.parse(server.calls[0].body);
      assert.deepEqual([cuerpo.action, cuerpo.key, Array.isArray(cuerpo.db.gastos)], ['sync', KEY, true]);
      assert.equal(status(app), 'al día');
      assert.ok(app.db.pend.some(p => p.id === 'p1'), 'lo del servidor no llegó al localStorage');
      assert.equal(server.db.gastos.length, 25, 'lo local no llegó al servidor');
    } finally { app.close(); }
  });

  test('un cambio sincroniza 1,5 s después (debounce): antes no, después sí', async () => {
    const server = createFakeServer({ key: KEY });
    const app = await boot({ cfg: CFG, server });
    try {
      server.reset();
      app.type('#q', 'uber 12k'); app.click('#go');
      await app.advance(1499);
      assert.equal(server.callsTo('sync').length, 0);
      await app.advance(1);
      assert.equal(server.callsTo('sync').length, 1);
      assert.ok(server.db.gastos.some(g => g.desc === 'Uber'));
    } finally { app.close(); }
  });

  test('cada 60 s mientras está visible; oculta, no', async () => {
    const server = createFakeServer({ key: KEY });
    const app = await boot({ cfg: CFG, server });
    try {
      server.reset();
      await app.advance(60000);
      assert.equal(server.callsTo('sync').length, 1);
      app.page.setVisible(false);
      server.reset();
      await app.advance(120000);
      assert.equal(server.callsTo('sync').length, 0);
      app.page.setVisible(true);   // al volver a la app sincroniza
      await app.advance(0);
      assert.equal(server.callsTo('sync').length, 1);
    } finally { app.close(); }
  });

  test('sin conexión: "sin señal"; al volver (evento online) sincroniza; fallos del servidor → "error"', async () => {
    const server = createFakeServer({ key: KEY });
    const app = await boot({ cfg: CFG, server });
    try {
      app.net.setOnline(false);
      await app.advance(0);
      assert.equal(status(app), 'sin señal');
      server.reset();
      app.net.setOnline(true);
      await app.advance(0);
      assert.equal(server.callsTo('sync').length, 1);
      assert.equal(status(app), 'al día');
      server.failNext(1, 'http500');
      await app.advance(60000);
      assert.equal(status(app), 'error');
      server.failNext(1, 'badjson');
      await app.advance(60000);
      assert.equal(status(app), 'error');
      await app.advance(60000);
      assert.equal(status(app), 'al día');
    } finally { app.close(); }
  });

  test('sin servidor ni nube: no hay ningún fetch y el estado es "sin nube"', async () => {
    const app = await boot();
    try {
      await app.advance(120000);
      assert.equal(app.fetchLog.length, 0);
      assert.equal(status(app), 'sin nube');
    } finally { app.close(); }
  });

  test('clave mala → la app ve {ok:false} y queda en "error"', async () => {
    const server = createFakeServer({ key: 'OTRA' });
    const app = await boot({ cfg: CFG, server });
    try { await app.advance(0); assert.equal(status(app), 'error'); } finally { app.close(); }
  });
});

describe('harness e2e: stubs (voz, Chart, service worker, portapapeles, WhatsApp, descargas, diálogos)', { skip: SKIP }, () => {
  test('voz: el dictado llena el registro rápido y lo ejecuta; un error se informa; sin soporte, la app lo detecta', async () => {
    const app = await boot();
    try {
      app.click('#mic');
      assert.equal(app.speech.instances.length, 1);
      assert.equal(app.speech.instances[0].lang, 'es-CO');
      app.speech.say('almuerzo 18 mil');
      assert.equal(app.$('#q').value, 'almuerzo 18 mil');
      assert.match(app.text('#out'), /Comida/);
      app.click('#mic'); app.speech.fail('not-allowed');
      assert.match(app.text('#out'), /error voz: not-allowed/);
    } finally { app.close(); }
    const sin = await boot({ speech: false });
    try { sin.click('#mic'); assert.equal(sin.text('#out'), 'sin voz'); } finally { sin.close(); }
  });

  test('Chart: stub con instancias inspeccionables; con chart:"absent" la página no se cae', async () => {
    const app = await boot();
    try { assert.equal(app.chart.instances.length, 1); assert.equal(app.chart.instances[0].type, 'bar'); app.assertNoErrors(); } finally { app.close(); }
    const sin = await boot({ chart: 'absent' });
    try { assert.equal(sin.chart.instances.length, 0); assert.equal(typeof sin.window.Chart, 'undefined'); sin.assertNoErrors(); } finally { sin.close(); }
  });

  test('service worker: se registra con ruta RELATIVA (SPEC §10.1)', async () => {
    const app = await boot();
    try { assert.equal(app.sw.registrations.length, 1); assert.equal(app.sw.registrations[0].url, './sw.js'); } finally { app.close(); }
  });

  test('portapapeles, WhatsApp (window.open) y descarga del respaldo (miapp_AAAAMMDD.json con la base completa)', async () => {
    const app = await boot({ cfg: CFG });
    try {
      app.click('#copy');
      await app.settle();
      assert.match(app.clipboard.text, /action=summary&key=CLAVE-DE-PRUEBA$/);
      app.click('#wa');
      assert.equal(app.opened.length, 1);
      assert.match(app.opened[0].url, /^https:\/\/wa\.me\/573001234567\?text=Hola%20Juan$/);
      app.click('#export');
      assert.equal(app.downloads.length, 1);
      assert.equal(app.downloads[0].filename, 'miapp_20261005.json');
      assert.equal(JSON.parse(await app.downloads.lastText()).gastos.length, 25);
      assert.equal(app.navigations.length, 0);
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('confirm(): se contesta desde la prueba (cancelar no borra; aceptar sí) y queda registrado', async () => {
    const app = await boot();
    try {
      app.dialogs.confirmAnswers.push(false);
      app.click('#del');
      assert.equal(app.$$('#count').length, 1);
      assert.match(app.text('#count'), /gastos: 25/);
      app.click('#del');   // por defecto el confirm acepta
      assert.match(app.text('#count'), /gastos: 24/);
      assert.deepEqual(app.dialogs.log.map(d => [d.type, d.answer]), [['confirm', false], ['confirm', true]]);
      assert.equal(app.db.gastos.filter(g => g.del).length, 1);   // borrado lógico, nunca físico
    } finally { app.close(); }
  });
});
