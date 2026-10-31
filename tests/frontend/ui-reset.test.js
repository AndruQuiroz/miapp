'use strict';
// Más → Ajustes → "Empezar de cero": borra lo registrado (como borrados que viajan a la nube), deja la estructura,
// pide los saldos reales y el respaldo de antes de borrar lo deshace.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../helpers/core');
const { bootApp, e2eSkipReason } = require('../e2e/harness');
const SKIP = e2eSkipReason();

function dbConDatos() {
  const db = core.emptyDB();
  db.bolsillos = db.bolsillos.map(b => b.id === 'efectivo' ? Object.assign({}, b, { ini: 500000, u: 5 }) : b.id === 'nequi' ? Object.assign({}, b, { ini: 300000, u: 5 }) : b);
  db.items = [{ id: 'i1', desc: 'iPhone 13', cat: 'Celulares', buyPrice: 1500000, buyPocket: 'nequi', buyDate: '2026-10-01', status: 'stock', u: 10 }];
  db.gastos = [{ id: 'g1', desc: 'Almuerzo', valor: 18000, cat: 'Comida', bolsillo: 'efectivo', fecha: '2026-10-02', u: 11 }];
  db.cobros = [{ id: 'c1', nombre: 'Ana', total: 80000, pagado: 0, bolsillo: '', fecha: '2026-10-03', u: 12 }];
  db.pend = [{ id: 'p1', raw: 'Pagaste $9.900 en D1', monto: 9900, dir: 'out', fecha: '2026-10-04', u: 13 }];
  db.pedidos = [{ id: 'pe1', modelo: 'iPhone 15', cliente: 'Mateo', estado: '', u: 14 }];
  db.contactos = [{ id: 'k1', nombre: 'Ana', tipo: 'cliente', u: 15 }];
  db.reglas = [{ id: 'r1', patron: 'tienda x', cat: 'Comida', u: 16 }];
  return db;
}
const abrirReset = async app => {
  app.click('[data-testid="tab-mas"]'); app.click('#masSeg [data-seg="ajustes"]'); await app.settle();
  app.click('[data-testid="reset-abrir"]'); await app.settle();
};

describe('empezar de cero', { skip: SKIP }, () => {
  test('pide escribir BORRAR, guarda respaldo, borra movimientos y conserva bolsillos/contactos/lo aprendido', async () => {
    const app = await bootApp({ db: dbConDatos(), cfg: { onboarded: true } });
    try {
      await abrirReset(app);
      assert.match(app.text('[data-testid="reset-n"]'), /5 registros/);
      assert.equal(app.$('[data-testid="reset-ok"]').disabled, true, 'sin confirmar no deja borrar');
      app.type('[data-testid="reset-conf"]', 'borrar'); await app.settle();
      assert.equal(app.$('[data-testid="reset-ok"]').disabled, false);
      app.click('[data-testid="reset-ok"]'); await app.settle();

      // respaldo antes de borrar, con los datos completos
      const bk = app.downloads[app.downloads.length - 1];
      assert.match(bk.filename, /antes-de-borrar/);
      const txt = await app.downloads.lastText();
      assert.equal(JSON.parse(txt).items[0].id, 'i1');

      const db = app.db;
      for (const c of ['items', 'gastos', 'cobros', 'pend', 'pedidos']) {
        assert.equal(core.L(db, c).length, 0, `${c} debería quedar vacío`);
        assert.ok(db[c].every(r => r.del && r.wipe), `${c}: deben quedar como borrados (para que la nube no los devuelva)`);
      }
      assert.equal(core.L(db, 'contactos').length, 1, 'contactos se conservan por defecto');
      assert.equal(core.L(db, 'reglas').length, 1, 'lo aprendido se conserva por defecto');
      assert.ok(core.L(db, 'bolsillos').length >= 2, 'los bolsillos siguen');
      assert.deepEqual(core.balances(db), Object.fromEntries(Object.keys(core.balances(db)).map(k => [k, 0])), 'saldos en 0');

      // pide los saldos reales
      assert.equal(app.isHidden('#onbEfe'), false, 'debe preguntar cuánto tienes hoy');
      app.type('#onbEfe', '120.000'); app.type('#onbNeq', '45.000');
      app.submit('#onbForm'); await app.settle();
      const b = core.balances(app.db);
      assert.equal(b.efectivo, 120000); assert.equal(b.nequi, 45000);
      app.assertNoErrors();
    } finally { app.close(); }
  });

  test('con las casillas marcadas borra también contactos y lo aprendido', async () => {
    const app = await bootApp({ db: dbConDatos(), cfg: { onboarded: true } });
    try {
      await abrirReset(app);
      app.check('[data-testid="reset-contactos"]'); app.check('[data-testid="reset-reglas"]'); await app.settle();
      assert.match(app.text('[data-testid="reset-n"]'), /7 registros/);
      app.type('[data-testid="reset-conf"]', 'BORRAR'); app.click('[data-testid="reset-ok"]'); await app.settle();
      assert.equal(core.L(app.db, 'contactos').length, 0);
      assert.equal(core.L(app.db, 'reglas').length, 0);
    } finally { app.close(); }
  });

  test('el borrado gana al unir con la nube (no reaparecen) y lo nuevo sí queda', async () => {
    const nube = dbConDatos();
    const app = await bootApp({ db: dbConDatos(), cfg: { onboarded: true } });
    try {
      await abrirReset(app);
      app.type('[data-testid="reset-conf"]', 'BORRAR'); app.click('[data-testid="reset-ok"]'); await app.settle();
      const unido = core.mergeDB(app.db, nube);
      assert.equal(core.L(unido, 'items').length + core.L(unido, 'gastos').length + core.L(unido, 'cobros').length, 0);
    } finally { app.close(); }
  });

  test('importar el respaldo de antes de borrar lo devuelve todo (con saldos iniciales)', async () => {
    const app = await bootApp({ db: dbConDatos(), cfg: { onboarded: true } });
    try {
      const antes = core.balances(app.db);
      await abrirReset(app);
      app.type('[data-testid="reset-conf"]', 'BORRAR'); app.click('[data-testid="reset-ok"]'); await app.settle();
      const txt = await app.downloads.lastText();
      app.click('[data-a="onbBack"]'); await app.settle();          // "ahora no": cierra sin volver a la bienvenida
      assert.equal(app.isHidden('#onb'), true);
      app.window.__bk = txt;
      app.evalInPage(`importFile(new File([window.__bk], 'bk.json', {type: 'application/json'}))`);
      await app.advance(50); await app.settle(10);
      const db = app.db;
      assert.equal(core.L(db, 'items').length, 1); assert.equal(core.L(db, 'gastos').length, 1); assert.equal(core.L(db, 'pend').length, 1);
      assert.deepEqual(core.balances(db), antes);
      assert.match(app.text('body'), /respaldo restaurado/i);
    } finally { app.close(); }
  });
});
