'use strict';
/**
 * Humo del FRONTEND con jsdom sobre la app real (index.html + core.js + quick.js + app.js), usando el harness de QA
 * (tests/e2e/harness.js: stubs de Chart, dictado, SW, portapapeles, diálogos, red y reloj falso — nada de eso vive en la app).
 *
 *   JSDOM_DIR=<carpeta>/node_modules node --test tests/frontend/smoke.test.js
 * Si no encuentra jsdom, se salta solo.
 */
const fs = require('node:fs');
const path = require('node:path');
const FRONT_JSDOM = '/tmp/claude-0/-home-claude/06e1c601-47b9-59d5-b935-12c557c2f42b/scratchpad/frontend/node_modules';
if (!process.env.JSDOM_DIR && fs.existsSync(path.join(FRONT_JSDOM, 'jsdom'))) process.env.JSDOM_DIR = FRONT_JSDOM;

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../helpers/core');
const { bootApp, e2eSkipReason, norm } = require('../e2e/harness');
const { createFakeServer } = require('../e2e/fake-server');

const SKIP = e2eSkipReason();
const KEY = 'CLAVE-FRONT', URL_EXEC = 'https://script.google.com/macros/s/AKfycbFRONT/exec';
const HOY = '2026-10-05';
const base = () => core.emptyDB();
const OK_CFG = { onboarded: true };

/* ayudas */
const val = (app, sel) => app.$(sel).value;
const segOn = (app, k) => { const b = app.$(`#f-${k} button.on`); return b ? b.dataset.v : null; };
const clickText = (app, t, within) => { const el = app.byText(t, within); assert.ok(el, `no encontré "${t}"`); app.click(el.closest('button') || el); return el; };
const quick = async (app, frase) => { app.type('#qInput', frase); app.submit('#qForm'); await app.settle(); };
const guardar = async app => { app.submit('#sheetForm'); await app.settle(); };
const sheetOpen = app => app.$('#sheet').classList.contains('on');
const toastText = app => app.text('#toast');

describe('frontend: pantallas y navegación', { skip: SKIP }, () => {
  test('Inicio pinta y todas las pestañas y segmentos se pueden abrir sin errores', async () => {
    const demo = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/demo-db.json'), 'utf8'));
    const app = await bootApp({ db: demo, cfg: OK_CFG });
    try {
      assert.match(norm(app.text('#v-inicio')), /caja hoy/);
      assert.match(norm(app.text('#v-inicio')), /te deben/);
      assert.match(norm(app.text('#v-inicio')), /utilidad del mes/);
      assert.match(norm(app.text('#v-inicio')), /en stock/);
      for (const v of ['stock', 'movs', 'mas', 'inicio']) {
        app.click(`[data-testid="tab-${v}"]`);
        assert.ok(app.$('#v-' + v).classList.contains('on'), `no se activó ${v}`);
      }
      app.click('[data-testid="tab-movs"]'); app.click('[data-testid="plata-deben"]');
      assert.ok(!app.$('#plataDeben').hidden, 'no abrió Te deben');
      app.click('[data-testid="plata-movs"]');
      assert.ok(!app.$('#plataMovs').hidden, 'no volvió a Movimientos');
      app.click('[data-testid="tab-stock"]'); app.click('#stSeg [data-seg="sold"]'); app.click('#stSeg [data-seg="stock"]');
      app.type('#stSearch', 'zzzz-no-existe'); assert.match(norm(app.text('#stockBody')), /nada coincide/);
      app.type('#stSearch', '');
      app.click('[data-testid="tab-movs"]');
      for (const f of ['negocio', 'personal', 'cobros', 'bolsillos', 'todos']) app.click(`#mvFil [data-f="${f}"]`);
      app.click('#mvPrev'); app.click('#mvPrev'); app.click('#mvNext');
      app.click('[data-testid="tab-mas"]');
      for (const s of ['dinero', 'ajustes', 'analisis'])   // ronda 4b: el segmento Bolsillos pasó a ser Dinero (§13.4)
        { app.click(`#masSeg [data-seg="${s}"]`); assert.ok(!app.$('#m-' + s).hidden); }
      assert.ok(app.chart.instances.length >= 1, 'no dibujó el gráfico de 6 meses');
      app.click('#anPrev');
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('los saldos de los bolsillos que muestra Inicio son exactamente balances(DB)', async () => {
    const demo = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/demo-db.json'), 'utf8'));
    const app = await bootApp({ db: demo, cfg: OK_CFG });
    try {
      const b = core.balances(app.db);
      for (const p of core.L(app.db, 'bolsillos')) {
        const chip = app.$(`.pock[data-id="${p.id}"] b`);
        assert.ok(chip, `falta el chip de ${p.id}`);
        assert.equal(chip.textContent, core.full(b[p.id] || 0), `saldo de ${p.id}`);
      }
      app.assertNoErrors();
    } finally { app.close(); }
  });
});

describe('frontend: registrar, vender a crédito y abonar', { skip: SKIP }, () => {
  test('"compré ps5 1.2M nequi" → formulario prellenado → Guardar → queda en stock y en localStorage', async () => {
    const app = await bootApp({ db: base(), cfg: OK_CFG });
    try {
      await quick(app, 'compré ps5 1.2M nequi');
      assert.ok(sheetOpen(app), 'no abrió el formulario');
      assert.equal(val(app, '#f-desc'), 'Ps5');
      assert.equal(val(app, '#f-buyPrice'), '1.200.000');
      assert.equal(val(app, '#f-cat'), 'Consolas');
      assert.equal(segOn(app, 'buyPocket'), 'nequi');
      await guardar(app);
      assert.ok(!sheetOpen(app));
      const it = app.db.items.find(i => i.desc === 'Ps5');
      assert.ok(it, 'no guardó el producto');
      assert.equal(it.buyPrice, 1200000); assert.equal(it.buyPocket, 'nequi'); assert.equal(it.status, 'stock'); assert.equal(it.buyDate, HOY);
      assert.ok(it.u > 1 && it.id);
      assert.equal(val(app, '#qInput'), '', 'no limpió la barra tras guardar');
      assert.equal(core.balances(app.db).nequi, -1200000);
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('vender a crédito crea el cobro solo; dos abonos lo saldan ("¡Saldado!")', async () => {
    const db = base();
    db.items.push({ id: 'ps5', desc: 'PS5 Slim', cat: 'Consolas', cond: 'bueno', buyPrice: 1200000, buyPocket: 'nequi', buyDate: '2026-09-20', targetPrice: 1500000, status: 'stock', u: 10 });
    const app = await bootApp({ db, cfg: OK_CFG });
    try {
      app.click('[data-testid="tab-stock"]');
      clickText(app, 'Vender', '#stockBody *');
      assert.equal(val(app, '#f-itemId'), 'ps5');
      assert.equal(val(app, '#f-sellPrice'), '1.500.000', 'no prellenó con el precio meta');
      assert.ok(app.isHidden('[data-fk="tel"]'));          // ronda 5: "¿A quién se lo vendiste?" se ve siempre; el celular, solo si quedó debiendo
      app.click('[data-testid="f-completo-no"]');
      assert.ok(!app.isHidden('[data-fk="tel"]'));
      app.type('#f-sellPaid', '500k');
      app.type('#f-cliente', 'juan pérez');
      app.type('#f-tel', '300 123 4567');
      await guardar(app);
      assert.match(norm(toastText(app)), /vendido/);
      assert.match(toastText(app), /300\.000/, 'el toast debe decir la ganancia');
      const it = app.db.items.find(i => i.id === 'ps5');
      assert.equal(it.status, 'sold'); assert.equal(it.sellPrice, 1500000); assert.equal(it.sellPaid, 500000);
      const c = app.db.cobros.find(x => x.itemId === 'ps5');
      assert.ok(c, 'no creó el cobro');
      assert.equal(c.total, 1000000); assert.equal(c.pagado, 0); assert.equal(c.bolsillo, ''); assert.equal(c.nombre, 'Juan Pérez');

      app.click('[data-testid="tab-movs"]'); app.click('[data-testid="plata-deben"]');
      assert.match(app.text('#cobrosBody'), /1\.000\.000/);
      clickText(app, '+ Abono', '#cobrosBody *');
      assert.equal(val(app, '#f-cobroId'), c.id);
      app.type('#f-monto', '400.000');
      await guardar(app);
      assert.match(toastText(app), /600\.000/);
      clickText(app, '+ Abono', '#cobrosBody *');
      app.type('#f-monto', '700k');
      await guardar(app);
      assert.ok(sheetOpen(app), 'no debe dejar abonar más de lo que debe');
      assert.match(norm(toastText(app)), /solo te debe/);
      app.type('#f-monto', '600k');
      app.click(app.$('[data-testid="f-bolsillo-efectivo"]'));
      await guardar(app);
      assert.match(norm(toastText(app)), /saldado/);
      assert.equal(core.cobrosPend(app.db).length, 0);
      const b = core.balances(app.db);
      assert.equal(b.nequi, -1200000 + 500000 + 400000);
      assert.equal(b.efectivo, 600000);
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('voz: lo dictado va a la barra y abre el formulario; sin dictado → toast de Gboard', async () => {
    const app = await bootApp({ db: base(), cfg: OK_CFG });
    try {
      app.click('#qMic');
      app.speech.say('almuerzo 18 mil');
      await app.settle();
      assert.equal(app.speech.last().lang, 'es-CO');
      assert.ok(sheetOpen(app));
      assert.equal(val(app, '#f-valor'), '18.000');
      assert.equal(val(app, '#f-cat'), 'Comida');
      assert.equal(segOn(app, 'tipo'), 'personal');
      await guardar(app);
      assert.ok(app.db.gastos.some(g => g.valor === 18000 && g.cat === 'Comida'));
      app.click('#qMic'); app.speech.fail('network'); await app.settle();
      assert.match(norm(toastText(app)), /gboard/);
      app.assertNoErrors();
    } finally { app.close(); }
    const sin = await bootApp({ db: base(), cfg: OK_CFG, speech: false });
    try { sin.click('#qMic'); assert.match(norm(sin.text('#toast')), /gboard/); sin.assertNoErrors(); } finally { sin.close(); }
  });

  test('WhatsApp: sin celular lo pide, lo guarda y abre wa.me/57…', async () => {
    const db = base();
    db.cobros.push({ id: 'c1', nombre: 'Camilo', tel: '', total: 80000, pagado: 0, bolsillo: '', fecha: '2026-10-01', compromiso: HOY, notas: 'audífonos', u: 5 });
    const app = await bootApp({ db, cfg: OK_CFG });
    try {
      assert.match(norm(app.text('#inicioBody')), /prometio pagarte hoy/);
      clickText(app, 'WhatsApp', '#inicioBody *');
      assert.ok(sheetOpen(app));
      app.type('#f-tel', '3001234567');
      await guardar(app);
      assert.equal(app.db.cobros.find(c => c.id === 'c1').tel, '3001234567');
      const url = app.opened[app.opened.length - 1].url;
      assert.match(url, /^https:\/\/wa\.me\/573001234567\?text=/);
      assert.match(decodeURIComponent(url), /Hola Camilo, ¿cómo vas\? Te escribo por el saldo pendiente de \$80\.000 \(audífonos\)/);
      app.assertNoErrors();
    } finally { app.close(); }
  });
});

describe('frontend: Por clasificar y reglas aprendidas', { skip: SKIP }, () => {
  const pend = (id, quien, monto, dir = 'out') => ({ id, raw: `Enviaste $${monto} a ${quien || 'alguien'}`, monto, dir, quien, fecha: HOY, bolsillo: 'nequi', u: 5 });

  test('clasificar por formulario aprende la regla; otro pend del mismo quien se clasifica en 1 toque; Ignorar y Deshacer', async () => {
    const db = base();
    db.pend.push(pend('p1', 'SERVIENTREGA', 15000), pend('p2', 'Servientrega', 9000), pend('p3', '', 5000), pend('p4', 'MAMA', 3000, 'in'));
    const app = await bootApp({ db, cfg: OK_CFG });
    try {
      assert.equal(app.text('#pendBadge'), '4');
      const card = app.$('[data-testid="pend"][data-id="p1"]');
      assert.match(card.textContent, /Enviaste \$15000 a SERVIENTREGA/, 'debe mostrar el texto crudo');
      assert.ok(!app.byText('Igual que antes'), 'no hay regla todavía');
      app.click(app.$('[data-a="pend"][data-k="gastoN"][data-id="p1"]'));
      assert.equal(val(app, '#f-valor'), '15.000');
      assert.equal(segOn(app, 'tipo'), 'negocio');
      assert.equal(val(app, '#f-cat'), 'Envíos');
      await guardar(app);
      const r = app.db.reglas.find(x => x.id === 'servientrega');
      assert.ok(r, 'no aprendió la regla');
      assert.equal(r.kind, 'gasto'); assert.equal(r.tipo, 'negocio'); assert.equal(r.cat, 'Envíos');
      assert.ok(app.db.pend.find(p => p.id === 'p1').del, 'el pend clasificado debe quedar borrado (del:1)');

      const btn = app.$('[data-a="pendRule"][data-id="p2"]');
      assert.ok(btn, 'falta el botón "Igual que antes" en el otro pend del mismo quien');
      assert.match(btn.textContent, /Igual que antes: Gasto negocio · Envíos/);
      assert.ok(!app.$('[data-a="pend"][data-id="p2"]'), 'con regla, la tarjeta se compacta');
      app.click(app.$('[data-a="pendMore"][data-id="p2"]'));
      assert.ok(app.$('[data-a="pend"][data-k="gastoP"][data-id="p2"]'), '"Otro tipo…" muestra todas las opciones');
      app.click(app.$('[data-a="pendRule"][data-id="p2"]'));
      await app.settle();
      assert.ok(app.db.gastos.some(g => g.valor === 9000 && g.cat === 'Envíos' && g.tipo === 'negocio' && g.bolsillo === 'nequi'));
      assert.ok(app.db.pend.find(p => p.id === 'p2').del);

      // sin quien → se clasifica pero NO se aprende regla (§10.4)
      app.click(app.$('[data-a="pend"][data-k="gastoP"][data-id="p3"]'));
      await guardar(app);
      assert.equal(app.db.reglas.filter(x => !x.del).length, 1);
      assert.ok(!app.db.reglas.some(x => x.id === ''));

      // entrada: Ignorar y luego Deshacer
      assert.ok(app.$('[data-a="pend"][data-k="venta"][data-id="p4"]'), 'una entrada debe ofrecer Venta');
      assert.ok(!app.$('[data-a="pend"][data-k="compra"][data-id="p4"]'), 'una entrada no ofrece Compra');
      app.click(app.$('[data-a="pendIgnore"][data-id="p4"]'));
      assert.ok(app.db.pend.find(p => p.id === 'p4').del);
      clickText(app, 'Deshacer', '#toast *');
      assert.ok(!app.db.pend.find(p => p.id === 'p4').del);
      assert.equal(app.text('#pendBadge'), '1');
      app.assertNoErrors();
    } finally { app.close(); }
  });
});

describe('frontend: nube (§6.5) y bienvenida (§10.3)', { skip: SKIP }, () => {
  test('un cambio sincroniza 1,5 s después con el body correcto y aplica el merge del servidor', async () => {
    const server = createFakeServer({ key: KEY });
    const app = await bootApp({ db: base(), cfg: { url: URL_EXEC, key: KEY, onboarded: true }, server });
    try {
      await app.idle(3000);
      server.capture('Recibiste $50.000 de JUAN PEREZ');       // MacroDroid mientras tanto
      const n0 = server.callsTo('sync').length;
      await quick(app, 'envío 12k nequi');
      await guardar(app);
      await app.advance(1000);
      assert.equal(server.callsTo('sync').length, n0, 'sincronizó antes del debounce');
      await app.advance(600);
      await app.settle();
      const calls = server.callsTo('sync');
      assert.equal(calls.length, n0 + 1);
      const last = calls[calls.length - 1];
      assert.equal(last.method, 'POST');
      assert.equal(server.preflightViolations, 0);
      const body = JSON.parse(last.body);
      assert.equal(body.action, 'sync'); assert.equal(body.key, KEY);
      assert.ok(body.db.gastos.some(g => g.valor === 12000 && g.cat === 'Envíos'));
      assert.ok(app.db.pend.some(p => p.quien && /JUAN/i.test(p.quien)), 'no trajo el pend capturado');
      assert.match(norm(app.text('#syncBtn')), /al dia/);
      assert.equal(app.text('#pendBadge'), '1');
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('Ajustes: Guardar y probar (ping) + enlaces de MacroDroid copiables + Probar captura', async () => {
    const server = createFakeServer({ key: KEY });
    const app = await bootApp({ db: base(), cfg: OK_CFG, server });
    try {
      app.click('[data-testid="tab-mas"]'); app.click('#masSeg [data-seg="ajustes"]');
      app.type('#cfgUrl', URL_EXEC); app.type('#cfgKey', 'mala');
      app.click('#cfgSave'); await app.idle(500);
      assert.match(norm(app.text('#toast')), /clave incorrecta/);
      app.type('#cfgKey', KEY);
      app.click('#cfgSave'); await app.idle(500);
      assert.ok(server.callsTo('ping').length >= 2);
      assert.equal(app.cfg.url, URL_EXEC);
      const copy = app.$$('#mdLinks [data-a="copy"]');
      assert.equal(copy.length, 4, 'captura de Nequi y de Nequi pareja (§13.4) + resumen + recordatorios');
      app.click(copy[0]); await app.settle();
      assert.equal(app.clipboard.text, `${URL_EXEC}?action=capture&key=${KEY}&bolsillo=nequi`);
      app.click('#cfgTest'); await app.idle(500);
      assert.ok(server.callsTo('capture').length === 1);
      assert.ok(app.db.pend.some(p => /PRUEBA/.test(p.raw)), 'la captura de prueba no llegó a Por clasificar');
      assert.ok(app.$('#v-inicio').classList.contains('on'));
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('instalación nueva: pregunta primero; "Es mi primera vez" pide saldos y los guarda en ini', async () => {
    const app = await bootApp({});
    try {
      assert.match(norm(app.text('#onb')), /primera vez/);
      assert.doesNotMatch(norm(app.text()), /cuanto tienes hoy/);
      app.click('[data-testid="onb-first"]');
      assert.match(norm(app.text('#onb')), /cuanto tienes hoy/);
      app.type('#onbEfe', '150 mil'); app.type('#onbNeq', '1.250.000');
      app.submit('#onbForm'); await app.settle();
      assert.ok(app.$('#onb').hidden);
      assert.equal(app.db.bolsillos.find(b => b.id === 'efectivo').ini, 150000);
      assert.equal(app.db.bolsillos.find(b => b.id === 'nequi').ini, 1250000);
      assert.equal(app.cfg.onboarded, true);
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('"Ya la uso en otro celular" va a Ajustes y no pide saldos; con nube que trae bolsillos u>1 no aparece el onboarding', async () => {
    const app = await bootApp({});
    try {
      app.click('[data-testid="onb-other"]');
      assert.ok(app.$('#onb').hidden);
      assert.ok(!app.$('#m-ajustes').hidden && app.$('#v-mas').classList.contains('on'));
      assert.doesNotMatch(norm(app.text()), /cuanto tienes hoy/);
    } finally { app.close(); }

    const db = core.emptyDB();
    db.bolsillos = [{ id: 'efectivo', nombre: 'Efectivo', ini: 1, u: 1700000000000 }, { id: 'nequi', nombre: 'Nequi', ini: 2, u: 1700000000000 }];
    const server = createFakeServer({ key: KEY, db });
    const app2 = await bootApp({ cfg: { url: URL_EXEC, key: KEY }, server });
    try {
      await app2.idle(3000);
      assert.ok(app2.$('#onb').hidden, 'el onboarding siguió visible');
      assert.doesNotMatch(norm(app2.text()), /cuanto tienes hoy|primera vez/);
      assert.equal(app2.cfg.onboarded, true);
      assert.equal(app2.db.bolsillos.find(b => b.id === 'nequi').ini, 2);
      app2.assertNoErrors();
    } finally { app2.close(); }
  });

  test('respaldo: Exportar descarga miapp_AAAAMMDD.json con la base', async () => {
    const db = base(); db.gastos.push({ id: 'g1', desc: 'Taxi', valor: 9000, cat: 'Transporte', tipo: 'personal', bolsillo: 'efectivo', fecha: HOY, u: 9 });
    const app = await bootApp({ db, cfg: OK_CFG });
    try {
      app.click('[data-testid="tab-mas"]'); app.click('#masSeg [data-seg="ajustes"]');
      app.click('#bkExp');
      assert.equal(app.downloads[app.downloads.length - 1].filename, 'miapp_20261005.json');
      const j = JSON.parse(await app.downloads.lastText());
      assert.ok(j.gastos.some(g => g.id === 'g1'));
      app.assertNoErrors();
    } finally { app.close(); }
  });
});

describe('frontend: §11 frase compuesta → hoja "Esto entendí"', { skip: SKIP }, () => {
  const FRASE = 'compre un 17 pro max en 3 y lo vendi en 2M y un 16 pro max valorado como compra en 2,1';
  const ini = () => { const db = base(); db.bolsillos.forEach(b => { b.ini = b.id === 'nequi' ? 5000000 : 1000000; b.u = 2; }); return db; };
  const cards = app => app.$$('#sheetBody [data-testid="lote-card"]');
  const saveBtn = app => app.$('[data-testid="lote-save"]');

  test('la frase del usuario (escrita): 3 tarjetas, elegir bolsillos, Guardar todo, cuentas cuadradas y Deshacer revierte todo', async () => {
    const app = await bootApp({ db: ini(), cfg: OK_CFG });
    try {
      const b0 = core.balances(app.db), u0 = core.monthStats(app.db, HOY.slice(0, 7)).neta;
      await quick(app, FRASE);
      assert.ok(sheetOpen(app));
      assert.match(norm(app.text('#sheetTitle')), /esto entendi/);
      const cs = cards(app);
      assert.equal(cs.length, 3, 'compra, venta y producto recibido');
      assert.match(cs[0].textContent, /Compraste 17 Pro Max · \$3\.000\.000/);
      assert.match(cs[1].textContent, /Vendiste 17 Pro Max en \$4\.100\.000 = \$2\.000\.000 en plata \+ 16 Pro Max \(\$2\.100\.000\)/);
      assert.match(cs[1].textContent, /Ganancia \$1\.100\.000/);
      assert.match(cs[2].textContent, /16 Pro Max entra a tu stock · costo \$2\.100\.000/);
      assert.ok(saveBtn(app).disabled, 'faltan bolsillos: Guardar todo deshabilitado');
      app.click('[data-testid="lote-0-buyPocket-nequi"]');
      assert.ok(saveBtn(app).disabled, 'aún falta a dónde entró la plata');
      app.click('[data-testid="lote-1-sellPocket-efectivo"]');
      assert.ok(!saveBtn(app).disabled);
      app.submit('#sheetForm'); await app.settle();
      assert.ok(!sheetOpen(app));
      assert.match(app.text('#toast'), /3 movimientos guardados · ganancia \$1\.100\.000/);
      assert.equal(val(app, '#qInput'), '');

      const db = app.db, b = core.balances(db);
      assert.equal(b.nequi - b0.nequi, -3000000);
      assert.equal(b.efectivo - b0.efectivo, 2000000);
      assert.equal(core.monthStats(db, HOY.slice(0, 7)).neta - u0, 1100000);
      const vendido = db.items.find(i => i.desc === '17 Pro Max');
      const recibido = db.items.find(i => i.desc === '16 Pro Max');
      assert.ok(vendido && recibido);
      assert.equal(vendido.status, 'sold'); assert.equal(vendido.buyPocket, 'nequi'); assert.equal(vendido.buyPrice, 3000000);
      assert.equal(vendido.sellPrice, 4100000); assert.equal(vendido.sellPaid, 2000000); assert.equal(vendido.sellPocket, 'efectivo');
      assert.equal(vendido.tradeInId, recibido.id); assert.equal(vendido.tradeInValor, 2100000);
      assert.equal(recibido.status, 'stock'); assert.equal(recibido.buyPrice, 2100000); assert.equal(recibido.buyPocket, '');
      assert.equal(recibido.fromTradeOf, vendido.id); assert.equal(recibido.cat, 'Celulares');
      assert.equal(core.cobrosPend(db).length, 0, 'la parte de pago NO es un cobro');

      app.click('[data-testid="tab-movs"]');
      assert.match(app.text('#movsBody'), /Venta \+ parte de pago/);
      assert.match(app.text('#movsBody'), /Recibido en parte de pago/);
      assert.doesNotMatch(app.text('#movsBody'), /a crédito/);

      clickText(app, 'Deshacer', '#toast *');
      const db2 = app.db;
      assert.deepEqual(core.balances(db2), b0);
      assert.equal(core.L(db2, 'items').length, 0, 'deshacer revierte el lote completo');
      assert.ok(db2.items.every(i => i.del === 1), 'borrado lógico');
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('dictada: el mismo lote sale por voz; editar una tarjeta abre su formulario y vuelve al lote', async () => {
    const app = await bootApp({ db: ini(), cfg: OK_CFG });
    try {
      app.click('#qMic'); app.speech.say(FRASE); await app.settle();
      assert.equal(cards(app).length, 3);
      app.click(app.$('#sheetBody [data-a="loteEdit"][data-i="1"]'));
      assert.match(app.text('#sheetTitle'), /Vendí/);
      assert.equal(val(app, '#f-itemId'), '__prev');
      assert.equal(segOn(app, 'parte'), 'si');
      assert.equal(val(app, '#f-tiDesc'), '16 Pro Max');
      assert.equal(val(app, '#f-tiValor'), '2.100.000');
      app.type('#f-tiValor', '2.2M');
      app.click('[data-testid="f-sellPocket-nequi"]');
      await guardar(app);
      assert.match(norm(app.text('#sheetTitle')), /esto entendi/, 'volvió al lote');
      assert.match(cards(app)[1].textContent, /en \$4\.200\.000/);
      assert.match(cards(app)[1].textContent, /Ganancia \$1\.200\.000/);
      // Cancelar un formulario del lote también vuelve al lote
      app.click(app.$('#sheetBody [data-a="loteEdit"][data-i="0"]'));
      app.click('[data-testid="form-cancel"]');
      assert.equal(cards(app).length, 3);
      app.click('[data-testid="lote-0-buyPocket-ninguno"]');
      app.submit('#sheetForm'); await app.settle();
      const it = app.db.items.find(i => i.desc === '17 Pro Max');
      assert.equal(it.buyPocket, ''); assert.equal(it.sellPocket, 'nequi'); assert.equal(it.sellPrice, 4200000);
      assert.equal(core.balances(app.db).nequi, 5000000 + 2000000);
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('venta manual con parte de pago + crédito: cobro solo por lo que quedó debiendo; devolver a stock pregunta por lo recibido', async () => {
    const db = base();
    db.items.push({ id: 'ip', desc: 'iPhone 15', cat: 'Celulares', cond: 'bueno', buyPrice: 2000000, buyPocket: 'nequi', buyDate: '2026-09-20', status: 'stock', u: 10 });
    const app = await bootApp({ db, cfg: OK_CFG });
    try {
      app.click('[data-testid="act-venta"]');
      app.select('#f-itemId', 'ip');
      app.type('#f-sellPrice', '1.5M');
      app.click('[data-testid="f-parte-si"]');
      app.type('#f-tiDesc', 'iphone 13'); assert.equal(val(app, '#f-tiCat'), 'Celulares');
      app.type('#f-tiValor', '1.2M');
      app.click('[data-testid="f-completo-no"]');
      app.type('#f-sellPaid', '1M'); app.type('#f-cliente', 'pedro');
      app.click('[data-testid="f-sellPocket-efectivo"]');
      await guardar(app);
      assert.match(app.text('#toast'), /Ganancia \$700\.000/);
      const d = app.db, v = d.items.find(i => i.id === 'ip'), r = d.items.find(i => i.fromTradeOf === 'ip');
      assert.equal(v.sellPrice, 2700000); assert.equal(v.sellPaid, 1000000); assert.equal(v.tradeInValor, 1200000);
      assert.equal(r.buyPrice, 1200000); assert.equal(r.buyPocket, ''); assert.equal(r.notes, 'Parte de pago por iPhone 15');
      const cp = core.cobrosPend(d);
      assert.equal(cp.length, 1); assert.equal(cp[0].pend, 500000, 'solo lo que quedó debiendo, no la parte de pago');
      assert.equal(core.balances(d).efectivo, 1000000);
      assert.equal(core.monthStats(d, HOY.slice(0, 7)).neta, 700000);
      // devolver la venta a stock → pregunta si borrar lo recibido
      app.click('[data-testid="tab-stock"]'); app.click('#stSeg [data-seg="sold"]');
      app.click(app.$('#stockBody [data-a="editItem"][data-id="ip"]'));
      app.click('[data-testid="form-unsell"]');
      assert.ok(app.dialogs.log.some(x => x.type === 'confirm' && /parte de pago/.test(x.message)));
      const d2 = app.db;
      assert.equal(d2.items.find(i => i.id === 'ip').status, 'stock');
      assert.equal(d2.items.find(i => i.id === r.id).del, 1);
      assert.equal(core.cobrosPend(d2).length, 0);
      app.assertNoErrors();
    } finally { app.close(); }
  });
});

describe('frontend: seguridad y borrado lógico', { skip: SKIP }, () => {
  test('un producto "<img src=x onerror=alert(1)>" se muestra como texto, sin inyectar HTML', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const app = await bootApp({ db: base(), cfg: OK_CFG });
    try {
      app.click('[data-testid="act-compra"]');
      app.type('#f-desc', evil); app.type('#f-buyPrice', '10k');
      await guardar(app);
      app.click('[data-testid="act-cobro"]');
      app.type('#f-nombre', '<b onclick=alert(2)>x</b>'); app.type('#f-total', '5k');
      await guardar(app);
      for (const v of ['inicio', 'stock', 'movs']) {
        app.click(`[data-testid="tab-${v}"]`);
        assert.equal(app.$$('main img, main [onerror], main [onclick]').length, 0, `HTML inyectado en ${v}`);
      }
      app.click('[data-testid="plata-deben"]');
      assert.equal(app.$$('main img, main [onerror], main [onclick]').length, 0, 'HTML inyectado en te deben');
      app.click('[data-testid="tab-stock"]');
      assert.ok(app.text('#stockBody').includes(evil), 'el texto debe verse literal');
      assert.equal(app.dialogs.log.filter(d => d.type === 'alert').length, 0);
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('eliminar desde Movimientos = del:1 con u nuevo (nunca borrado físico) y se puede deshacer', async () => {
    const db = base(); db.gastos.push({ id: 'g1', desc: 'Taxi', valor: 9000, cat: 'Transporte', tipo: 'personal', bolsillo: 'efectivo', fecha: HOY, u: 9 });
    const app = await bootApp({ db, cfg: OK_CFG });
    try {
      app.click('[data-testid="tab-movs"]');
      app.click(app.$('#movsBody [data-a="mov"][data-id="g1"]'));
      const g = app.db.gastos.find(x => x.id === 'g1');
      assert.equal(g.del, 1); assert.ok(g.u > 9);
      assert.equal(app.db.gastos.length, 1);
      clickText(app, 'Deshacer', '#toast *');
      assert.ok(!app.db.gastos.find(x => x.id === 'g1').del);
      app.assertNoErrors();
    } finally { app.close(); }
  });
});
