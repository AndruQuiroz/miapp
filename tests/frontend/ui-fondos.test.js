'use strict';
/**
 * Ronda 4b (SPEC §13.4, §12.3) — UI de APARTADOS con jsdom sobre la app real, con el harness de QA (tests/e2e/harness.js).
 *   · Más → Dinero: chequeo "Total en bolsillos = Total en apartados ✅" tras una secuencia mixta hecha por la interfaz,
 *     y saldos de apartados mostrados (Dinero e Inicio) === balancesFondos(DB)
 *   · Repartir desde la acción rápida y desde los chips de Inicio
 *   · chip "Plata de:" en los formularios: sigue al tipo mientras no lo toques; si lo cambias se guarda `fondo`
 *   · aprender de correcciones (registro rápido y "¿Es otra cosa?") + "Lo que he aprendido" → Olvidar
 *   · DB vieja sin semillas → ensureSeeds al cargar y tras sync, sin duplicar
 *   · el kind `reparto`, `d.fondo` y `d.fecha` del parser (simulado: quick.js se reescribe en paralelo)
 *
 *   node --test tests/frontend/ui-fondos.test.js        (se salta solo si no hay jsdom)
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
const KEY = 'CLAVE-FONDOS', URL_EXEC = 'https://script.google.com/macros/s/AKfycbFONDOS/exec';
const OK_CFG = { onboarded: true, fondosIntro: 'no', separarNP: true };   // estas pruebas son del modo con Negocio y Personal separados
const sumObj = o => Object.values(o).reduce((a, b) => a + b, 0);

/* base con saldos iniciales en los 3 bolsillos semilla */
function baseDB() {
  const db = core.emptyDB();
  const ini = { efectivo: 500000, nequi: 2000000, nequi_pareja: 300000 };
  db.bolsillos = db.bolsillos.map(b => Object.assign({}, b, { ini: ini[b.id] || 0, u: 5 }));
  return db;
}

/* ayudas */
const sheetOpen = app => app.$('#sheet').classList.contains('on');
const guardar = async app => { app.submit('#sheetForm'); await app.settle(); };
const quick = async (app, frase) => { app.type('#qInput', frase); app.submit('#qForm'); await app.settle(); };
const act = (app, k) => { app.click('[data-testid="tab-inicio"]'); app.click(`[data-testid="act-${k}"]`); assert.ok(sheetOpen(app), `no abrió ${k}`); };
const seg = (app, k, v) => app.click(`[data-testid="f-${k}-${v}"]`);
const segOn = (app, k) => { const b = app.$(`#f-${k} button.on`); return b ? b.dataset.v : null; };
const chipTxt = app => norm(app.text('[data-testid="f-fondo-chip"]'));
const pickFondo = (app, id) => { app.click('[data-testid="f-fondo-chip"]'); app.click(`[data-testid="f-fondo-${id}"]`); };
const dinero = (app, vista) => {
  app.click('[data-testid="tab-mas"]'); app.click('#masSeg [data-seg="dinero"]');
  app.click(`[data-testid="dn-${vista}"]`);
};
const live = (db, c) => core.L(db, c);

describe('ui-fondos: Dinero y el cuadre', { skip: SKIP }, () => {
  test('secuencia mixta por la interfaz → "Total en bolsillos = Total en apartados ✅" y saldos de apartados === balancesFondos', async () => {
    const app = await bootApp({ db: baseDB(), cfg: OK_CFG });
    try {
      // 1) compra por frase
      await quick(app, 'compré ps5 1.2M nequi'); await guardar(app);
      const ps5 = app.db.items.find(i => i.desc === 'Ps5');
      assert.ok(ps5);
      // 2) venta a crédito (queda un cobro con itemId)
      act(app, 'venta'); app.select('#f-itemId', ps5.id);
      app.type('#f-sellPrice', '1.5M'); seg(app, 'completo', 'no'); app.type('#f-sellPaid', '500k'); app.type('#f-cliente', 'juan');
      seg(app, 'sellPocket', 'efectivo'); await guardar(app);
      assert.ok(!sheetOpen(app), app.text('#toast'));
      // 3) compra + venta con parte de pago (lo recibido entra al stock sin salir de bolsillos)
      act(app, 'compra'); app.type('#f-desc', 'iPhone 13'); app.type('#f-buyPrice', '1M'); seg(app, 'buyPocket', 'efectivo'); await guardar(app);
      const ip = app.db.items.find(i => i.desc === 'iPhone 13');
      act(app, 'venta'); app.select('#f-itemId', ip.id); app.type('#f-sellPrice', '800k');
      seg(app, 'parte', 'si'); app.type('#f-tiDesc', 'iPhone 12'); app.type('#f-tiValor', '600k'); seg(app, 'sellPocket', 'nequi');
      await guardar(app);
      assert.ok(app.db.items.some(i => i.desc === 'iPhone 12' && i.buyPocket === '' && i.status === 'stock'));
      // 4) gasto personal con el Nequi de la pareja y gasto de negocio por frase
      act(app, 'gasto'); app.type('#f-desc', 'Mercado'); app.type('#f-valor', '50k'); seg(app, 'bolsillo', 'nequi_pareja'); await guardar(app);
      await quick(app, 'envío 12k nequi'); await guardar(app);
      // 5) abono de Juan
      act(app, 'abono'); app.select('#f-cobroId', live(app.db, 'cobros')[0].id); app.type('#f-monto', '200k'); seg(app, 'bolsillo', 'nequi'); await guardar(app);
      // 6) préstamo (cobro con bolsillo) e ingreso
      act(app, 'cobro'); app.type('#f-nombre', 'camilo'); app.type('#f-total', '100k'); seg(app, 'bolsillo', 'efectivo'); await guardar(app);
      await quick(app, 'sueldo 1.3M nequi'); await guardar(app);
      // 7) reparto, traslado y ajuste
      act(app, 'reparto'); app.type('#f-monto', '300k'); await guardar(app);
      await quick(app, 'retiré 100k nequi'); await guardar(app);
      app.click('.pock[data-id="efectivo"]'); app.type('#f-real', '1.234.567'); await guardar(app);
      app.assertNoErrors();

      const db = app.db, b = core.balances(db), f = core.balancesFondos(db);
      assert.equal(live(db, 'repartos').length, 1);
      assert.equal(live(db, 'transfers').length, 1);
      assert.equal(live(db, 'ajustes').length, 1);
      assert.equal(b.efectivo, 1234567, 'el ajuste cuadra el efectivo');
      assert.equal(sumObj(b), sumObj(f), 'invariante de core');

      dinero(app, 'donde');
      const cq = app.$('[data-testid="cuadre"]');
      assert.equal(cq.dataset.ok, '1');
      assert.match(app.text(cq), /Total en bolsillos/);
      assert.match(app.text(cq), /Total en apartados/);
      assert.match(app.text(cq), /✅/);
      assert.equal(app.text('[data-testid="total-bolsillos"]'), core.full(sumObj(b)));
      assert.equal(app.text('[data-testid="total-apartados"]'), core.full(sumObj(f)));
      for (const p of live(db, 'bolsillos')) assert.match(app.text(`#bolBody [data-testid="bolsillo"][data-id="${p.id}"]`), new RegExp(core.full(b[p.id] || 0).replace(/[$.]/g, '\\$&')));

      dinero(app, 'para');
      assert.ok(!app.isHidden('#fonBody') && app.isHidden('#bolBody'));
      const cards = app.$$('#fonBody [data-testid="fondo"]');
      assert.deepEqual(cards.map(c => c.dataset.id), core.fondosOrdenados(db).map(x => x.id));
      for (const c of cards) assert.equal(app.text(app.$('[data-testid="fondo-saldo"]', c)), core.full(f[c.dataset.id] || 0), `saldo de ${c.dataset.id}`);
      // Inicio: chips de apartados con el mismo saldo
      app.click('[data-testid="tab-inicio"]');
      const chips = app.$$('[data-testid="fondo-chip"]');
      assert.equal(chips.length, core.fondosOrdenados(db).length);
      for (const ch of chips) assert.equal(app.text(app.$('b', ch)), core.full(f[ch.dataset.fondo] || 0));
      // Movimientos: el reparto aparece en la lista
      app.click('[data-testid="tab-movs"]');
      assert.match(norm(app.text('#movsBody')), /reparto/);
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('apartado en negativo: rojo y explicación clara ("El negocio está usando $X de tu plata personal")', async () => {
    const db = baseDB();
    db.items.push({ id: 'it1', desc: 'Moto', cat: 'Moto/Auto', buyPrice: 900000, buyPocket: 'nequi', buyDate: '2026-10-01', status: 'stock', u: 10 });
    const app = await bootApp({ db, cfg: OK_CFG });
    try {
      dinero(app, 'para');
      const neg = app.$('#fonBody [data-testid="fondo"][data-id="negocio"]');
      assert.ok(app.$('.alert-m.neg', neg), 'el saldo negativo va en rojo');
      assert.match(app.text(app.$('[data-testid="fondo-neg"]', neg)), /El negocio está usando \$900\.000 de tu plata personal/);
      assert.equal(app.$('[data-a="delFondo"]', neg), null, 'Negocio es de base: no se elimina');
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('crear apartado con meta, editar alias, borrar solo en $0 y sin movimientos', async () => {
    const app = await bootApp({ db: baseDB(), cfg: OK_CFG });
    try {
      dinero(app, 'para');
      app.click('[data-testid="fondo-nuevo"]');
      app.type('#f-nombre', 'Arriendo'); app.click(app.$$('#f-emoji button').find(b => b.dataset.v === '🐷'));   // (jsdom no busca emojis en selectores)
      app.type('#f-alias', 'renta, la casa'); app.type('#f-meta', '1.2M');
      await guardar(app);
      const fo = live(app.db, 'fondos').find(x => x.nombre === 'Arriendo');
      assert.ok(fo, 'no creó el apartado');
      assert.equal(fo.id, 'arriendo'); assert.equal(fo.emoji, '🐷'); assert.equal(fo.meta, 1200000);
      assert.deepEqual(fo.alias, ['arriendo', 'renta', 'la casa']);
      const card = () => app.$('#fonBody [data-testid="fondo"][data-id="arriendo"]');
      assert.ok(app.$('[data-a="delFondo"]', card()), 'vacío y sin movimientos: se puede borrar');
      assert.match(norm(app.text(card())), /meta \$1\.200\.000/);
      // repartirle desde su tarjeta → ya no se puede borrar
      app.click(app.$('[data-a="repartir"]', card()));
      assert.equal(app.$('#f-to button.on').dataset.v, 'arriendo');
      assert.equal(app.$('#f-from button.on').dataset.v, 'personal');
      app.type('#f-monto', '300k'); await guardar(app);
      assert.equal(core.balancesFondos(app.db).arriendo, 300000);
      dinero(app, 'para');
      assert.equal(app.$('[data-a="delFondo"]', card()), null);
      assert.match(norm(app.text(card())), /vas en 25%/);
      // editar nombre y alias
      app.click(app.$('[data-a="editFondo"]', card()));
      assert.equal(app.$('#f-alias').value, 'arriendo, renta, la casa');
      app.type('#f-alias', 'arriendo, renta'); await guardar(app);
      assert.deepEqual(live(app.db, 'fondos').find(x => x.id === 'arriendo').alias, ['arriendo', 'renta']);
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('bolsillos: editar nombre y alias; enlaces de MacroDroid por bolsillo digital', async () => {
    const server = createFakeServer({ key: KEY });
    const app = await bootApp({ db: baseDB(), cfg: Object.assign({ url: URL_EXEC, key: KEY }, OK_CFG), server });
    try {
      await app.idle(500);
      dinero(app, 'donde');
      app.click('#bolBody [data-testid="bolsillo"][data-id="nequi_pareja"] [data-a="renombrar"]');
      assert.match(app.$('#f-alias').value, /nequi de mi pareja/);
      app.type('#f-alias', 'nequi de mi pareja, la de laura, laura');
      await guardar(app);
      const p = live(app.db, 'bolsillos').find(x => x.id === 'nequi_pareja');
      assert.deepEqual(p.alias, ['nequi de mi pareja', 'la de laura', 'laura']);
      assert.ok(p.u > 1);
      assert.deepEqual(JSON.parse(app.evalInPage('JSON.stringify(quickCtx())')).bolsillos.find(x => x.id === 'nequi_pareja').alias, p.alias);
      app.click('[data-testid="tab-mas"]'); app.click('#masSeg [data-seg="ajustes"]');
      const urls = app.$$('#mdLinks input').map(i => i.value);
      assert.deepEqual(urls.filter(u => /capture/.test(u)).map(u => new URL(u).searchParams.get('bolsillo')), ['nequi', 'nequi_pareja']);
      assert.match(norm(app.text('#mdLinks')), /celular de tu pareja/);
      app.assertNoErrors();
    } finally { app.close(); }
  });
});

describe('ui-fondos: Repartir y el chip "Plata de:"', { skip: SKIP }, () => {
  test('acción rápida "Repartir" (personal → negocio por defecto) y chip de apartado en Inicio', async () => {
    const app = await bootApp({ db: baseDB(), cfg: OK_CFG });
    try {
      const f0 = core.balancesFondos(app.db);
      act(app, 'reparto');
      assert.equal(segOn(app, 'from'), 'personal'); assert.equal(segOn(app, 'to'), 'negocio');
      app.type('#f-monto', '1M'); app.type('#f-nota', 'capital'); await guardar(app);
      assert.ok(!sheetOpen(app));
      assert.match(app.text('#toast'), /Negocio/);
      const r = live(app.db, 'repartos');
      assert.equal(r.length, 1);
      assert.deepEqual({ from: r[0].from, to: r[0].to, monto: r[0].monto, nota: r[0].nota, fecha: r[0].fecha }, { from: 'personal', to: 'negocio', monto: 1000000, nota: 'capital', fecha: app.evalInPage('today()') });
      const f1 = core.balancesFondos(app.db);
      assert.equal(f1.negocio - f0.negocio, 1000000); assert.equal(f0.personal - f1.personal, 1000000);
      assert.deepEqual(core.balances(app.db), core.balances(baseDB()), 'repartir no mueve plata entre bolsillos');
      // tocar el chip de Personal en Inicio abre Repartir HACIA personal (desde negocio)
      app.click('[data-testid="fondo-chip"][data-fondo="personal"]');
      assert.equal(segOn(app, 'to'), 'personal'); assert.equal(segOn(app, 'from'), 'negocio');
      app.type('#f-monto', '200k');
      seg(app, 'from', 'personal');                 // mismo apartado → el otro se corrige solo
      assert.notEqual(segOn(app, 'to'), 'personal');
      app.click('[data-testid="form-cancel"]');
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('el chip sigue al tipo del gasto sin guardar `fondo`; si lo cambias, se guarda el apartado elegido', async () => {
    const app = await bootApp({ db: baseDB(), cfg: OK_CFG });
    try {
      act(app, 'gasto');
      assert.match(chipTxt(app), /plata de: .*personal/);
      assert.ok(app.isHidden('#f-fondo .opts'), 'compacto: no despliega nada si no lo tocas');
      seg(app, 'tipo', 'negocio');
      assert.match(chipTxt(app), /negocio/, 'el chip sigue a fondoDe (tipo negocio → Negocio)');
      app.type('#f-valor', '20k'); app.type('#f-desc', 'Bolsas');
      await guardar(app);
      let g = live(app.db, 'gastos').find(x => x.desc === 'Bolsas');
      assert.equal(g.tipo, 'negocio');
      assert.ok(!('fondo' in g), 'sin tocar el chip no se guarda fondo');
      assert.equal(core.fondoDe('gastos', g, app.db), 'negocio');
      // ahora sí lo cambia: gasto del negocio pagado con plata personal
      act(app, 'gasto');
      seg(app, 'tipo', 'negocio'); app.type('#f-valor', '30k'); app.type('#f-desc', 'Cinta');
      pickFondo(app, 'personal');
      assert.match(chipTxt(app), /personal/);
      assert.ok(app.isHidden('#f-fondo .opts'), 'al elegir se vuelve a plegar');
      seg(app, 'tipo', 'personal'); seg(app, 'tipo', 'negocio');
      assert.match(chipTxt(app), /personal/, 'si lo tocaste, ya no lo cambia el tipo');
      await guardar(app);
      g = live(app.db, 'gastos').find(x => x.desc === 'Cinta');
      assert.equal(g.fondo, 'personal'); assert.equal(g.tipo, 'negocio');
      // en compras el chip arranca en Negocio; elegir Personal lo guarda en el producto
      act(app, 'compra');
      assert.match(chipTxt(app), /negocio/);
      app.type('#f-desc', 'Bicicleta'); app.type('#f-buyPrice', '400k'); pickFondo(app, 'personal');
      await guardar(app);
      assert.equal(live(app.db, 'items').find(i => i.desc === 'Bicicleta').fondo, 'personal');
      assert.equal(sumObj(core.balances(app.db)), sumObj(core.balancesFondos(app.db)));
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('del parser: kind `reparto`, `d.fondo` y `d.fecha` (formulario y hoja "Esto entendí")', async () => {
    const app = await bootApp({ db: baseDB(), cfg: OK_CFG });
    try {
      const stub = arr => app.evalInPage(`parseQuickMulti = () => (${JSON.stringify(arr)});`);
      // reparto solo → formulario prellenado
      stub([{ kind: 'reparto', d: { from: 'negocio', to: 'personal', monto: 1000000, fecha: '2026-10-04' } }]);
      await quick(app, 'saqué 1M de ganancia del negocio');
      assert.equal(app.text('#sheetTitle'), '🔀 Repartir plata');
      assert.equal(segOn(app, 'from'), 'negocio'); assert.equal(segOn(app, 'to'), 'personal');
      assert.equal(app.$('#f-monto').value, '1.000.000'); assert.equal(app.$('#f-fecha').value, '2026-10-04');
      await guardar(app);
      assert.equal(live(app.db, 'repartos')[0].fecha, '2026-10-04');
      // compra con `fecha` y `fondo` explícito
      stub([{ kind: 'compra', d: { desc: 'Ps4', buyPrice: 500000, buyPocket: 'efectivo', fecha: '2026-10-03', fondo: 'personal' } }]);
      await quick(app, 'compré ps4 500k efectivo antier con mi plata');
      assert.equal(app.$('#f-buyDate').value, '2026-10-03');
      assert.match(chipTxt(app), /personal/);
      await guardar(app);
      const ps4 = live(app.db, 'items').find(i => i.desc === 'Ps4');
      assert.equal(ps4.buyDate, '2026-10-03'); assert.equal(ps4.fondo, 'personal', 'el fondo del parser se guarda');
      // lote con un gasto (fondo explícito) + un reparto
      stub([{ kind: 'gasto', d: { desc: 'Mercado', valor: 80000, bolsillo: 'nequi', fondo: 'negocio', fecha: '2026-10-02' } },
        { kind: 'reparto', d: { from: 'personal', to: 'negocio', monto: 80000 } }]);
      await quick(app, 'mercado 80k nequi del negocio y le devolví 80k al negocio');
      assert.equal(app.$$('[data-testid="lote-card"]').length, 2);
      assert.match(norm(app.text('#sheetBody')), /repartiste \$80\.000 de .*personal a .*negocio/);
      assert.match(norm(app.text('[data-testid="lote-fondo"]')), /negocio/);
      assert.ok(!app.$('[data-testid="lote-save"]').disabled, app.text('[data-testid="lote-falta"]'));
      app.submit('#sheetForm'); await app.settle();
      const g = live(app.db, 'gastos').find(x => x.desc === 'Mercado');
      assert.equal(g.fondo, 'negocio'); assert.equal(g.fecha, '2026-10-02');
      assert.equal(live(app.db, 'repartos').length, 2);
      // fondo desconocido del parser → se ignora (queda el de por defecto, sin guardar)
      stub([{ kind: 'gasto', d: { desc: 'Tinto', valor: 3000, bolsillo: 'efectivo', fondo: 'no-existe' } }]);
      await quick(app, 'tinto 3000'); await guardar(app);
      assert.ok(!('fondo' in live(app.db, 'gastos').find(x => x.desc === 'Tinto')));
      app.assertNoErrors();
    } finally { app.close(); }
  });
});

describe('ui-fondos: aprende de tus correcciones (§12.3)', { skip: SKIP }, () => {
  test('corregir tipo y bolsillo → regla q:palabra; quickCtx la pasa; "Lo que he aprendido" → Olvidar', async () => {
    const app = await bootApp({ db: baseDB(), cfg: OK_CFG });
    try {
      // sin corrección no aprende nada
      await quick(app, 'almuerzo 18 mil'); await guardar(app);
      assert.equal(live(app.db, 'reglas').length, 0);
      // "parqueadero 5 mil" → Transporte/personal (bolsillo sin decir); lo corrige a negocio y efectivo
      await quick(app, 'parqueadero 5 mil');
      assert.equal(app.$('#f-cat').value, 'Transporte'); assert.equal(segOn(app, 'tipo'), 'personal');
      seg(app, 'tipo', 'negocio'); seg(app, 'bolsillo', 'efectivo');
      await guardar(app);
      assert.match(app.text('#toast'), /aprendí “parqueadero”/);
      const r = live(app.db, 'reglas').find(x => x.id === 'q:parqueadero');
      assert.ok(r, 'no guardó la regla');
      assert.equal(r.kind, 'quick'); assert.equal(r.palabra, 'parqueadero');
      assert.equal(r.tipo, 'negocio'); assert.equal(r.bolsillo, 'efectivo');
      assert.ok(!('cat' in r), 'la categoría no la cambió');
      assert.ok(r.u > 1);
      const ctx = JSON.parse(app.evalInPage('JSON.stringify(quickCtx())'));
      assert.deepEqual(ctx.reglas.map(x => x.id), ['q:parqueadero']);
      assert.deepEqual(Object.keys(ctx).sort(), ['bolsillos', 'cobros', 'fondos', 'reglas', 'stock']);
      assert.deepEqual(ctx.fondos.map(x => x.id), ['negocio', 'personal']);
      assert.deepEqual(Object.keys(ctx.fondos[0]).sort(), ['alias', 'id', 'nombre']);
      assert.deepEqual(Object.keys(ctx.bolsillos[0]).sort(), ['alias', 'id', 'nombre']);
      // la frase YA decía el bolsillo → cambiarlo no se aprende; la categoría sí
      await quick(app, 'pauta 20k nequi');
      app.select('#f-cat', 'Servicios'); seg(app, 'bolsillo', 'efectivo');
      await guardar(app);
      const r2 = live(app.db, 'reglas').find(x => x.id === 'q:pauta');
      assert.equal(r2.cat, 'Servicios'); assert.ok(!('bolsillo' in r2));
      // cambiar el apartado con el chip también se aprende
      await quick(app, 'gaseosa 4k efectivo'); pickFondo(app, 'negocio'); await guardar(app);
      assert.equal(live(app.db, 'reglas').find(x => x.id === 'q:gaseosa').fondo, 'negocio');
      // Ajustes → Lo que he aprendido
      app.click('[data-testid="tab-mas"]'); app.click('#masSeg [data-seg="ajustes"]');
      const fila = app.$('#aprBody [data-testid="regla"][data-id="q:parqueadero"]');
      assert.ok(fila);
      assert.match(app.text(fila), /parqueadero → negocio · Efectivo/);
      app.click(app.$('[data-testid="olvidar"]', fila));
      assert.equal(app.db.reglas.find(x => x.id === 'q:parqueadero').del, 1, 'borrado lógico');
      assert.equal(app.$('#aprBody [data-id="q:parqueadero"]'), null);
      assert.ok(!app.evalInPage('quickCtx()').reglas.some(x => x.id === 'q:parqueadero'));
      // volver a corregir la misma palabra la revive sin los datos viejos
      await quick(app, 'parqueadero 5 mil'); app.select('#f-cat', 'Servicios'); await guardar(app);
      const r3 = live(app.db, 'reglas').find(x => x.id === 'q:parqueadero');
      assert.equal(r3.cat, 'Servicios'); assert.ok(!('tipo' in r3) && !('bolsillo' in r3));
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('"¿Es otra cosa?" cambia el tipo conservando monto y descripción, y aprende gkind; las reglas de Nequi se listan y se olvidan', async () => {
    const db = baseDB();
    db.reglas.push({ id: 'servientrega', kind: 'gasto', desc: 'Envío', cat: 'Envíos', tipo: 'negocio', from: '', to: '', u: 9 });
    const app = await bootApp({ db, cfg: OK_CFG });
    try {
      await quick(app, 'camiseta 30k nequi');
      assert.equal(app.text('#sheetTitle'), '💸 Gasto');
      app.click('[data-testid="kswitch-compra"]');
      assert.equal(app.text('#sheetTitle'), '🛒 Compré');
      assert.equal(app.$('#f-desc').value, 'Camiseta'); assert.equal(app.$('#f-buyPrice').value, '30.000');
      assert.equal(segOn(app, 'buyPocket'), 'nequi'); assert.equal(app.$('#f-cat').value, 'Ropa');
      await guardar(app);
      assert.ok(live(app.db, 'items').some(i => i.desc === 'Camiseta' && i.buyPrice === 30000));
      assert.equal(live(app.db, 'gastos').length, 0);
      assert.equal(live(app.db, 'reglas').find(x => x.id === 'q:camiseta').gkind, 'compra');
      app.click('[data-testid="tab-mas"]'); app.click('#masSeg [data-seg="ajustes"]');
      assert.match(norm(app.text('#aprBody')), /camiseta → es compra/);
      assert.match(norm(app.text('#aprBody')), /servientrega → gasto negocio · envios/);
      app.click('#aprBody [data-testid="regla"][data-id="servientrega"] [data-testid="olvidar"]');
      assert.equal(app.db.reglas.find(x => x.id === 'servientrega').del, 1);
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('en el lote del registro rápido también aprende (bolsillo elegido con chips en un gasto)', async () => {
    const app = await bootApp({ db: baseDB(), cfg: OK_CFG });
    try {
      app.evalInPage(`parseQuickMulti = () => [{kind:'gasto', d:{desc:'Domicilio', valor:8000, cat:'Comida', tipo:'personal'}}, {kind:'compra', d:{desc:'Funda', buyPrice:10000, buyPocket:'efectivo', cat:'Accesorios'}}];`);
      await quick(app, 'domicilio 8 mil y compré funda 10k efectivo');
      app.click('[data-testid="lote-0-bolsillo-nequi_pareja"]');
      app.submit('#sheetForm'); await app.settle();
      assert.ok(!sheetOpen(app), app.text('[data-testid="lote-falta"]'));
      const r = live(app.db, 'reglas').find(x => x.id === 'q:domicilio');
      assert.ok(r); assert.equal(r.bolsillo, 'nequi_pareja');
      assert.ok(!live(app.db, 'reglas').some(x => x.id === 'q:funda'), 'la compra no cambió nada');
      app.assertNoErrors();
    } finally { app.close(); }
  });
});

describe('ui-fondos: semillas en bases viejas (ensureSeeds)', { skip: SKIP }, () => {
  test('DB v2.1 sin Nequi pareja ni apartados → semillas al cargar y tras sync, sin duplicar; tarjeta "Organiza tu plata"', async () => {
    const vieja = {
      items: [{ id: 'i1', desc: 'PS5', cat: 'Consolas', buyPrice: 1000000, buyPocket: 'nequi', buyDate: '2026-09-01', status: 'stock', u: 20 }],
      gastos: [], ingresos: [], cobros: [], abonos: [], transfers: [], ajustes: [], pend: [], reglas: [],
      bolsillos: [{ id: 'efectivo', nombre: 'Efectivo', ini: 400000, u: 30 }, { id: 'nequi', nombre: 'Nequi', ini: 3000000, u: 30 }],
    };
    const server = createFakeServer({ key: KEY, db: JSON.parse(JSON.stringify(vieja)) });   // la nube también es de la versión vieja
    const app = await bootApp({ db: vieja, cfg: { url: URL_EXEC, key: KEY, onboarded: true, separarNP: true }, server });
    try {
      const ids = (db, c) => db[c].map(x => x.id).sort();
      let db = app.db;
      assert.deepEqual(ids(db, 'bolsillos'), ['efectivo', 'nequi', 'nequi_pareja']);
      assert.deepEqual(ids(db, 'fondos'), ['negocio', 'personal']);
      assert.deepEqual(db.repartos, []);
      assert.equal(db.bolsillos.find(b => b.id === 'nequi').ini, 3000000, 'no toca lo que el usuario ya tenía');
      assert.ok(!('alias' in db.bolsillos.find(b => b.id === 'nequi')), 'una semilla editada (u>1) no se toca');
      await app.idle(3000);
      assert.ok(server.callsTo('sync').length >= 1);
      for (const d of [app.db, server.db]) {
        assert.deepEqual(ids(d, 'bolsillos'), ['efectivo', 'nequi', 'nequi_pareja'], 'sin duplicados tras sync');
        assert.deepEqual(ids(d, 'fondos'), ['negocio', 'personal']);
      }
      // otro sync (y un merge desde la nube con las semillas) sigue sin duplicar
      app.click('#syncBtn'); await app.idle(3000);
      db = app.db;
      assert.equal(db.bolsillos.length, 3); assert.equal(db.fondos.length, 2);
      assert.equal(sumObj(core.balances(db)), sumObj(core.balancesFondos(db)));
      // tarjeta "Organiza tu plata en apartados": 1 M de los 3,4 M es del negocio
      app.click('[data-testid="tab-inicio"]');
      assert.ok(app.$('[data-testid="organizar"]'), 'debe ofrecer organizar los apartados');
      app.click('[data-testid="organizar-go"]');
      app.type('#f-negocio', '1M'); await guardar(app);
      const f = core.balancesFondos(app.db);
      assert.equal(f.negocio, 1000000);
      assert.equal(f.personal, sumObj(core.balances(app.db)) - 1000000);
      assert.equal(app.$('[data-testid="organizar"]'), null, 'ya organizado: no vuelve a salir');
      assert.equal(live(app.db, 'repartos')[0].nota, 'Organizar apartados');
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('"Ahora no" descarta la tarjeta; Movimientos se filtra por apartado (los repartos con signo)', async () => {
    const db = baseDB();
    db.gastos.push({ id: 'g1', desc: 'Envío', valor: 10000, cat: 'Envíos', tipo: 'negocio', bolsillo: 'nequi', fecha: '2026-10-02', u: 10 });
    db.gastos.push({ id: 'g2', desc: 'Cine', valor: 20000, cat: 'Entretenimiento', tipo: 'personal', bolsillo: 'nequi', fecha: '2026-10-02', u: 10 });
    db.repartos.push({ id: 'r1', from: 'personal', to: 'negocio', monto: 50000, fecha: '2026-10-03', nota: '', u: 10 });
    db.transfers.push({ id: 't1', from: 'nequi', to: 'efectivo', monto: 5000, fecha: '2026-10-03', u: 10 });
    db.repartos = [];
    const app = await bootApp({ db, cfg: { onboarded: true, separarNP: true } });
    try {
      assert.ok(app.$('[data-testid="organizar"]'));
      app.click('[data-a="organizarNo"]');
      assert.equal(app.$('[data-testid="organizar"]'), null);
      assert.equal(app.cfg.fondosIntro, 'no');
      // un reparto para el filtro
      act(app, 'reparto'); app.type('#f-monto', '50k'); await guardar(app);
      app.click('[data-testid="tab-movs"]');
      const n = () => app.$$('#movsBody .row').length;
      assert.equal(n(), 4);
      app.select('#mvFondo', 'negocio');
      assert.deepEqual(app.$$('#movsBody .row').map(r => r.dataset.col).sort(), ['gastos', 'repartos']);
      assert.match(app.text('#movsBody'), /\+\$50\.000/);
      app.select('#mvFondo', 'personal');
      assert.deepEqual(app.$$('#movsBody .row').map(r => r.dataset.col).sort(), ['gastos', 'repartos']);
      assert.match(app.text('#movsBody'), /−\$50\.000/);
      app.select('#mvFondo', '');
      assert.equal(n(), 4);
      app.assertNoErrors();
    } finally { app.close(); }
  });
});
