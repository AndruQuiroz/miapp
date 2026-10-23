'use strict';
/**
 * PRUEBA DE PUNTA A PUNTA en navegador REAL (Chromium vía Playwright): la app (index.html + core.js + quick.js + app.js + sw.js)
 * hablando con el Apps Script de verdad (dist/apps-script/Code.gs, ejecutado en un vm con los mocks de server/test/env.js) a través de
 * tests/e2e/server-mock.js: /exec con el 302 a "googleusercontent", CORS, sin preflight, la app bajo /miapp/ en otro origen y un CDN
 * simulado (Chart.js real si está instalado). Dos "celulares" = dos contextos de navegador (localStorage, caché y service worker aparte).
 *
 *   node --test tests/e2e/browser.test.js
 *   node --test --test-reporter=spec tests/e2e/browser.test.js        (paso a paso)
 *   HEADED=1 SLOWMO=250 node --test tests/e2e/browser.test.js         (verlo en pantalla si hay display)
 *
 * Es UNA historia en pasos (A1, A2, … cada uno depende de los anteriores): si un paso falla, los que dependen de él se saltan con el motivo
 * en vez de llenar la salida de fallos en cascada. Las capturas de pantalla quedan en tests/e2e/shots/ (cada corrida las reescribe).
 * Se salta sola si falta playwright, Chromium, openssl o la app (ver pw-harness.js).
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const coreReal = require('../helpers/core');
const { startMock } = require('./server-mock');
const { Phone, until, norm, flat, loadPlaywright, browserSkipReason, SHOTS } = require('./pw-harness');

/* SPEC §13.2 (ronda 4b): la semilla "Nequi pareja" (ini 0, sin movimientos) existe en toda base. Esta historia se escribió antes
   y compara saldos/chips exactos de Efectivo y Nequi: el bolsillo semilla en $0 se ignora en esas comparaciones (A2 sí verifica que aparece). */
const sinPareja0 = o => { const r = Object.assign({}, o); for (const k of ['nequi_pareja', 'Nequi pareja']) if (r[k] === 0 || r[k] === '$0') delete r[k]; return r; };
const core = Object.assign({}, coreReal, { balances: db => sinPareja0(coreReal.balances(db)) });
const chipsOriginal = Phone.prototype.pocketChips;
Phone.prototype.pocketChipsTodos = chipsOriginal;
Phone.prototype.pocketChips = async function () { return sinPareja0(await chipsOriginal.call(this)); };

const SKIP = browserSkipReason();
const HOY = core.today();
const AYER = core.shiftDate(HOY, -1);
const FULL = core.full;
const sinPrefijo = s => String(s || '').replace(/^'/, '');

describe('navegador real: app + Apps Script simulado (UNA historia en pasos)', { skip: SKIP }, () => {
  let mock, browser, p1, p2;
  const S = {};                       // estado compartido entre pasos
  const ok = new Set();

  /** paso de la historia: se salta (con motivo) si algún paso del que depende falló */
  function step(id, nombre, deps, fn) {
    test(`${id}. ${nombre}`, async t => {
      const falta = deps.filter(d => !ok.has(d));
      if (falta.length) return t.skip(`depende de pasos que no pasaron: ${falta.join(', ')}`);
      await fn(t);
      ok.add(id);
    });
  }

  before(async () => {
    const pw = loadPlaywright();
    mock = await startMock();
    browser = await pw.chromium.launch(Object.assign({ headless: !process.env.HEADED, slowMo: Number(process.env.SLOWMO || 0) }, mock.launchOptions()));
    p1 = await new Phone(browser, mock, 'celular 1').init();
    fs.rmSync(SHOTS, { recursive: true, force: true });       // las capturas son de ESTA corrida
  });
  after(async () => {
    if (p1) await p1.close();
    if (p2) await p2.close();
    if (browser) await browser.close();
    if (mock) await mock.close();
  });

  /* ═══════════════════════════ A · celular 1: primera vez, nube, registro, captura ═══════════════════════════ */

  step('A1', 'primera vez: la bienvenida pregunta "¿Primera vez o ya usas Mi App en otro celular?" y no toca la nube', [], async () => {
    const resp = await p1.open();
    assert.equal(resp.status(), 200);
    assert.equal(new URL(p1.page.url()).pathname, '/miapp/', 'la app debe vivir en la subruta /miapp/ (GitHub Pages)');
    assert.ok(await p1.page.isVisible('[data-testid=onboarding]'), 'no se muestra la bienvenida');
    assert.match(norm(await p1.page.innerText('[data-testid=onboarding]')), /primera vez o ya usas mi app en otro celular/);
    assert.ok(await p1.page.isVisible('[data-testid=onb-first]'));
    assert.ok(await p1.page.isVisible('[data-testid=onb-other]'));
    assert.equal(mock.calls().length, 0, 'tocó la nube antes de que el usuario la configurara');
    // service worker con ámbito /miapp/ y Chart.js del CDN cargado
    const sw = await p1.page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, active: !!r.active }; });
    assert.deepEqual(sw, { scope: mock.appUrl, active: true });
    assert.equal(await p1.page.evaluate(() => typeof Chart), 'function', 'Chart.js no cargó desde el CDN');
    // manifest accesible con rutas relativas y los iconos existen
    const man = await p1.page.evaluate(async () => {
      const m = await (await fetch(document.querySelector('link[rel=manifest]').href)).json();
      const ic = await Promise.all(m.icons.map(async i => (await fetch(new URL(i.src, document.baseURI))).status));
      return { start_url: m.start_url, scope: m.scope, display: m.display, iconos: ic };
    });
    assert.deepEqual(man, { start_url: './', scope: './', display: 'standalone', iconos: [200, 200, 200] });
    await p1.shot('01-bienvenida');
  });

  step('A2', 'primera vez: pide los saldos iniciales (Efectivo y Nequi), se escriben como a mano y Inicio los muestra', ['A1'], async () => {
    await p1.page.click('[data-testid=onb-first]');
    await p1.waitText(/Cuánto tienes hoy/);
    await p1.shot('02-saldos-iniciales');
    for (const [id, valor] of [['onb-efectivo', '450000'], ['onb-nequi', '4000000']]) {
      await p1.page.click(`[data-testid=${id}]`);
      await p1.page.locator(`[data-testid=${id}]`).pressSequentially(valor);
    }
    assert.equal(await p1.page.inputValue('[data-testid=onb-nequi]'), '4.000.000', 'el campo no muestra los puntos de miles al escribir');
    await p1.page.click('[data-testid=onb-save]');
    await p1.page.waitForSelector('[data-testid=onboarding]', { state: 'hidden' });
    await p1.waitToast(/Listo/);
    const k = await p1.kpis();
    assert.equal(k['Caja hoy'].sub, '$4.450.000');
    // SPEC §13.2: la semilla "Nequi pareja" (ini 0) existe desde el inicio
    assert.deepEqual(await p1.pocketChipsTodos(), { Efectivo: '$450.000', Nequi: '$4.000.000', 'Nequi pareja': '$0' });
    const cfg = await p1.cfg();
    assert.equal(cfg.onboarded, true);
    const db = await p1.db();
    assert.equal(db.bolsillos.find(b => b.id === 'nequi').ini, 4000000);
    assert.ok(db.bolsillos.filter(b => b.id === 'efectivo' || b.id === 'nequi').every(b => b.u > 1), 'los bolsillos con saldo inicial deben llevar u > 1 para ganar el merge en otro celular');
    assert.ok(await p1.has(/Conecta tu nube/), 'sin nube debe mostrar la tarjeta "Conecta tu nube"');
    assert.equal(await p1.syncLabel(), 'Sin nube');
    await p1.shot('03-inicio-sin-nube', { full: true });
  });

  step('A3', 'Ajustes: URL + clave → "Guardar y probar" conecta (ping), sincroniza sin preflight y entrega los enlaces de MacroDroid', ['A2'], async () => {
    await p1.mas('ajustes');
    await p1.page.fill('[data-testid=cfg-url]', mock.execUrl);
    await p1.page.fill('[data-testid=cfg-key]', mock.key);
    await p1.page.click('[data-testid=cfg-save]');
    await p1.waitToast(/Nube conectada y al día/);
    await p1.waitSync('Al día');
    assert.equal(flat(await p1.page.textContent('#cfgState')), 'Al día');
    const pings = mock.calls('ping');
    assert.equal(pings.length, 1);
    assert.equal(pings[0].method, 'GET');
    assert.equal(pings[0].query.key, mock.key);
    const syncs = mock.calls('sync');
    assert.ok(syncs.length >= 1);
    assert.equal(syncs[0].method, 'POST');
    assert.match(syncs[0].contentType, /^text\/plain/i, 'el sync debe ir como text/plain (sin preflight)');
    assert.equal(JSON.parse(syncs[0].body).key, mock.key);
    assert.equal(mock.stats.preflights, 0, 'el navegador hizo un preflight (OPTIONS): Apps Script no lo contesta');
    // la nube recibió los saldos iniciales
    const nube = mock.db();
    assert.equal(nube.bolsillos.find(b => b.id === 'nequi').ini, 4000000);
    assert.equal(nube.bolsillos.find(b => b.id === 'efectivo').ini, 450000);
    // enlaces para MacroDroid listos para copiar
    const links = await p1.page.$$eval('#mdLinks input', els => els.map(e => e.value));
    assert.deepEqual(links, [     // ronda 4b (§13.4): un enlace de captura por bolsillo digital (Nequi y Nequi pareja)
      `${mock.execUrl}?action=capture&key=${mock.key}&bolsillo=nequi`,
      `${mock.execUrl}?action=capture&key=${mock.key}&bolsillo=nequi_pareja`,
      `${mock.execUrl}?action=summary&key=${mock.key}`,
      `${mock.execUrl}?action=reminders&key=${mock.key}`
    ]);
    await p1.page.click('#mdLinks button[data-a=copy]');
    await p1.waitToast(/Copiado/);
    assert.equal(await p1.page.evaluate(() => navigator.clipboard.readText()), links[0], 'Copiar no dejó el enlace en el portapapeles');
    assert.ok(await p1.page.isDisabled('[data-testid=cfg-test]') === false);
    await p1.shot('04-ajustes-conectado', { full: true });
    // lo que MacroDroid pediría a una nube vacía: resumen con la caja y recordatorios VACÍOS (200 + texto vacío)
    const sum = await mock.get('summary');
    assert.equal(sum.status, 200);
    assert.match(sum.headers['content-type'], /^text\/plain/);
    assert.equal(sum.headers['access-control-allow-origin'], '*');
    assert.equal(sum.text, core.summaryText(nube));
    assert.match(sum.text, /Caja \$4\.5M/);
    const rem = await mock.get('reminders');
    assert.equal(rem.status, 200);
    assert.match(rem.headers['content-type'], /^text\/plain/);
    assert.equal(rem.text, '', 'sin nada que avisar, reminders debe responder texto vacío');
  });

  step('A4', 'registro rápido "compré ps5 1.2M nequi": formulario prellenado → guardar → saldos al instante → sube a la nube a los ~1,5 s', ['A3'], async () => {
    const f = await p1.quick('compré ps5 1.2M nequi');
    assert.match(f.title, /Compré/);
    assert.deepEqual({ desc: f.v.desc, buyPrice: f.v.buyPrice, buyPocket: f.v.buyPocket, cat: f.v.cat }, { desc: 'Ps5', buyPrice: '1.200.000', buyPocket: 'nequi', cat: 'Consolas' });
    await p1.shot('05-formulario-compra');
    const t0 = Date.now();
    const antes = mock.calls('sync').length;
    await p1.save();
    await p1.waitToast(/Ps5 en stock/);
    assert.equal(await p1.page.inputValue('[data-testid=quick-input]'), '', 'la barra de registro debe quedar vacía');
    assert.deepEqual(await p1.pocketChips(), { Efectivo: '$450.000', Nequi: '$2.800.000' });
    assert.equal((await p1.kpis())['Caja hoy'].sub, '$3.250.000');
    // sync por debounce (1,5 s después del cambio; no antes ni uno por tecla)
    await until(() => mock.db().items.some(i => i.desc === 'Ps5'), { msg: 'el Ps5 no llegó a la nube' });
    const sync = mock.calls('sync').slice(antes).find(c => c.t >= t0);
    assert.ok(sync, 'no hubo sync tras guardar');
    assert.ok(sync.t - t0 >= 1000 && sync.t - t0 < 5000, `el sync llegó a los ${sync.t - t0} ms (debería ser ~1500)`);
    assert.equal(mock.calls('sync').slice(antes).filter(c => c.t >= t0).length, 1, 'más de un sync por un solo cambio');
    const it = mock.db().items.find(i => i.desc === 'Ps5');
    assert.deepEqual({ buyPrice: it.buyPrice, buyPocket: it.buyPocket, cat: it.cat, status: it.status }, { buyPrice: 1200000, buyPocket: 'nequi', cat: 'Consolas', status: 'stock' });
    assert.ok(it.id && it.u > 1e12, 'el registro debe llevar id y u (ms epoch)');
    await p1.waitSync('Al día');
    await p1.tab('stock');
    assert.match(await p1.text(), /Ps5.*Consolas/);
    await p1.shot('06-stock');
  });

  step('A5', '"Probar captura" manda "Enviaste $1.000 a PRUEBA" al capture, sincroniza y aparece en Por clasificar', ['A4'], async () => {
    await p1.mas('ajustes');
    await p1.page.click('[data-testid=cfg-test]');
    await p1.waitToast(/Funciona/);
    const caps = mock.calls('capture');
    assert.equal(caps.length, 1);
    assert.deepEqual({ m: caps[0].method, b: caps[0].body, bolsillo: caps[0].query.bolsillo, key: caps[0].query.key }, { m: 'POST', b: 'Enviaste $1.000 a PRUEBA', bolsillo: 'nequi', key: mock.key });
    assert.match(caps[0].contentType, /^text\/plain/i);
    assert.deepEqual(JSON.parse(caps[0].response), { ok: true, added: true });
    await p1.page.waitForSelector('#v-inicio.on');
    const card = p1.page.locator('[data-testid=pend]', { hasText: 'PRUEBA' });
    await card.waitFor();
    const t = flat(await card.innerText());
    assert.match(t, /PRUEBA/);
    assert.match(t, /−\$1\.000/);
    assert.match(t, /Enviaste \$1\.000 a PRUEBA/, 'la tarjeta debe mostrar el texto crudo de la notificación');
    for (const b of ['Compra', 'Gasto negocio', 'Gasto personal', 'Retiro/mover', 'Préstamo', 'Ignorar']) assert.ok(t.includes(b), `falta el botón "${b}"`);
    assert.equal(flat(await p1.page.textContent('#pendBadge')), '1');
    await p1.shot('07-por-clasificar', { full: true });
  });

  step('A6', 'clasificar como Gasto negocio → crea el gasto, borra el pend y aprende la regla; el siguiente capture se clasifica en 1 toque', ['A5'], async () => {
    const card = p1.page.locator('[data-testid=pend]', { hasText: 'PRUEBA' });
    await card.locator('button[data-k=gastoN]').click();
    await p1.waitSheet(true);
    const f = await p1.form();
    assert.match(f.title, /Gasto del negocio/);
    assert.deepEqual({ valor: f.v.valor, tipo: f.v.tipo, desc: f.v.desc, bolsillo: f.v.bolsillo }, { valor: '1.000', tipo: 'negocio', desc: 'Prueba', bolsillo: 'nequi' });
    await p1.save();
    await p1.waitToast(/Prueba/);
    assert.equal(await card.count(), 0, 'la tarjeta debe desaparecer al clasificar');
    assert.ok(await p1.page.isHidden('#pendBadge'));
    const db = await p1.db();
    const g = db.gastos.find(x => x.desc === 'Prueba');
    assert.deepEqual({ valor: g.valor, tipo: g.tipo, bolsillo: g.bolsillo }, { valor: 1000, tipo: 'negocio', bolsillo: 'nequi' });
    assert.equal(db.pend.filter(p => !p.del).length, 0);
    assert.ok(db.pend.some(p => p.del === 1), 'el pend se marca borrado, no se elimina físicamente');
    const regla = db.reglas.find(r => r.id === 'prueba');
    assert.deepEqual({ kind: regla.kind, tipo: regla.tipo }, { kind: 'gasto', tipo: 'negocio' });
    await until(() => { const d = mock.db(); return d.gastos.some(x => x.desc === 'Prueba') && d.reglas.some(r => r.id === 'prueba') && d.pend.some(p => p.del === 1); }, { msg: 'el gasto, la regla o el borrado del pend no llegaron a la nube' });

    // 2.º capture del mismo remitente → "↻ Igual que antes"
    const r = await mock.capture('Enviaste $2.500 a PRUEBA');
    assert.deepEqual(r.json, { ok: true, added: true });
    await p1.syncNow();
    const card2 = p1.page.locator('[data-testid=pend]', { hasText: 'PRUEBA' });
    await card2.waitFor();
    const rb = card2.locator('button[data-a=pendRule]');
    assert.match(flat(await rb.innerText()), /Igual que antes: Gasto negocio/);
    await p1.shot('08-igual-que-antes');
    await rb.click();
    await p1.waitToast(/Gasto negocio/);
    assert.equal(await card2.count(), 0);
    assert.equal((await p1.db()).gastos.find(x => x.valor === 2500).tipo, 'negocio');
    assert.deepEqual(await p1.pocketChips(), { Efectivo: '$450.000', Nequi: '$2.796.500' });   // 4.000.000 − 1.200.000 − 1.000 − 2.500
  });

  step('A7', '"vendí ps5 1.5M efectivo": busca el producto en el stock, muestra la ganancia y mueve los saldos y la utilidad', ['A6'], async () => {
    const f = await p1.quick('vendí ps5 1.5M efectivo');
    assert.match(f.title, /Vendí/);
    const ps5 = (await p1.db()).items.find(i => i.desc === 'Ps5');
    assert.deepEqual({ itemId: f.v.itemId, sellPrice: f.v.sellPrice, sellPocket: f.v.sellPocket, completo: f.v.completo }, { itemId: ps5.id, sellPrice: '1.500.000', sellPocket: 'efectivo', completo: 'si' });
    await p1.shot('09-formulario-venta');
    await p1.save();
    await p1.waitToast(/Ganancia \$300\.000/);
    assert.deepEqual(await p1.pocketChips(), { Efectivo: '$1.950.000', Nequi: '$2.796.500' });
    const k = await p1.kpis();
    const neta = core.monthStats(await p1.db(), HOY.slice(0, 7)).neta;
    assert.equal(neta, 296500, 'utilidad = 1.500.000 − 1.200.000 − gastos de negocio (1.000 + 2.500)');
    assert.equal(k['Utilidad del mes'].val, core.fmt(neta));
    assert.match(k['Utilidad del mes'].sub, /1 venta/);
    assert.match(k['En stock'].sub, /0 productos/);
    await until(() => mock.db().items.find(i => i.desc === 'Ps5').status === 'sold', { msg: 'la venta no llegó a la nube' });
  });

  /* ═══════════════════════════ B · celular 2: misma nube, sin pedir saldos ═══════════════════════════ */

  step('B1', 'segundo celular: "Ya la uso en otro celular" → Ajustes → conecta → ve los mismos datos y saldos SIN pedir saldos iniciales', ['A7'], async () => {
    p2 = await new Phone(browser, mock, 'celular 2').init();
    await p2.open();
    assert.match(norm(await p2.page.innerText('[data-testid=onboarding]')), /primera vez o ya usas mi app en otro celular/);
    await p2.shot('10-celular2-bienvenida');
    await p2.page.click('[data-testid=onb-other]');
    await p2.page.waitForSelector('[data-mas=ajustes]:not([hidden])');
    assert.ok(await p2.page.isHidden('[data-testid=onboarding]'));
    await p2.page.fill('[data-testid=cfg-url]', mock.execUrl);
    await p2.page.fill('[data-testid=cfg-key]', mock.key);
    await p2.page.click('[data-testid=cfg-save]');
    await p2.waitToast(/Nube conectada y al día/);
    await p2.waitSync('Al día');

    // NUNCA se mostró el onboarding de saldos y la nube no se pisó
    assert.equal(await p2.page.evaluate(() => window.__saldosShown), false, 'se mostró "¿Cuánto tienes hoy?" en el celular que ya usa la nube');
    assert.ok(await p2.page.isHidden('[data-testid=onboarding]'));
    const nube = mock.db();
    assert.equal(nube.bolsillos.find(b => b.id === 'nequi').ini, 4000000, 'el celular 2 pisó el saldo inicial de la nube');
    assert.equal(nube.bolsillos.find(b => b.id === 'efectivo').ini, 450000);

    // mismos datos y mismos saldos que el celular 1
    const [d1, d2] = [await p1.db(), await p2.db()];
    assert.deepEqual(core.balances(d2), core.balances(d1));
    assert.deepEqual(core.balances(d2), { efectivo: 1950000, nequi: 2796500 });
    assert.equal(d2.bolsillos.find(b => b.id === 'nequi').ini, 4000000);
    await p2.tab('inicio');
    assert.deepEqual(await p2.pocketChips(), { Efectivo: '$1.950.000', Nequi: '$2.796.500' });
    assert.equal((await p2.kpis())['Caja hoy'].sub, '$4.746.500');
    await p2.tab('movs');
    const t = await p2.text();
    for (const x of ['Ps5', 'Prueba']) assert.ok(t.includes(x), `el celular 2 no ve "${x}" en Movimientos`);
    assert.equal((await p2.cfg()).onboarded, true);
    await p2.tab('inicio');
    await p2.shot('11-celular2-datos-de-la-nube', { full: true });
  });

  step('B2', 'un cambio en el celular 2 llega al celular 1 (y los saldos siguen iguales)', ['B1'], async () => {
    const f = await p2.quick('almuerzo 18 mil');
    assert.deepEqual({ valor: f.v.valor, cat: f.v.cat, tipo: f.v.tipo }, { valor: '18.000', cat: 'Comida', tipo: 'personal' });
    await p2.save();
    await until(() => mock.db().gastos.some(g => g.desc === 'Almuerzo'), { msg: 'el Almuerzo no llegó a la nube' });
    await p1.syncNow();
    const g = (await p1.db()).gastos.find(x => x.desc === 'Almuerzo');
    assert.ok(g && !g.del && g.valor === 18000, 'el celular 1 no recibió el Almuerzo');
    await p1.tab('inicio');
    assert.match(await p1.text(), /Almuerzo/);
    const bal = { efectivo: 1950000, nequi: 2778500 };
    assert.deepEqual(core.balances(await p1.db()), bal);
    assert.deepEqual(core.balances(await p2.db()), bal);
    assert.deepEqual(await p1.pocketChips(), { Efectivo: '$1.950.000', Nequi: '$2.778.500' });
    S.almuerzoId = g.id;
  });

  step('B3', 'borrar en un celular se refleja en el otro: borrado lógico (tombstone), nunca físico, y no resucita', ['B2'], async () => {
    await p1.tab('movs');
    const row = p1.page.locator('#movsBody button.row', { hasText: 'Almuerzo' });
    p1.dialogs.length = 0;
    await row.click();                                       // confirm() se acepta solo (Phone.dialogAnswer)
    assert.equal(p1.dialogs.length, 1);
    assert.match(p1.dialogs[0].message, /¿Eliminar este movimiento\?[\s\S]*Almuerzo/);
    await p1.waitToast(/Eliminado/);
    assert.ok(await p1.page.getByRole('button', { name: 'Deshacer' }).isVisible(), 'el toast debe ofrecer Deshacer');
    assert.equal(await row.count(), 0);
    await until(() => { const g = mock.db().gastos.find(x => x.id === S.almuerzoId); return g && g.del === 1; }, { msg: 'el borrado no llegó a la nube' });
    assert.ok(mock.db().gastos.some(x => x.id === S.almuerzoId), 'el servidor borró físicamente el registro');
    // el celular 2 lo recibe al volver a la app (visibilitychange)
    await p2.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await until(async () => { const g = (await p2.db()).gastos.find(x => x.id === S.almuerzoId); return g && g.del === 1; }, { msg: 'el celular 2 no recibió el borrado' });
    await p2.tab('movs');
    assert.equal(await p2.page.locator('#movsBody button.row', { hasText: 'Almuerzo' }).count(), 0);
    assert.deepEqual(core.balances(await p2.db()), { efectivo: 1950000, nequi: 2796500 });
    // otra ronda de syncs en los dos: sigue borrado en ambos y en la nube
    await p2.syncNow(); await p1.syncNow();
    for (const d of [await p1.db(), await p2.db(), mock.db()]) assert.equal(d.gastos.find(x => x.id === S.almuerzoId).del, 1, 'el Almuerzo resucitó');
    await p1.shot('12-movimientos-tras-borrar');
  });

  /* ═══════════════════════════ C · capture de Nequi (MacroDroid) y textos del servidor ═══════════════════════════ */

  step('C1', 'MacroDroid: POST capture con texto de Nequi (cualquier Content-Type) llega a la app como Por clasificar; sin monto/clave mala no entra', ['B3'], async () => {
    const key = mock.key;
    const r1 = await mock.capture('Recibiste $50.000 de JUAN PEREZ');
    assert.equal(r1.status, 200);
    assert.match(r1.headers['content-type'], /application\/json/);
    assert.equal(r1.headers['access-control-allow-origin'], '*');
    assert.deepEqual(r1.json, { ok: true, added: true });
    assert.deepEqual((await mock.capture('Recibiste $50.000 de JUAN PEREZ')).json, { ok: true, added: false }, 'el mismo texto en menos de 10 min no debe duplicarse');
    assert.deepEqual((await mock.capture('Pagaste $12.500 en RAPPI', { contentType: 'application/x-www-form-urlencoded' })).json, { ok: true, added: true });
    assert.deepEqual((await mock.capture('Le enviaste $30.000 a MARIA LOPEZ', { contentType: 'application/json' })).json, { ok: true, added: true });
    assert.deepEqual((await mock.callExec('GET', { action: 'capture', key, bolsillo: 'efectivo', text: 'Recibiste $20.000 de ANA GOMEZ' })).json, { ok: true, added: true }, 'capture por GET con ?text=');
    assert.deepEqual((await mock.capture('Tu saldo en Nequi es $1.234.567')).json, { ok: true, added: false }, 'un aviso de saldo no es un movimiento');
    assert.deepEqual((await mock.capture('Recibiste $1.000 de X', { k: 'clave-mala' })).json, { ok: false, error: 'Clave incorrecta' });
    const pend = mock.db().pend.filter(p => !p.del);
    assert.deepEqual(pend.map(p => [p.quien, p.monto, p.dir, p.bolsillo]).sort(), [
      ['ANA GOMEZ', 20000, 'in', 'efectivo'], ['JUAN PEREZ', 50000, 'in', 'nequi'], ['MARIA LOPEZ', 30000, 'out', 'nequi'], ['RAPPI', 12500, 'out', 'nequi']]);

    await p1.syncNow();
    await p1.tab('inicio');
    assert.equal(flat(await p1.page.textContent('#pendBadge')), '4');
    await p1.page.click('[data-a=pendAll]');
    const juan = p1.page.locator('[data-testid=pend]', { hasText: 'JUAN PEREZ' });
    await juan.waitFor();
    const t = flat(await juan.innerText());
    assert.match(t, /\+\$50\.000/);
    assert.match(t, /Recibiste \$50\.000 de JUAN PEREZ/);
    for (const b of ['Venta', 'Abono', 'Ingreso', 'Mover', 'Ignorar']) assert.ok(t.includes(b), `falta el botón "${b}" en un movimiento que entra`);
    assert.ok(!t.includes('Gasto negocio'), 'un movimiento que entra no debe ofrecer Gasto negocio');
    assert.match(flat(await p1.page.locator('[data-testid=pend]', { hasText: 'ANA GOMEZ' }).innerText()), /Efectivo/);
    await p1.shot('13-por-clasificar-nequi', { full: true });

    // clasificar JUAN como Ingreso y ignorar RAPPI
    await juan.locator('button[data-k=ingreso]').click();
    await p1.waitSheet(true);
    const f = await p1.form();
    assert.deepEqual({ desc: f.v.desc, valor: f.v.valor, bolsillo: f.v.bolsillo }, { desc: 'Juan Perez', valor: '50.000', bolsillo: 'nequi' });
    await p1.save();
    await p1.waitToast(/Juan Perez/);
    await p1.page.locator('[data-testid=pend]', { hasText: 'RAPPI' }).locator('button[data-a=pendIgnore]').click();
    await p1.waitToast(/Ignorado/);
    assert.equal(flat(await p1.page.textContent('#pendBadge')), '2');
    assert.deepEqual(core.balances(await p1.db()), { efectivo: 1950000, nequi: 2846500 });
  });

  step('C2', 'GET summary y reminders devuelven texto plano con CORS; un cobro vencido aparece en reminders y en Inicio', ['C1'], async () => {
    // cobro con compromiso vencido, creado desde la app
    await p1.tab('cobros');
    await p1.page.click('[data-testid=cobro-nuevo]');
    await p1.waitSheet(true);
    await p1.setField('nombre', 'camilo ruiz');
    await p1.setField('total', '80.000');
    await p1.setField('compromiso', AYER);
    await p1.setField('notas', 'por los audífonos');
    await p1.shot('14-formulario-cobro');
    await p1.save();
    await p1.waitToast(/Camilo Ruiz te debe \$80\.000/);
    await until(() => mock.db().cobros.some(c => c.nombre === 'Camilo Ruiz'), { msg: 'el cobro no llegó a la nube' });
    assert.match(await p1.text(), /Camilo Ruiz.*vencido/);
    await p1.shot('15-cobros');

    const rem = await mock.get('reminders');
    assert.equal(rem.status, 200);
    assert.match(rem.headers['content-type'], /^text\/plain/);
    assert.equal(rem.headers['access-control-allow-origin'], '*');
    assert.equal(rem.text, core.remindersText(mock.db()));
    assert.match(rem.text, /Camilo Ruiz debía pagarte el .*\$80K/);
    assert.match(rem.text, /2 movimientos por clasificar/);
    const sum = await mock.get('summary');
    assert.equal(sum.text, core.summaryText(mock.db()));
    assert.match(sum.text, /1 venta por \$1\.5M/);
    assert.match(sum.text, /Te deben \$80K: Camilo \$80K/);
    assert.match(sum.text, /2 movimientos por clasificar/);
    // errores en texto plano (summary/reminders) y en JSON (ping)
    const mala = await mock.callExec('GET', { action: 'summary', key: 'mala' });
    assert.equal(mala.text, 'Clave incorrecta');
    assert.match(mala.headers['content-type'], /^text\/plain/);
    assert.deepEqual((await mock.callExec('GET', { action: 'ping', key: 'mala' })).json, { ok: false, error: 'Clave incorrecta' });
    // el mismo cobro vencido en Inicio, con WhatsApp
    await p1.tab('inicio');
    const alerta = p1.page.locator('.alert', { hasText: 'Camilo Ruiz' });
    assert.match(flat(await alerta.innerText()), /vencido/);
    assert.ok(await alerta.locator('button[data-a=wa]').isVisible());
  });

  /* ═══════════════════════════ D · sin señal: service worker + cola ═══════════════════════════ */

  step('D1', 'sin red: recargar abre la app desde el service worker (con Chart.js de caché) y permite registrar sin tocar la nube', ['C2'], async () => {
    await p1.syncNow();                                       // nada pendiente al cortar la red
    await p1.page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await p1.ctx.setOffline(true);
    const antes = mock.calls().length;
    const RED = /ERR_INTERNET_DISCONNECTED|ERR_FAILED|Failed to load resource/;
    const resp = await p1.tolerating(RED, () => p1.reload());
    assert.ok(resp.fromServiceWorker(), 'la recarga sin red no salió del service worker');
    assert.equal(resp.status(), 200);
    assert.equal(await p1.syncLabel(), 'Sin señal');
    assert.equal(await p1.page.evaluate(() => typeof Chart), 'function', 'Chart.js no se sirvió desde la caché del service worker');
    assert.match(await p1.text(), /Camilo Ruiz/, 'los datos locales no se ven sin red');
    // registrar sin red
    const f = await p1.quick('taxi 8 mil efectivo');
    assert.deepEqual({ valor: f.v.valor, bolsillo: f.v.bolsillo, cat: f.v.cat }, { valor: '8.000', bolsillo: 'efectivo', cat: 'Transporte' });
    await p1.save();
    await p1.waitToast(/Taxi/);
    assert.ok((await p1.db()).gastos.some(g => g.desc === 'Taxi' && g.valor === 8000), 'no se guardó local sin red');
    assert.deepEqual(await p1.pocketChips(), { Efectivo: '$1.942.000', Nequi: '$2.846.500' });
    await p1.page.waitForTimeout(2500);                       // pasa el debounce de 1,5 s
    assert.equal(mock.calls().length, antes, 'la app intentó hablar con la nube estando sin señal');
    assert.equal(await p1.syncLabel(), 'Sin señal');
    await p1.shot('16-sin-senal');
  });

  step('D2', 'al volver la red se sincroniza solo (evento online) y lo registrado sin señal llega a la nube y al otro celular', ['D1'], async () => {
    await p1.ctx.setOffline(false);
    await until(() => mock.db().gastos.some(g => g.desc === 'Taxi'), { timeout: 10000, msg: 'el Taxi no se sincronizó al volver la red' });
    await p1.waitSync('Al día');
    await p2.syncNow();
    assert.ok((await p2.db()).gastos.some(g => g.desc === 'Taxi' && !g.del), 'el celular 2 no recibió el Taxi');
    assert.deepEqual(core.balances(await p2.db()), core.balances(await p1.db()));
  });

  /* ═══════════════════════════ E · el servidor falla ═══════════════════════════ */

  /** deja los dos celulares en un estado limpio (formulario cerrado, en Inicio, red encendida) por si un paso anterior falló a medias */
  const limpiar = async () => {
    for (const p of [p1, p2]) {
      if (!p) continue;
      await p.ctx.setOffline(false);
      if (await p.sheetOpen().catch(() => false)) await p.page.keyboard.press('Escape');
      await p.page.waitForFunction(() => !document.querySelector('#sheet').classList.contains('on')).catch(() => {});
    }
  };
  const lleno = async p => JSON.stringify((await p.db()).gastos.map(g => g.id).sort());

  step('E1', 'Apps Script lanza una excepción (devuelve HTML de error): indicador "Error", datos intactos y se recupera', ['D2'], async () => {
    const antes = await lleno(p1);
    mock.failNext(1, 'html');
    await p1.page.click('#syncBtn');
    await p1.waitSync('Error');
    await p1.waitToast(/algo raro/);
    assert.equal(await lleno(p1), antes, 'se perdieron datos locales');
    await p1.shot('17-error-de-nube');
    await p1.syncNow();
  });
  step('E2', 'servidor ocupado ("Ocupado, reintenta") y corte de red se muestran con mensaje claro y se recuperan', ['E1'], async () => {
    mock.failNext(1, 'busy');
    await p1.page.click('#syncBtn');
    await p1.waitSync('Error');
    await p1.waitToast(/Ocupado, reintenta/);
    await p1.syncNow();
    await p1.tolerating(/ERR_EMPTY_RESPONSE|ERR_FAILED|ERR_CONNECTION|Failed to load resource/, async () => {
      mock.failNext(4, 'network');                          // Chrome reintenta solo algunos POST cortados: varios fallos seguidos
      await p1.page.click('#syncBtn');
      await p1.waitSync('Error');
      await p1.waitToast(/No pude conectar con la nube/);
      mock.clearFail();
      await p1.syncNow();
      mock.failNext(4, 'http500');
      await p1.page.click('#syncBtn');
      await p1.waitSync('Error');
      await p1.waitToast(/error 500/);
      mock.clearFail();
    });
    await p1.syncNow();
  });
  step('E3', 'clave mala en Ajustes → "Clave incorrecta", datos locales intactos; con la clave buena vuelve a conectar', ['E2'], async () => {
    const antes = await lleno(p1);
    await p1.mas('ajustes');
    await p1.page.fill('[data-testid=cfg-key]', 'clave-mala');
    await p1.page.click('[data-testid=cfg-save]');
    await p1.waitToast(/Clave incorrecta/);
    await p1.waitSync('Error');
    assert.equal(await lleno(p1), antes);
    await p1.page.fill('[data-testid=cfg-key]', mock.key);
    await p1.page.click('[data-testid=cfg-save]');
    await p1.waitToast(/Nube conectada y al día/);
    await p1.waitSync('Al día');
    // URL /dev (de prueba) y URL sin https se rechazan sin llamar a la nube
    const n = mock.calls().length;
    await p1.page.fill('[data-testid=cfg-url]', mock.execUrl.replace(/\/exec$/, '/dev'));
    await p1.page.click('[data-testid=cfg-save]');
    await p1.waitToast(/\/dev/);
    await p1.page.fill('[data-testid=cfg-url]', 'http://script.google.com/macros/s/X/exec');
    await p1.page.click('[data-testid=cfg-save]');
    await p1.waitToast(/https/);
    assert.equal(mock.calls().length, n);
    await p1.page.fill('[data-testid=cfg-url]', mock.execUrl);
    await p1.page.click('[data-testid=cfg-save]');
    await p1.waitToast(/Nube conectada y al día/);
  });

  step('E4', 'cambio durante un sync en curso (servidor lento): no se pierde, no hay dos sync a la vez y se sube enseguida', ['E3'], async () => {
    await limpiar();
    await p1.tab('inicio');
    mock.setDelay(1800);
    try {
      const antes = mock.calls('sync').length;
      await p1.page.click('#syncBtn');
      await p1.waitSync('Sincronizando…');
      await p1.page.click('#syncBtn');                       // toques repetidos mientras sincroniza: no deben abrir otro sync en paralelo
      const f = await p1.quick('café 2 mil nequi');          // el usuario registra algo con el sync a medias
      await p1.save();
      await p1.waitSync('Al día');
      assert.ok((await p1.db()).gastos.some(g => g.valor === 2000 && g.desc === 'Café'), 'el registro hecho durante el sync se perdió al llegar la respuesta');
      await until(() => mock.db().gastos.some(g => g.valor === 2000 && g.desc === 'Café'), { timeout: 15000, msg: 'el registro hecho durante el sync no llegó a la nube' });
      const nuevos = mock.calls('sync').slice(antes);
      assert.ok(nuevos.length >= 2, 'tras un cambio durante el sync debe reprogramarse otro');
      assert.equal(JSON.parse(nuevos[0].body).db.gastos.some(g => g.valor === 2000 && g.desc === 'Café'), false);
      assert.equal(JSON.parse(nuevos.at(-1).body).db.gastos.some(g => g.valor === 2000 && g.desc === 'Café'), true);
      assert.equal(mock.stats.maxConcurrentSync, 1, 'hubo dos sync en vuelo a la vez (sin solapamiento, SPEC §6.5)');
    } finally { mock.setDelay(0); }
    await p1.syncNow();
  });

  /* ═══════════════════════════ F · seguridad y respaldo ═══════════════════════════ */

  step('F1', 'texto con HTML, comillas, emojis y "=" viaja por la nube sin ejecutarse ni dañarse (y la hoja legible lo escapa)', ['E4'], async () => {
    const raro = 'Café ☕ & "pan" 🍞 <b>x</b> <img src=x onerror="window.__pwned=1">';
    const formula = '=HYPERLINK("http://malo.example","clic")';
    for (const desc of [raro, formula]) {
      await p2.quick('almuerzo 9 mil');
      await p2.setField('desc', desc);
      await p2.save();
    }
    await until(() => { const g = mock.db().gastos.map(x => x.desc); return g.includes(raro) && g.includes(formula); }, { msg: 'los gastos con texto raro no llegaron a la nube' });
    // el _db guarda el texto tal cual; la hoja legible antepone ' a lo que empieza con = + - @ (no se ejecuta como fórmula)
    const filas = mock.env.sheet('Gastos').rows().flat().map(String);
    assert.ok(filas.some(c => c === "'" + formula), `la hoja Gastos no escapó la fórmula: ${JSON.stringify(filas.filter(c => /HYPERLINK/.test(c)))}`);
    assert.ok(!filas.some(c => c === formula), 'la hoja Gastos contiene una fórmula sin escapar');
    await mock.capture('<img src=x onerror="window.__pwned=1"> Enviaste $7.000 a MIRA');
    await p1.syncNow();
    await p1.tab('movs');
    const t = await p1.text();
    assert.ok(t.includes('<b>x</b>') && t.includes('Café ☕ & "pan" 🍞'), 'el texto raro no se ve literal en el celular 1');
    assert.equal(await p1.page.evaluate(() => window.__pwned), undefined, 'se ejecutó HTML inyectado');
    assert.equal(await p1.page.locator('img[src=x]').count(), 0, 'se inyectó un <img> desde el texto del usuario');
    const g1 = (await p1.db()).gastos.map(x => x.desc);
    assert.ok(g1.includes(raro) && g1.includes(formula), 'el texto cambió en el viaje (emojis partidos, comillas…)');
    await p1.tab('inicio');
    assert.ok((await p1.text()).includes('<img src=x onerror="window.__pwned=1"> Enviaste $7.000 a MIRA'), 'el texto crudo del capture no se muestra literal');
    assert.equal(await p1.page.evaluate(() => window.__pwned), undefined);
    assert.equal(await p1.page.locator('img[src=x]').count(), 0);
  });

  step('F2', 'respaldo: Exportar descarga miapp_AAAAMMDD.json con todo y Importar UNE (no reemplaza)', ['F1'], async () => {
    await p1.mas('ajustes');
    const [dl] = await Promise.all([p1.page.waitForEvent('download'), p1.page.click('[data-testid=bk-export]')]);
    assert.equal(dl.suggestedFilename(), `miapp_${HOY.replace(/-/g, '')}.json`);
    const buf = fs.readFileSync(await dl.path(), 'utf8');
    const exp = JSON.parse(buf);
    const db = await p1.db();
    assert.deepEqual(exp.gastos.map(g => g.id).sort(), db.gastos.map(g => g.id).sort());
    assert.equal(exp.items.length, db.items.length);
    // importar un respaldo con un gasto nuevo y uno viejo con otro valor (más viejo: no debe ganar)
    const viejo = Object.assign({}, db.gastos.find(g => g.desc === 'Prueba'), { valor: 1, u: 5 });
    const nuevo = { id: 'imp1', desc: 'Importado', valor: 4000, cat: 'Otro', tipo: 'personal', bolsillo: 'efectivo', fecha: HOY, u: Date.now() };
    await p1.page.setInputFiles('[data-testid=bk-file]', { name: 'respaldo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(Object.assign(core.emptyDB(), { gastos: [viejo, nuevo] }))) });
    await p1.waitToast(/Importado/);
    const db2 = await p1.db();
    assert.ok(db2.gastos.some(g => g.id === 'imp1'), 'no importó el gasto nuevo');
    assert.equal(db2.gastos.find(g => g.id === viejo.id).valor, 1000, 'el import pisó un registro más reciente');
    assert.equal(db2.gastos.length, db.gastos.length + 1, 'importar no debe borrar ni duplicar');
    await until(() => mock.db().gastos.some(g => g.id === 'imp1'), { msg: 'lo importado no subió a la nube' });
    // basura: avisa y no rompe
    await p1.page.setInputFiles('[data-testid=bk-file]', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('esto no es json') });
    await p1.waitToast(/no es un respaldo válido/);
  });

  step('F3', 'atajos del manifest: ?v=cobros abre Cobros y ?voz=1 abre el micrófono; la URL queda limpia', ['F2'], async () => {
    await p1.open('?v=cobros');
    assert.ok(await p1.page.isVisible('#v-movs.on'), '?v=cobros no abrió Plata');
    assert.ok(await p1.page.isVisible('#plataDeben'), '?v=cobros no abrió Te deben');
    assert.equal(new URL(p1.page.url()).search, '', 'la URL debe limpiarse tras leer el atajo');
    await p1.open('?voz=1');
    await p1.page.waitForSelector('[data-testid="voz-mic"]', {state: 'visible'});   // ronda 7: abre la hoja "¿Qué hiciste?" con el micrófono grande
    await p1.page.click('[data-a="vozLuego"]');
    assert.ok(await p1.page.isVisible('#v-inicio.on'));
    assert.equal(new URL(p1.page.url()).search, '');
    // (el Chromium sin cabeza no emite ningún evento de dictado: lo de abajo se prueba con un reconocedor simulado en F4)
  });

  step('F4', 'dictado con un reconocedor simulado (es-CO): lo dicho abre el formulario prellenado; si falla avisa del micrófono del teclado', ['F3'], async () => {
    await p1.ctx.addInitScript(() => {
      // webkitSpeechRecognition falso con la semántica real: start() → onstart; el test llama __speech.say()/fail()
      window.__speech = { last: null, starts: 0 };
      class FakeSR {
        constructor() { this.lang = ''; window.__speech.last = this; }
        start() { window.__speech.starts++; this._on = true; setTimeout(() => this.onstart && this.onstart({}), 0); }
        stop() { this._end(); }
        abort() { this._end(); }
        _end() { if (this._on) { this._on = false; this.onend && this.onend({}); } }
      }
      window.__speech.say = t => { const r = window.__speech.last; r.onresult && r.onresult({ resultIndex: 0, results: [[{ transcript: t, confidence: .9 }]] }); r._end(); };
      window.__speech.fail = e => { const r = window.__speech.last; r.onerror && r.onerror({ error: e }); r._end(); };
      window.webkitSpeechRecognition = FakeSR; window.SpeechRecognition = FakeSR;
    });
    await p1.open();
    await p1.tab('inicio');
    await p1.page.click('[data-testid=quick-mic]');
    await p1.page.waitForFunction(() => document.querySelector('#qMic').classList.contains('rec'));
    assert.equal(await p1.page.evaluate(() => window.__speech.last.lang), 'es-CO');
    assert.match(await p1.page.getAttribute('#qInput', 'placeholder'), /Te escucho/);
    await p1.page.evaluate(() => window.__speech.say('gasté 12 mil en taxi'));
    await p1.waitSheet(true);
    const f = await p1.form();
    assert.equal(await p1.page.inputValue('[data-testid=quick-input]'), 'gasté 12 mil en taxi');
    assert.deepEqual({ valor: f.v.valor, cat: f.v.cat }, { valor: '12.000', cat: 'Transporte' });
    await p1.shot('18-dictado');
    await p1.page.click('[data-testid=form-cancel]');
    await p1.waitSheet(false);
    assert.equal(await p1.page.evaluate(() => document.querySelector('#qMic').classList.contains('rec')), false);
    // falla el reconocimiento (sin permiso / sin internet) → toast con la salida de Gboard
    await p1.page.click('[data-testid=quick-mic]');
    await p1.page.waitForFunction(() => document.querySelector('#qMic').classList.contains('rec'));
    await p1.page.evaluate(() => window.__speech.fail('not-allowed'));
    await p1.waitToast(/micrófono del teclado \(Gboard\)/);
    // sin internet el dictado no arranca (§10.5): directo al aviso de Gboard, sin llamar al reconocedor
    await p1.ctx.setOffline(true);
    const starts = await p1.page.evaluate(() => window.__speech.starts);
    await p1.page.click('[data-testid=quick-mic]');
    await p1.waitToast(/Gboard/);
    assert.equal(await p1.page.evaluate(() => window.__speech.starts), starts, 'intentó dictar sin internet');
    await p1.ctx.setOffline(false);
    await p1.waitSync('Al día');
  });

  /* ═══════════════════════════ H · flujos largos: fechas de noche, fiado, bolsillos, conflictos, volumen ═══════════════════════════ */

  step('H1', 'a las 10:30 p. m. de Colombia (ya es mañana en UTC) la app sigue en el día y el mes LOCALES (también el 31 a las 10:30 p. m.)', ['A1'], async () => {
    const casos = [['2026-10-06T03:30:00Z', '2026-10-05', 'lun 5 oct', '05/10/26'], ['2026-11-01T03:30:00Z', '2026-10-31', 'sáb 31 oct', '31/10/26']];
    for (const [iso, fecha, cabecera, fd] of casos) {
      const p = await new Phone(browser, mock, 'celular 4 (22:30)').init();
      try {
        await p.page.clock.setFixedTime(new Date(iso));
        await p.open();
        await p.page.click('[data-testid=onb-first]');
        await p.page.click('[data-testid=onb-save]');                          // sin saldos
        await p.page.waitForSelector('[data-testid=onboarding]', { state: 'hidden' });
        assert.match(await p.page.textContent('#hdrDate'), new RegExp(cabecera), `el encabezado no está en el día local (${iso})`);
        const f = await p.quick('cena 30 mil');
        assert.equal(f.v.fecha, fecha, `el formulario propone ${f.v.fecha} y hoy en Colombia es ${fecha}`);
        await p.save();
        await p.tab('movs');
        assert.match(await p.page.textContent('#mvMonth'), /octubre 2026/, 'el mes visible debe ser el local');
        // el historial agrupa por día: el gasto de hoy va bajo el encabezado "Hoy" (fecha local, no la de UTC)
        assert.match(await p.page.innerText('#v-movs'), /Hoy[\s\S]*Cena/i, 'el gasto de la noche no aparece bajo el día local');
        p.assertClean();
      } finally { await p.close(); }
    }
  });

  step('H2', 'venta a crédito (fiado): crea el cobro solo, WhatsApp con el mensaje y número 57…, abonos hasta "¡Saldado!", y borrar el cobro borra sus abonos en los dos celulares', ['F4'], async () => {
    await limpiar();
    const B0 = core.balances(await p1.db());
    await p1.ctx.route('https://wa.me/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>wa.me simulado</h1>' }));
    // compra de un producto y venta fiada
    let f = await p1.quick('compré tenis jordan 180k efectivo');
    assert.deepEqual({ desc: f.v.desc, cat: f.v.cat, buyPocket: f.v.buyPocket }, { desc: 'Tenis jordan', cat: 'Calzado', buyPocket: 'efectivo' });
    await p1.save();
    f = await p1.quick('vendí tenis jordan 250k');
    const tenis = (await p1.db()).items.find(i => i.desc === 'Tenis jordan');
    assert.equal(f.v.itemId, tenis.id);
    await p1.setField('completo', 'no');
    await p1.page.waitForSelector('#f-cliente', { state: 'visible' });
    await p1.setField('sellPaid', '100.000');
    await p1.setField('cliente', 'juan perez');
    await p1.setField('tel', '300 123 4567');
    await p1.setField('compromiso', HOY);
    await p1.shot('19-venta-a-credito');
    await p1.save();
    await p1.waitToast(/Juan Perez te debe \$150\.000/);
    let db = await p1.db();
    const cobro = db.cobros.find(c => c.nombre === 'Juan Perez');
    assert.deepEqual({ total: cobro.total, pagado: cobro.pagado, bolsillo: cobro.bolsillo, itemId: cobro.itemId, compromiso: cobro.compromiso }, { total: 150000, pagado: 0, bolsillo: '', itemId: tenis.id, compromiso: HOY });
    assert.deepEqual(core.balances(db), { efectivo: B0.efectivo - 180000, nequi: B0.nequi + 100000 }, 'solo lo pagado (100.000) entra al bolsillo; el resto es cobro');
    // WhatsApp desde Cobros
    await p1.tab('cobros');
    const card = p1.page.locator('#cobrosBody [data-testid=cobro]', { hasText: 'Juan Perez' });
    assert.match(flat(await card.innerText()), /hoy/);
    const [wa] = await Promise.all([p1.ctx.waitForEvent('page'), card.locator('button[data-a=wa]').click()]);
    const u = new URL(wa.url());
    assert.equal(u.origin + u.pathname, 'https://wa.me/573001234567');
    assert.equal(u.searchParams.get('text'), 'Hola Juan Perez, ¿cómo vas? Te escribo por el saldo pendiente de $150.000 (Venta: Tenis jordan). ¿Cuándo me podrías abonar? 🙏');
    await wa.close();
    // abonos por registro rápido
    f = await p1.quick('juan abonó 50k nequi');
    assert.deepEqual({ cobroId: f.v.cobroId, monto: f.v.monto, bolsillo: f.v.bolsillo }, { cobroId: cobro.id, monto: '50.000', bolsillo: 'nequi' });
    await p1.save();
    await p1.waitToast(/Abono de \$50\.000 · Juan Perez debe \$100\.000/);
    f = await p1.quick('juan perez abonó 100k efectivo');
    assert.equal(f.v.cobroId, cobro.id);
    await p1.save();
    await p1.waitToast(/¡Saldado!/);
    assert.equal(core.cobrosPend(await p1.db()).some(c => c.id === cobro.id), false);
    assert.deepEqual(core.balances(await p1.db()), { efectivo: B0.efectivo - 180000 + 100000, nequi: B0.nequi + 150000 });
    await p1.tab('cobros');
    assert.match(flat(await p1.page.innerText('#cobrosBody')), /saldados[\s\S]*juan perez[\s\S]*saldado/i);
    await p1.shot('29-cobro-saldado');
    // el otro celular lo ve igual
    await until(() => mock.db().abonos.filter(a => a.cobroId === cobro.id).length === 2, { msg: 'los abonos no llegaron a la nube' });
    await p2.syncNow();
    assert.deepEqual(core.balances(await p2.db()), core.balances(await p1.db()));
    // borrar el cobro saldado: sus abonos se borran en cascada, aquí y en el otro celular
    await p1.page.locator('#cobrosBody [data-testid=cobro]', { hasText: 'Juan Perez' }).locator('button[data-a=delCobro]').click();
    await p1.waitToast(/Cobro eliminado/);
    db = await p1.db();
    assert.equal(db.abonos.filter(a => a.cobroId === cobro.id && !a.del).length, 0, 'quedaron abonos huérfanos al borrar el cobro');
    assert.equal(db.abonos.filter(a => a.cobroId === cobro.id).length, 2, 'los abonos deben quedar como tombstones, no desaparecer');
    assert.deepEqual(core.balances(db), { efectivo: B0.efectivo - 180000, nequi: B0.nequi + 100000 }, 'al borrar el cobro se deben revertir sus abonos');
    await until(() => mock.db().cobros.find(c => c.id === cobro.id).del === 1 && mock.db().abonos.filter(a => a.cobroId === cobro.id && a.del).length === 2, { msg: 'el borrado en cascada no llegó a la nube' });
    await p2.syncNow();
    const d2 = await p2.db();
    assert.equal(d2.abonos.filter(a => a.cobroId === cobro.id && !a.del).length, 0);
    assert.deepEqual(core.balances(d2), core.balances(db));
  });

  /* ronda 4b: el segmento "Bolsillos" de Más pasó a ser "Dinero" (vista ¿Dónde está?, que conserva #bolBody) */
  step('H3', 'bolsillos: crear, mover plata entre ellos (registro rápido), ajustar saldo, renombrar y borrar solo si no tiene movimientos; todo llega al otro celular', ['F4'], async () => {
    await limpiar();
    await p1.mas('dinero');
    await p1.page.click('#bolBody [data-a=nuevoBolsillo]');
    await p1.waitSheet(true);
    await p1.setField('nombre', 'Bancolombia');
    await p1.setField('ini', '100.000');
    await p1.save();
    await p1.waitToast(/Bancolombia creado/);
    const B = () => p1.db().then(core.balances);
    const antes = await B();
    assert.equal(antes.bancolombia, 100000);
    // mover 50k de Nequi a Bancolombia por frase
    const f = await p1.quick('moví 50k de nequi a bancolombia');
    assert.deepEqual({ from: f.v.from, to: f.v.to, monto: f.v.monto }, { from: 'nequi', to: 'bancolombia', monto: '50.000' });
    await p1.save();
    await p1.waitToast(/Nequi → Bancolombia/);
    const desp = await B();
    assert.deepEqual(desp, { efectivo: antes.efectivo, nequi: antes.nequi - 50000, bancolombia: 150000 });
    // ajustar Nequi al saldo real
    await p1.mas('dinero');
    await p1.page.click('#bolBody [data-testid=bolsillo][data-id=nequi] [data-a=ajustar]');
    await p1.waitSheet(true);
    assert.match((await p1.form()).title, /Ajustar Nequi/);
    await p1.setField('real', '2.000.000');
    await p1.save();
    await p1.waitToast(/Nequi ajustado/);
    assert.equal((await B()).nequi, 2000000);
    assert.ok((await p1.db()).ajustes.some(a => a.bolsillo === 'nequi' && a.nota === 'Cuadre Nequi'));
    // bolsillo sin movimientos: se puede renombrar y borrar; con movimientos NO hay botón de borrar
    await p1.mas('dinero');
    await p1.page.click('#bolBody [data-a=nuevoBolsillo]');
    await p1.waitSheet(true);
    await p1.setField('nombre', 'Ahorros');
    await p1.save();
    await p1.mas('dinero');
    assert.equal(await p1.page.locator('#bolBody [data-testid=bolsillo][data-id=efectivo] [data-a=delBolsillo]').count(), 0, 'Efectivo tiene movimientos: no se debe poder borrar');
    assert.equal(await p1.page.locator('#bolBody [data-testid=bolsillo][data-id=bancolombia] [data-a=delBolsillo]').count(), 0, 'Bancolombia tiene movimientos: no se debe poder borrar');
    await p1.page.click('#bolBody [data-testid=bolsillo][data-id=ahorros] [data-a=renombrar]');
    await p1.waitSheet(true);
    await p1.setField('nombre', 'Ahorros Casa');
    await p1.save();
    await p1.waitToast(/Ahora se llama Ahorros Casa/);
    await p1.shot('30-bolsillos');
    await until(() => mock.db().bolsillos.some(b => b.id === 'ahorros' && b.nombre === 'Ahorros Casa'), { msg: 'el bolsillo nuevo no llegó a la nube' });
    await p2.syncNow();
    await p2.tab('inicio');
    assert.deepEqual(Object.keys(await p2.pocketChips()).sort(), ['Ahorros Casa', 'Bancolombia', 'Efectivo', 'Nequi']);
    assert.deepEqual(core.balances(await p2.db()), core.balances(await p1.db()));
    // borrar el vacío
    await p1.mas('dinero');
    await p1.page.click('#bolBody [data-testid=bolsillo][data-id=ahorros] [data-a=delBolsillo]');
    await p1.waitToast(/Ahorros Casa eliminado/);
    await until(() => mock.db().bolsillos.find(b => b.id === 'ahorros').del === 1, { msg: 'el borrado del bolsillo no llegó a la nube' });
    await p2.syncNow();
    await p2.tab('inicio');
    assert.deepEqual(Object.keys(await p2.pocketChips()).sort(), ['Bancolombia', 'Efectivo', 'Nequi']);
  });

  step('H4', 'edición simultánea sin red en los dos celulares: gana el cambio más reciente, los cambios distintos se suman y todo converge', ['F4'], async () => {
    await limpiar();
    let f = await p1.quick('compré audifonos 50k efectivo');
    await p1.save();
    await p1.syncNow(); await p2.syncNow();
    assert.ok((await p2.db()).items.some(i => i.desc === 'Audifonos'));
    await Promise.all([p1.ctx.setOffline(true), p2.ctx.setOffline(true)]);
    await Promise.all([p1.waitSync('Sin señal'), p2.waitSync('Sin señal')]);
    const editar = async (p, desc, frase) => {
      await p.tab('stock');
      await p.page.locator('#stockBody [data-testid=item]', { hasText: 'Audifonos' }).locator('button[data-a=editItem]').click();
      await p.waitSheet(true);
      await p.setField('desc', desc);
      await p.save();
      await p.quick(frase);
      await p.save();
    };
    await editar(p1, 'Audifonos P1', 'tinto 3 mil');
    await p1.page.waitForTimeout(40);
    await editar(p2, 'Audifonos P2', 'parqueadero 4 mil');
    await Promise.all([p1.ctx.setOffline(false), p2.ctx.setOffline(false)]);
    await Promise.all([p1.waitSync('Al día'), p2.waitSync('Al día')]);
    await p1.syncNow(); await p2.syncNow(); await p1.syncNow();
    for (const [nombre, d] of [['celular 1', await p1.db()], ['celular 2', await p2.db()], ['nube', mock.db()]]) {
      assert.deepEqual(d.items.filter(i => /^Audifonos/.test(i.desc) && !i.del).map(i => i.desc), ['Audifonos P2'], `${nombre}: debía quedar la edición más reciente (celular 2)`);
      for (const x of ['Tinto', 'Parqueadero']) assert.equal(d.gastos.filter(g => g.desc === x && !g.del).length, 1, `${nombre}: falta o se duplicó "${x}"`);
    }
    assert.deepEqual(core.balances(await p1.db()), core.balances(await p2.db()));
  });

  step('H5', 'el formulario se cierra con el botón Atrás de Android (popstate), con Escape y tocando fuera; la app no se sale', ['F4'], async () => {
    await limpiar();
    await p1.open();
    await p1.tab('inicio');
    for (const como of ['atras', 'escape', 'fuera']) {
      await p1.page.click('[data-testid=act-gasto]');
      await p1.waitSheet(true);
      if (como === 'atras') await p1.page.goBack(); else if (como === 'escape') await p1.page.keyboard.press('Escape'); else await p1.page.mouse.click(195, 8);
      await p1.waitSheet(false);
      assert.equal(new URL(p1.page.url()).pathname, '/miapp/', `con "${como}" la app salió de la página`);
      assert.ok(await p1.page.isVisible('#v-inicio.on'));
    }
    // sin cambios guardados: nada nuevo en los gastos
    p1.assertClean();
  });

  step('H6', 'volumen: una base de ~900 registros (≈200 KB, varios trozos en la hoja _db) sube completa y un celular nuevo la baja entera y rápido', ['A1'], async () => {
    const gen = () => {
      const db = core.emptyDB();
      db.bolsillos = [{ id: 'efectivo', nombre: 'Efectivo', ini: 500000, u: 1700000000000 }, { id: 'nequi', nombre: 'Nequi', ini: 2000000, u: 1700000000000 }];
      for (let i = 0; i < 700; i++) db.gastos.push({ id: 'g' + i, desc: `Gasto número ${i} ${'detalle '.repeat(6)}`, valor: 1000 + i * 13, cat: i % 4 ? 'Comida' : 'Envíos', tipo: i % 4 ? 'personal' : 'negocio', bolsillo: i % 2 ? 'nequi' : 'efectivo', fecha: core.shiftDate(HOY, -(i % 85)), u: 1700000001000 + i });
      for (let i = 0; i < 150; i++) db.items.push({ id: 'i' + i, desc: `Producto ${i} ${'nota '.repeat(8)}`, cat: 'Otro', cond: 'bueno', notes: 'n', buyPrice: 20000 + i * 100, buyPocket: i % 2 ? 'nequi' : 'efectivo', buyDate: core.shiftDate(HOY, -(i % 80)), targetPrice: 30000 + i * 100, status: i % 3 ? 'stock' : 'sold', sellPrice: i % 3 ? undefined : 40000 + i * 100, sellPaid: i % 3 ? undefined : 40000 + i * 100, sellPocket: 'nequi', sellDate: core.shiftDate(HOY, -(i % 60)), u: 1700000002000 + i });
      for (let i = 0; i < 40; i++) db.ingresos.push({ id: 'n' + i, desc: 'Ingreso ' + i, valor: 100000 + i, bolsillo: 'nequi', fecha: core.shiftDate(HOY, -i), u: 1700000003000 + i });
      return db;
    };
    const big = gen();
    const bytes = JSON.stringify(big).length;
    assert.ok(bytes > 150000, `la base de prueba debería pasar de 150 KB y mide ${bytes}`);
    const m2 = await startMock();
    let pa, pb;
    try {
      pa = await new Phone(browser, m2, 'celular grande').init();
      await pa.ctx.addInitScript(([db, cfg]) => { try { if (!localStorage.getItem('miapp_db_v2')) { localStorage.setItem('miapp_db_v2', JSON.stringify(db)); localStorage.setItem('miapp_cfg', JSON.stringify(cfg)); } } catch (e) { /* sin storage */ } }, [big, { url: m2.execUrl, key: m2.key, onboarded: true, last: 0 }]);
      await pa.open();
      await until(() => m2.db().gastos.length === 700 && m2.db().items.length === 150, { timeout: 15000, msg: 'la base grande no llegó completa a la nube' });
      await pa.waitSync('Al día', 15000);
      const filas = m2.env.sheet('_db').getLastRow();
      assert.ok(filas >= 4, `la hoja _db debería tener varios trozos y tiene ${filas}`);
      const s1 = m2.calls('sync')[0];
      assert.ok(s1.bodyBytes > 150000, 'el primer sync debe llevar toda la base');
      // (la semilla nequi_pareja de SPEC §13.2 aparece en $0 al mezclar con un celular nuevo: se compara contra big + semillas)
      const bigSemillas = core.ensureSeeds(core.mergeDB(big, core.emptyDB()));
      assert.deepEqual(core.balances(m2.db()), core.balances(bigSemillas), 'la nube calculó otros saldos que la base original');
      // celular nuevo: baja todo
      pb = await new Phone(browser, m2, 'celular nuevo').init();
      await pb.open();
      await pb.page.click('[data-testid=onb-other]');
      await pb.page.fill('[data-testid=cfg-url]', m2.execUrl);
      await pb.page.fill('[data-testid=cfg-key]', m2.key);
      const t0 = Date.now();
      await pb.page.click('[data-testid=cfg-save]');
      await pb.waitToast(/Nube conectada y al día/, 15000);
      const ms = Date.now() - t0;
      assert.ok(ms < 6000, `conectar y bajar ~${Math.round(bytes / 1024)} KB tardó ${ms} ms`);
      const dbb = await pb.db();
      assert.deepEqual(Object.fromEntries(['gastos', 'items', 'ingresos'].map(c => [c, dbb[c].length])), { gastos: 700, items: 150, ingresos: 40 });
      assert.deepEqual(core.balances(dbb), core.balances(bigSemillas));
      assert.equal(await pb.page.evaluate(() => window.__saldosShown), false);
      const render = await pb.page.evaluate(() => { const t = performance.now(); document.querySelector('[data-testid=tab-movs]').click(); return Math.round(performance.now() - t); });
      assert.ok(render < 1500, `pintar Movimientos con la base grande tardó ${render} ms`);
      await pb.tab('stock');
      assert.match(await pb.text(), /Producto/);
      await pb.shot('31-base-grande-stock');
      pa.assertClean(); pb.assertClean();
      assert.equal(m2.stats.preflights, 0);
    } finally { if (pa) await pa.close(); if (pb) await pb.close(); await m2.close(); }
  });

  /* ═══════════════════════════ G · pantallas, CDN caído y convergencia final ═══════════════════════════ */

  step('G1', 'recorrido de pantallas en 390 px: sin desbordes horizontales, objetivos táctiles ≥ 44 px, campos ≥ 16 px y capturas de cada una', ['F4'], async () => {
    await limpiar();
    await p1.open();
    await p1.syncNow();
    const medir = async nombre => {
      const r = await p1.page.evaluate(() => {
        const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !el.closest('[hidden]') && !el.closest('.sheet:not(.on)') && !el.closest('#onb[hidden]'); };
        const chicos = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button]')]
          .filter(vis).map(el => ({ el, r: el.getBoundingClientRect() })).filter(x => x.r.height < 43.5 || x.r.width < 43.5)
          .map(x => `${x.el.tagName.toLowerCase()}${x.el.id ? '#' + x.el.id : ''}${x.el.dataset.a ? '[' + x.el.dataset.a + ']' : ''} "${(x.el.innerText || x.el.getAttribute('aria-label') || x.el.value || '').trim().slice(0, 18)}" ${Math.round(x.r.width)}x${Math.round(x.r.height)}`);
        const n = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button]')].filter(vis).length;
        // (los campos de solo lectura con el enlace de MacroDroid usan 12 px a propósito: no se escriben ni enfocan para teclear)
        const letras = [...document.querySelectorAll('input:not([type=hidden]):not([type=file]):not([readonly]), select, textarea')].filter(vis).filter(el => parseFloat(getComputedStyle(el).fontSize) < 16).map(el => (el.id || el.name || el.tagName) + ' ' + getComputedStyle(el).fontSize);
        return { n, desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth, chicos, letras };
      });
      return Object.assign({ nombre }, r);
    };
    const informes = [];
    await p1.tab('inicio'); informes.push(await medir('Inicio')); await p1.shot('20-inicio', { full: true });
    await p1.tab('stock'); informes.push(await medir('Stock (en stock)')); await p1.shot('21-stock');
    await p1.page.click('#stSeg button[data-seg=sold]'); informes.push(await medir('Stock (vendidos)')); await p1.shot('22-stock-vendidos');
    await p1.tab('movs'); informes.push(await medir('Movimientos')); await p1.shot('23-movimientos', { full: true });
    await p1.tab('cobros'); informes.push(await medir('Cobros')); await p1.shot('24-cobros');
    await p1.mas('analisis'); informes.push(await medir('Más > Análisis'));
    assert.equal(await p1.page.evaluate(() => !!Chart.getChart('anChart')), true, 'Análisis no dibujó el gráfico con Chart.js');
    await p1.shot('25-mas-analisis', { full: true });
    await p1.mas('dinero'); informes.push(await medir('Más > Dinero')); await p1.shot('26-mas-dinero');
    await p1.mas('ajustes'); informes.push(await medir('Más > Ajustes')); await p1.shot('27-mas-ajustes', { full: true });
    p1.assertClean('errores al recorrer las pantallas');
    for (const i of informes) assert.ok(i.n >= 5, `${i.nombre}: solo se midieron ${i.n} controles (¿la pantalla no se pintó?)`);
    const malos = informes.filter(i => i.desborde > 0 || i.chicos.length || i.letras.length);
    assert.deepEqual(malos.map(i => ({ pantalla: i.nombre, desborde_px: i.desborde, chicos: i.chicos, letra_menor_16: i.letras })), [],
      'pantallas con desborde horizontal, objetivos táctiles menores a 44 px (SPEC §6.7) o campos con letra menor a 16 px');
  });

  step('G2', 'CDN caído (sin Chart.js): la app arranca igual y Análisis muestra la alternativa en barras', ['A1'], async () => {
    mock.setCdn('down');
    const p3 = await new Phone(browser, mock, 'celular 3 (CDN caído)').init();
    try {
      await p3.tolerating(/Failed to load resource|ERR_EMPTY_RESPONSE|ERR_FAILED|ERR_CONNECTION/, async () => {
        await p3.open();
        await p3.page.click('[data-testid=onb-first]');
        await p3.page.click('[data-testid=onb-save]');                 // sin saldos
        await p3.page.waitForSelector('[data-testid=onboarding]', { state: 'hidden' });
        await p3.mas('analisis');
        await p3.page.waitForSelector('#anChartAlt:not([hidden])');
      });
      assert.equal(await p3.page.evaluate(() => typeof Chart), 'undefined');
      assert.match(await p3.page.innerText('#anChartAlt'), /necesita internet/);
      assert.ok(await p3.page.isHidden('#anChartBox'));
      await p3.shot('28-analisis-sin-chartjs');
      assert.deepEqual(p3.errors.filter(e => !/Failed to load resource|ERR_/.test(e)), [], 'errores de JS con el CDN caído');
    } finally { mock.setCdn('up'); await p3.close(); }
  });

  step('G3', 'convergencia final: celular 1, celular 2 y la nube terminan con exactamente los mismos registros (id, u, del), sin duplicados', ['F4'], async () => {
    await limpiar();
    await p1.syncNow(); await p2.syncNow(); await p1.syncNow();
    const resumen = db => Object.fromEntries(core.COLS.map(c => [c, (db[c] || []).map(r => `${r.id}|${r.u}|${r.del ? 1 : 0}`).sort()]));
    const [a, b, n] = [resumen(await p1.db()), resumen(await p2.db()), resumen(mock.db())];
    assert.deepEqual(a, b, 'celular 1 y celular 2 no coinciden');
    assert.deepEqual(a, n, 'los celulares no coinciden con la nube');
    for (const c of core.COLS) assert.equal(new Set(a[c].map(x => x.split('|')[0])).size, a[c].length, `ids duplicados en ${c}`);
    assert.deepEqual(core.balances(await p1.db()), core.balances(await p2.db()));
    // el servidor guardó lo mismo que la hoja _db y las hojas legibles existen
    for (const hoja of ['Inventario', 'Gastos', 'Ingresos', 'Cobros', 'Bolsillos', 'Resumen']) assert.ok(mock.env.sheet(hoja), `falta la hoja legible ${hoja}`);
  });

  step('G4', 'cero errores de consola ni pageerror, ningún 404 de la app, ningún preflight y todo sync como text/plain', ['G3'], async () => {
    p1.assertClean();
    p2.assertClean();
    assert.deepEqual(mock.appNotFound, [], 'la app pidió rutas que no existen bajo /miapp/ (¿ruta absoluta?)');
    assert.equal(mock.stats.preflights, 0, 'hubo preflights (OPTIONS) contra el servidor');
    assert.ok(mock.stats.maxConcurrentSync <= 1, 'hubo dos sync a la vez');
    assert.ok(mock.calls('sync').every(c => /^text\/plain/i.test(c.contentType)), 'algún sync no fue text/plain');
    assert.ok(mock.calls('sync').length >= 10);
    assert.ok(mock.stats.redirects === mock.stats.echoReads || mock.stats.echoReads <= mock.stats.redirects, 'el 302 no se siguió');
    const fotos = fs.readdirSync(SHOTS).filter(f => f.endsWith('.png'));
    assert.ok(fotos.length >= 25, `solo ${fotos.length} capturas`);
  });
});
