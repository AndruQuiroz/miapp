'use strict';
/**
 * Ronda 5 (SPEC §14.4) — UI con jsdom sobre la app real (harness de QA: tests/e2e/harness.js).
 *   · ficha del producto: línea de tiempo y ganancia REAL tras un arreglo ligado (+ Gasto desde la ficha) y venta desde la ficha
 *   · referencia de precios: línea en Venta/Compra (tocable, "Usar") y buscador "¿Cuánto vale un…?" en Stock
 *   · comentario del mes (monthInsight) en Inicio con datos de 2 meses
 *   · topes: alerta en Inicio si 'cerca'/'pasado', vista Más → Dinero → Topes, sugerencia "Todo lo personal"
 *   · contactos: crear rápido desde Venta/Compra, stats en Más → Contactos, WhatsApp
 *   · datos del equipo y campos nuevos del parser (proveedor, bateria, almac, color, cliente, itemId en gastos)
 *
 *   node --test tests/frontend/ui-r5.test.js        (se salta solo si no hay jsdom)
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
const HOY = '2026-10-05';     // reloj del harness

function baseDB() {
  const db = core.emptyDB();
  db.bolsillos = db.bolsillos.map(b => Object.assign({}, b, { ini: { efectivo: 1000000, nequi: 5000000 }[b.id] || 0, u: 5 }));
  return db;
}
const item = (id, desc, o = {}) => Object.assign({ id, desc, cat: 'Celulares', cond: 'bueno', notes: '', buyPrice: 1000000, buyPocket: 'nequi', buyDate: '2026-09-20', targetPrice: null, status: 'stock', u: 10 }, o);
const sold = (id, desc, o = {}) => item(id, desc, Object.assign({ status: 'sold', sellPrice: 1500000, sellPaid: 1500000, sellPocket: 'nequi', sellDate: '2026-09-28' }, o));

const sheetOpen = app => app.$('#sheet').classList.contains('on');
const guardar = async app => { app.submit('#sheetForm'); await app.settle(); };
const quick = async (app, frase) => { app.type('#qInput', frase); app.submit('#qForm'); await app.settle(); };
const seg = (app, k, v) => app.click(`[data-testid="f-${k}-${v}"]`);
const page = (app, expr) => JSON.parse(app.evalInPage(`JSON.stringify(${expr})`));
const live = (db, c) => core.L(db, c);

describe('ui-r5: ficha del producto', { skip: SKIP }, () => {
  test('arreglo ligado desde la ficha → costo total y ganancia REAL; vender desde la ficha y volver a ella', async () => {
    const db = baseDB();
    db.items.push(item('ip13', 'iPhone 13 128GB', { buyPrice: 1000000, imei: '356789012345678', bateria: 87, almac: '128GB', color: 'Azul', proveedor: 'Andrés' }));
    const app = await bootApp({ db, cfg: OK_CFG });
    try {
      app.click('[data-testid="tab-stock"]');
      app.click('#stockBody [data-testid="item"][data-id="ip13"] [data-a="ficha"]');
      assert.ok(sheetOpen(app));
      assert.equal(app.$('#sheetBody').dataset.ficha, 'ip13');
      const t0 = norm(app.text('#sheetBody'));
      assert.match(t0, /en stock · 15 dias/);
      assert.match(t0, /356789012345678/); assert.match(t0, /87%/); assert.match(t0, /128gb/); assert.match(t0, /se lo compraste a\s*andres/);
      // + Gasto de este producto
      app.click('[data-testid="ficha-gasto"]');
      assert.equal(app.$('#f-itemId').value, 'ip13', 'el gasto llega ligado al producto');
      assert.equal(app.$('#f-tipo button.on').dataset.v, 'negocio');
      assert.equal(app.$('#f-cat').value, 'Mantenimiento');
      app.type('#f-desc', 'Cambio de pantalla'); app.type('#f-valor', '80k');
      await guardar(app);
      const g = live(app.db, 'gastos')[0];
      assert.equal(g.itemId, 'ip13'); assert.equal(g.tipo, 'negocio');
      assert.ok(sheetOpen(app) && app.$('#sheetBody').dataset.ficha === 'ip13', 'vuelve a la ficha');
      assert.match(app.text('[data-testid="ficha-tl"]'), /Cambio de pantalla · \$80\.000/);
      assert.match(app.text('#sheetBody'), /\$1\.080\.000/);
      // vender desde la ficha
      app.click('[data-testid="ficha-vender"]');
      assert.equal(app.$('#f-itemId').value, 'ip13');
      app.type('#f-sellPrice', '1.5M'); app.type('#f-cliente', 'mateo'); seg(app, 'clienteNuevo', 'si');
      await guardar(app);
      assert.match(app.text('#toast'), /Ganancia \$420\.000/, 'la ganancia descuenta el arreglo');
      const h = core.itemHistory(app.db, 'ip13');
      assert.equal(h.costoTotal, 1080000); assert.equal(h.ganancia, 420000);
      assert.ok(app.$('#sheetBody').dataset.ficha === 'ip13');
      const t1 = app.text('#sheetBody');
      assert.match(t1, /Ganancia real\s*\$420\.000/);
      assert.match(t1, /Costo total\s*\$1\.080\.000/);
      assert.match(t1, /Se lo vendiste a\s*Mateo/);
      const tl = app.$$('[data-testid="ficha-tl"] li').map(li => norm(li.textContent));
      assert.equal(tl.length, 3);
      assert.match(tl[0], /compra/); assert.match(tl[1], /cambio de pantalla/); assert.match(tl[2], /venta/);
      assert.equal(app.$('[data-testid="ficha-vender"]'), null, 'vendido: sin botón Vender');
      app.click('#sheetX');
      // Vendidos: ganancia real; Movimientos: tocar el producto abre la ficha
      app.click('#stSeg [data-seg="sold"]');
      assert.match(app.text('#stockBody [data-testid="item"][data-id="ip13"]'), /Ganancia\s*\$420\.000/);
      app.click('[data-testid="tab-movs"]');
      app.click('#movsBody [data-a="mov"][data-col="items"][data-id="ip13"]');
      assert.equal(app.$('#sheetBody').dataset.ficha, 'ip13');
      assert.match(norm(app.text('#movsBody')), /de iphone 13 128gb/, 'el gasto dice de qué producto es');
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('parte de pago: la ficha enlaza el producto recibido y el de origen', async () => {
    const db = baseDB();
    db.items.push(sold('a', 'iPhone 17 Pro Max', { buyPrice: 3000000, sellPrice: 4100000, sellPaid: 2000000, tradeInId: 'b', tradeInValor: 2100000, sellDate: '2026-10-01' }));
    db.items.push(item('b', 'iPhone 16 Pro Max', { buyPrice: 2100000, buyPocket: '', buyDate: '2026-10-01', fromTradeOf: 'a' }));
    const app = await bootApp({ db, cfg: OK_CFG });
    try {
      app.evalInPage("openFicha('a')");
      assert.match(app.text('#sheetBody'), /Ganancia real\s*\$1\.100\.000/);
      app.click('#sheetBody [data-a="ficha"][data-id="b"]');
      assert.equal(app.$('#sheetBody').dataset.ficha, 'b');
      assert.match(norm(app.text('#sheetBody')), /lo recibiste en parte de pago/);
      app.click('#sheetBody [data-a="ficha"][data-id="a"]');
      assert.equal(app.$('#sheetBody').dataset.ficha, 'a');
      app.assertNoErrors();
    } finally { app.close(); }
  });
});

describe('ui-r5: referencia de precios', { skip: SKIP }, () => {
  const refDB = () => {
    const db = baseDB();
    db.items.push(sold('s1', 'iPhone 13 128GB negro', { buyPrice: 1200000, sellPrice: 1600000, sellDate: '2026-09-10', buyDate: '2026-09-01' }));
    db.items.push(sold('s2', 'iphone 13 azul', { buyPrice: 1300000, sellPrice: 1700000, sellDate: '2026-09-25', buyDate: '2026-09-15' }));
    db.items.push(item('s3', 'iPhone 13 256GB', { buyPrice: 1250000, buyDate: '2026-10-01' }));
    return db;
  };
  test('Venta: línea con lo comprado y el sugerido; tocar → detalle; "Usar" pone el precio', async () => {
    const app = await bootApp({ db: refDB(), cfg: OK_CFG });
    try {
      const r = core.priceRef(app.db, 'iphone 13');
      assert.ok(r && r.sugeridoVenta);
      app.click('[data-testid="tab-stock"]');
      app.click('#stockBody [data-testid="item"][data-id="s3"] [data-a="vender"]');
      assert.ok(!app.isHidden('[data-fk="_ref"]'), 'la referencia debe verse');
      const line = app.text('[data-testid="f-ref-line"]');
      assert.match(line, /Lo has comprado 3 veces, prom\. \$1\.3M/);
      assert.match(line, new RegExp('lo vendes en ~' + core.fmt(r.sugeridoVenta).replace(/[$.]/g, '\\$&') + ' \\(sugerido\\)'));
      assert.ok(app.isHidden('[data-testid="f-ref-det"]'));
      app.click('[data-testid="f-ref-line"]');
      assert.ok(!app.isHidden('[data-testid="f-ref-det"]'));
      app.click('[data-testid="f-ref-usar"]');
      assert.equal(app.$('#f-sellPrice').value, core.full(r.sugeridoVenta).slice(1));
      await guardar(app);
      assert.equal(live(app.db, 'items').find(i => i.id === 's3').sellPrice, r.sugeridoVenta);
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('Compra: aparece al escribir el producto; Stock "¿Cuánto vale un…?" abre la referencia completa', async () => {
    const app = await bootApp({ db: refDB(), cfg: OK_CFG });
    try {
      app.click('[data-testid="act-compra"]');
      assert.ok(app.isHidden('[data-fk="_ref"]'));
      app.type('#f-desc', 'iphone 13 pro'); assert.ok(app.isHidden('[data-fk="_ref"]'), 'otro modelo: sin datos');
      app.type('#f-desc', 'iphone 13 blanco');
      assert.ok(!app.isHidden('[data-fk="_ref"]'));
      app.click('[data-testid="f-ref-line"]'); app.click('[data-testid="f-ref-usar"]');
      assert.ok(+app.evalInPage('F.v.targetPrice') > 0, 'en compra "Usar" pone el precio meta');
      app.click('[data-testid="form-cancel"]');
      app.click('[data-testid="tab-stock"]');
      app.type('#refQ', 'ip 13');
      assert.match(norm(app.text('[data-testid="ref-quick"]')), /iphone 13 · 3 registros/);
      app.click('[data-testid="ref-quick"]');
      assert.equal(app.text('#sheetTitle'), '📊 ¿Cuánto vale?');
      assert.equal(app.text('[data-testid="ref-sugerido"]'), core.full(core.priceRef(app.db, 'iphone 13').sugeridoVenta));
      assert.equal(app.$$('#sheetBody .row').length, 3);
      app.click('#sheetBody .row[data-id="s1"]');
      assert.equal(app.$('#sheetBody').dataset.ficha, 's1');
      app.click('#sheetX');
      app.type('#refQ', 'xbox 360');
      assert.ok(app.$('[data-testid="ref-quick-none"]'));
      app.assertNoErrors();
    } finally { app.close(); }
  });
});

describe('ui-r5: Inicio (comentario del mes y topes)', { skip: SKIP }, () => {
  test('con ventas de 2 meses, Inicio muestra monthInsight bajo las tarjetas', async () => {
    const db = baseDB();
    db.items.push(sold('x1', 'PS5', { buyPrice: 1500000, sellPrice: 1900000, buyDate: '2026-09-01', sellDate: '2026-09-03' }));
    db.items.push(sold('x2', 'Xbox Series S', { buyPrice: 900000, sellPrice: 1100000, buyDate: '2026-09-02', sellDate: '2026-09-04' }));
    db.items.push(sold('x3', 'iPhone 14', { buyPrice: 1800000, sellPrice: 2600000, buyDate: '2026-10-01', sellDate: '2026-10-04' }));
    const app = await bootApp({ db, cfg: OK_CFG });
    try {
      const ins = app.evalInPage('monthInsight(DB)');
      assert.ok(ins, 'debe haber comentario');
      assert.equal(app.text('[data-testid="insight"]'), ins);
      assert.ok(app.$('.kpis + [data-testid="insight"]'), 'justo debajo de las tarjetas');
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('tope pasado → alerta roja; cerca → amarilla; Más → Dinero → Topes con barras, editar y sugerencia personal', async () => {
    const db = baseDB();
    db.topes.push({ id: 't1', cat: 'Comida', limite: 50000, u: 5 }, { id: 't2', cat: 'Transporte', limite: 100000, u: 5 });
    db.gastos.push({ id: 'g1', desc: 'Almuerzos', valor: 60000, cat: 'Comida', tipo: 'personal', bolsillo: 'nequi', fecha: HOY, u: 6 });
    db.gastos.push({ id: 'g2', desc: 'Taxi', valor: 85000, cat: 'Transporte', tipo: 'personal', bolsillo: 'nequi', fecha: HOY, u: 6 });
    db.gastos.push({ id: 'g3', desc: 'Cine', valor: 400000, cat: 'Entretenimiento', tipo: 'personal', bolsillo: 'nequi', fecha: '2026-09-10', u: 6 });
    const app = await bootApp({ db, cfg: OK_CFG });
    try {
      const al = app.$$('[data-testid="tope-alerta"]');
      assert.deepEqual(al.map(a => a.dataset.estado), ['pasado', 'cerca']);
      assert.match(app.text(al[0]), /🚨 Te pasaste del tope de Comida por \$10\.000/);
      assert.match(app.text(al[1]), /⚠️ Ya gastaste el 85% de tu tope de Transporte/);
      app.click(al[0]);
      assert.ok(!app.isHidden('#topBody'));
      assert.ok(app.isHidden('#dnCheck'));
      assert.deepEqual(app.$$('#topBody [data-testid="tope"]').map(t => t.dataset.estado), ['pasado', 'cerca']);
      // sugerencia: tope de todo lo personal con el promedio de los meses anteriores (400k → $400.000)
      const sug = app.$('[data-testid="tope-sugerido"] [data-a="nuevoTope"]');
      assert.match(app.text(sug), /Crear tope personal de \$400\.000/);
      app.click(sug);
      assert.equal(app.$('#f-cat').value, '__personal'); assert.equal(app.$('#f-limite').value, '400.000');
      await guardar(app);
      assert.ok(live(app.db, 'topes').some(t => t.cat === '__personal' && t.limite === 400000));
      assert.equal(app.$('[data-testid="tope-sugerido"]'), null);
      // no deja dos topes de la misma categoría; editar el límite apaga la alerta
      app.click('[data-testid="tope-nuevo"]'); app.select('#f-cat', 'Comida'); app.type('#f-limite', '1M'); await guardar(app);
      assert.match(app.text('#toast'), /Ya tienes un tope/);
      app.click('[data-testid="form-cancel"]');
      app.click('#topBody [data-testid="tope"][data-id="t1"] [data-a="editTope"]');
      app.type('#f-limite', '200k'); await guardar(app);
      app.click('[data-testid="tab-inicio"]');
      assert.deepEqual(app.$$('[data-testid="tope-alerta"]').map(a => a.dataset.estado), ['cerca']);
      app.assertNoErrors();
    } finally { app.close(); }
  });
});

describe('ui-r5: contactos y datos del equipo', { skip: SKIP }, () => {
  test('crear contacto rápido al vender y al comprar; Más → Contactos con compras, ventas, ganancia y lo que debe', async () => {
    const db = baseDB();
    db.items.push(item('p1', 'PS5 Slim', { buyPrice: 1500000 }), item('p2', 'Xbox Series S', { buyPrice: 900000, cat: 'Consolas' }));
    const app = await bootApp({ db, cfg: OK_CFG });
    try {
      // venta de contado a Mateo (nuevo contacto)
      app.click('[data-testid="act-venta"]'); app.select('#f-itemId', 'p1'); app.type('#f-sellPrice', '1.9M');
      app.type('#f-cliente', 'mateo ríos');
      assert.ok(!app.isHidden('[data-fk="clienteNuevo"]'));
      seg(app, 'clienteNuevo', 'si');
      await guardar(app);
      const c = live(app.db, 'contactos')[0];
      assert.equal(c.nombre, 'Mateo Ríos'); assert.equal(c.tipo, 'cliente');
      const p1 = live(app.db, 'items').find(i => i.id === 'p1');
      assert.equal(p1.clienteId, c.id); assert.equal(p1.cliente, 'Mateo Ríos');
      // venta a crédito al mismo contacto: ya existe → no pregunta y queda ligado (también el cobro)
      app.click('[data-testid="act-venta"]'); app.select('#f-itemId', 'p2'); app.type('#f-sellPrice', '1.1M');
      seg(app, 'completo', 'no'); app.type('#f-sellPaid', '600k'); app.type('#f-cliente', 'Mateo rios'); app.type('#f-tel', '3001234567');
      assert.ok(app.isHidden('[data-fk="clienteNuevo"]'), 'ya es contacto');
      seg(app, 'sellPocket', 'efectivo');
      await guardar(app);
      assert.equal(live(app.db, 'cobros')[0].contactoId, c.id);
      assert.equal(live(app.db, 'contactos')[0].tel, '3001234567', 'toma el celular si no lo tenía');
      // compra a Mateo → pasa a "ambos"
      app.click('[data-testid="act-compra"]'); app.type('#f-desc', 'AirPods Pro'); app.type('#f-buyPrice', '300k'); app.type('#f-proveedor', 'Mateo Ríos');
      await guardar(app);
      assert.equal(live(app.db, 'items').find(i => i.desc === 'AirPods Pro').proveedorId, c.id);
      assert.equal(live(app.db, 'contactos')[0].tipo, 'ambos');
      // proveedor nuevo sin guardarlo: queda el texto
      app.click('[data-testid="act-compra"]'); app.type('#f-desc', 'Funda'); app.type('#f-buyPrice', '10k'); app.type('#f-proveedor', 'el man de bello');
      await guardar(app);
      const fu = live(app.db, 'items').find(i => i.desc === 'Funda');
      assert.equal(fu.proveedor, 'El Man De Bello'); assert.ok(!fu.proveedorId);
      assert.equal(live(app.db, 'contactos').length, 1);
      // Más → Contactos
      app.click('[data-testid="tab-mas"]'); app.click('#masSeg [data-seg="contactos"]');
      const card = app.$(`#ctBody [data-testid="contacto"][data-id="${c.id}"]`);
      const st = core.contactoStats(app.db, c.id);
      assert.equal(st.ventas.n, 2); assert.equal(st.compras.n, 1); assert.equal(st.debe, 500000);
      const tx = app.text(card);
      assert.match(tx, /Cliente y proveedor/); assert.match(tx, /te debe \$500K/);
      assert.match(tx, /Le compraste\s*1 · \$300K/); assert.match(tx, /Le vendiste\s*2 · \$3M/);
      app.click(app.$('[data-a="waContacto"]', card));
      assert.match(app.opened[app.opened.length - 1].url || String(app.opened[app.opened.length - 1]), /wa\.me\/573001234567/);
      app.type('#ctQ', 'zzz'); assert.equal(app.$$('#ctBody [data-testid="contacto"]').length, 0);
      app.type('#ctQ', 'mateo'); assert.equal(app.$$('#ctBody [data-testid="contacto"]').length, 1);
      // nuevo contacto desde la vista; nombre repetido no
      app.click('[data-testid="contacto-nuevo"]'); app.type('#f-nombre', 'mateo ríos'); await guardar(app);
      assert.match(app.text('#toast'), /Ya tienes un contacto/);
      app.type('#f-nombre', 'Laura'); seg(app, 'tipo', 'proveedor'); await guardar(app);
      assert.equal(live(app.db, 'contactos').length, 2);
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('Compra con "Datos del equipo" (plegable) y campos nuevos del parser; gasto con d.itemId del parser', async () => {
    const db = baseDB();
    db.items.push(item('i13', 'iPhone 13'));
    const app = await bootApp({ db, cfg: OK_CFG });
    try {
      app.click('[data-testid="act-compra"]');
      assert.ok(app.isHidden('[data-fk="imei"]'), 'plegado por defecto');
      app.click('[data-testid="f-_equipo"]');
      assert.ok(!app.isHidden('[data-fk="imei"]'));
      app.type('#f-desc', 'Galaxy S23'); app.type('#f-buyPrice', '1.4M');
      app.type('#f-bateria', '120'); await guardar(app);
      assert.match(app.text('#toast'), /batería va de 0 a 100/);
      app.type('#f-bateria', '91'); app.type('#f-almac', '256'); app.type('#f-color', 'negro'); app.type('#f-imei', '351234567890123');
      await guardar(app);
      const s23 = live(app.db, 'items').find(i => i.desc === 'Galaxy S23');
      assert.deepEqual({ b: s23.bateria, a: s23.almac, c: s23.color, i: s23.imei }, { b: 91, a: '256GB', c: 'Negro', i: '351234567890123' });
      // del parser (quick.js lo empezará a mandar): proveedor y datos del equipo → sección abierta y guardados
      app.evalInPage(`parseQuickMulti = () => [{kind:'compra', d:{desc:'iPhone 12', buyPrice:900000, buyPocket:'efectivo', proveedor:'un man de bello', bateria:89, almac:'128GB', color:'Blanco'}}];`);
      await quick(app, 'le compré un iphone 12 a un man de bello en 900 con 89% de batería');
      assert.ok(!app.isHidden('[data-fk="bateria"]'), 'con datos del parser la sección se abre sola');
      assert.equal(app.$('#f-proveedor').value, 'un man de bello');
      await guardar(app);
      const i12 = live(app.db, 'items').find(i => i.desc === 'iPhone 12');
      assert.deepEqual({ p: i12.proveedor, b: i12.bateria, a: i12.almac, c: i12.color }, { p: 'Un Man De Bello', b: 89, a: '128GB', c: 'Blanco' });
      // gasto ligado del parser
      app.evalInPage(`parseQuickMulti = () => [{kind:'gasto', d:{desc:'Arreglo', valor:50000, bolsillo:'nequi', itemId:'i13'}}];`);
      await quick(app, 'arreglo del 13 50k nequi');
      assert.equal(app.$('#f-itemId').value, 'i13');
      assert.equal(app.$('#f-tipo button.on').dataset.v, 'negocio');
      await guardar(app);
      assert.equal(live(app.db, 'gastos')[0].itemId, 'i13');
      assert.equal(core.costoItem(app.db, live(app.db, 'items').find(i => i.id === 'i13')), 1050000);
      // venta de contado con d.cliente del parser
      app.evalInPage(`parseQuickMulti = () => [{kind:'venta', d:{itemId:'i13', sellPrice:1400000, sellPocket:'nequi', cliente:'la vecina'}}];`);
      await quick(app, 'vendí el 13 a la vecina en 1.4');
      assert.equal(app.$('#f-cliente').value, 'la vecina');
      await guardar(app);
      assert.equal(live(app.db, 'items').find(i => i.id === 'i13').cliente, 'La Vecina');
      // editar: los datos del equipo se ven y se pueden borrar
      app.evalInPage(`openForm('editItem', get('items', '${s23.id}'))`);
      assert.ok(!app.isHidden('[data-fk="imei"]'));
      app.type('#f-color', ''); await guardar(app);
      assert.ok(!('color' in live(app.db, 'items').find(i => i.id === s23.id)));
      assert.ok(page(app, 'quickCtx().stock').some(x => x.id === s23.id));
      app.assertNoErrors();
    } finally { app.close(); }
  });
});
