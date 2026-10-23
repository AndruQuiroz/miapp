'use strict';
// Pantallazo de movimientos → lista clasificada → Guardar todo.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../helpers/core');
const { bootApp, e2eSkipReason, norm } = require('../e2e/harness');
const SKIP = e2eSkipReason();
const CFG = { onboarded: true };
const TXT = `Saldo disponible $ 1.000.000,00
Hoy
Pago en D1 -$ 45.300,00
Para JUAN PEREZ -$ 1.900.000,00
De CAMILO RAMIREZ $ 600.000,00
Pago en UBER -$ 18.500,00`;

async function leer(app, texto) {
  app.window.leerImagenes = async () => ({ imeis: [], texto });
  app.window.ocrPick('movs');
  await app.window.ocrRun([{ name: 'x.png' }]);
  await app.settle();
}
describe('pantallazo de movimientos', { skip: SKIP }, () => {
  test('clasifica, marca lo repetido y guarda todo de un toque', async () => {
    const db = core.emptyDB();
    db.bolsillos = db.bolsillos.map(b => Object.assign({}, b, { ini: b.id === 'nequi' ? 2000000 : 0, u: 5 }));
    db.cobros = [{ id: 'c1', nombre: 'Camilo Ramírez', total: 1000000, pagado: 0, bolsillo: '', fecha: '2026-10-01', u: 1 }];
    db.gastos = [{ id: 'g1', desc: 'uber', valor: 18500, cat: 'Transporte', tipo: 'personal', bolsillo: 'nequi', fecha: require('../helpers/clock').NOW_ISO.slice(0, 10), u: 1 }];
    const app = await bootApp({ db, cfg: CFG });
    try {
      assert.ok(app.$('[data-testid="quick-foto"]'));
      await leer(app, TXT);
      assert.equal(app.$$('[data-testid="movs-row"]').length, 4);
      assert.match(norm(app.text('[data-testid="movs-resumen"]')), /1 ya estaba/);
      assert.match(norm(app.text('[data-testid="movs-save"]')), /guardar 3/);
      app.click('[data-testid="movs-save"]'); await app.settle();
      const d = app.db;
      const g = core.L(d, 'gastos').filter(x => x.id !== 'g1');
      assert.equal(g.length, 1); assert.equal(g[0].cat, 'Comida'); assert.equal(g[0].valor, 45300);
      assert.equal(core.L(d, 'abonos')[0].monto, 600000);
      assert.equal(core.L(d, 'pend')[0].monto, 1900000);
    } finally { app.close(); }
  });
  test('cambiar lo que fue con el selector', async () => {
    const app = await bootApp({ db: core.emptyDB(), cfg: CFG });
    try {
      await leer(app, 'Hoy\nPara JUAN PEREZ -$ 120.000');
      const sel = app.$('[data-testid="movs-sel"]');
      sel.value = 'gasto:Envíos'; sel.dispatchEvent(new app.window.Event('change', { bubbles: true }));
      app.click('[data-testid="movs-save"]'); await app.settle();
      const g = core.L(app.db, 'gastos')[0];
      assert.equal(g.cat, 'Envíos'); assert.equal(g.tipo, 'negocio');
    } finally { app.close(); }
  });
  test('foto sin movimientos avisa', async () => {
    const app = await bootApp({ db: core.emptyDB(), cfg: CFG });
    try {
      await leer(app, 'hola mundo');
      assert.equal(app.$$('[data-testid="movs-row"]').length, 0);
    } finally { app.close(); }
  });
});

describe('clasificar todos los "Por clasificar"', { skip: SKIP }, () => {
  const HOY = require('../helpers/clock').NOW_ISO.slice(0, 10);
  const base = () => {
    const db = core.emptyDB();
    db.pend = [
      { id: 'p1', raw: 'O) DISTRACOM APOLO -$10000', monto: 10000, dir: 'out', quien: 'O) Distracom Apolo', fecha: HOY, bolsillo: 'nequi', u: 1 },
      { id: 'p2', raw: 'O) JUAN CARLOS GALLEGO -$7000', monto: 7000, dir: 'out', quien: 'O) Juan Carlos Gallego', fecha: HOY, bolsillo: 'nequi', u: 1 },
      { id: 'p3', raw: 'Retiro en cajero -$200000', monto: 200000, dir: 'out', quien: 'Retiro en cajero', fecha: HOY, bolsillo: 'nequi', u: 1 }
    ];
    db.gastos = [{ id: 'g1', desc: 'algo', valor: 7000, cat: 'Comida', tipo: 'personal', bolsillo: 'nequi', fecha: HOY, u: 1 }];
    return db;
  };
  test('sin IA: gasolina → Transporte, repetido → se quita, retiro → efectivo; aprende el nombre', async () => {
    const app = await bootApp({ db: base(), cfg: CFG });
    try {
      app.click('[data-testid="pend-todos"]'); await app.settle();
      assert.equal(app.$$('[data-testid="movs-row"]').length, 3);
      assert.doesNotMatch(app.text('#sheetBody'), /O\) /);
      app.click('[data-testid="movs-save"]'); await app.settle();
      const d = app.db;
      assert.equal(core.L(d, 'pend').length, 0);
      const g = core.L(d, 'gastos').find(x => x.valor === 10000); assert.equal(g.cat, 'Transporte'); assert.equal(g.desc, 'Distracom Apolo');
      assert.deepEqual(core.L(d, 'transfers').map(t => [t.from, t.to, t.monto]), [['nequi', 'efectivo', 200000]]);
      assert.ok(core.L(d, 'reglas').some(r => r.id === 'distracom apolo' && r.cat === 'Transporte'));
    } finally { app.close(); }
  });
  test('con IA: revisa lo dudoso y muestra lo que corrigió', async () => {
    const db = base(); db.gastos = [];
    const app = await bootApp({ db, cfg: Object.assign({ iaKey: 'K' }, CFG) });
    try {
      let vio;
      app.window.iaRevisarMovs = async (lista) => { vio = lista; const out = lista.map(m => Object.assign({}, m)); const j = out.findIndex(m => /juan/i.test(m.desc)); out[j].accion = 'gasto'; out[j].cat = 'Comida'; out[j].ia = true; out[j].porQue = '🧠 almuerzo'; out.cambios = 1; return { lista: out }; };
      app.click('[data-testid="pend-todos"]'); await app.settle(); await app.advance(10);
      assert.ok(vio && vio.length === 3);
      assert.match(norm(app.text('[data-testid="movs-ia"]')), /corrigio 1/);
      app.click('[data-testid="movs-save"]'); await app.settle();
      assert.equal(core.L(app.db, 'gastos').find(x => x.valor === 7000).cat, 'Comida');
    } finally { app.close(); }
  });
});
