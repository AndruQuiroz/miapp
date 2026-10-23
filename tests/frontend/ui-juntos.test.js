'use strict';
// Modo por defecto: el usuario NO separa la plata del negocio y la personal → "💵 Plata libre".
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../helpers/core');
const { bootApp, e2eSkipReason, norm } = require('../e2e/harness');
const SKIP = e2eSkipReason();
const CFG = { onboarded: true };
function baseDB() {
  const db = core.emptyDB();
  db.bolsillos = db.bolsillos.map(b => Object.assign({}, b, { ini: b.id === 'nequi' ? 3000000 : 0, u: 5 }));
  return db;
}
const quick = async (app, frase) => { app.type('#qInput', frase); app.submit('#qForm'); await app.settle(); };
const guardar = async app => { app.submit('#sheetForm'); await app.settle(); };
const dinero = (app, vista) => { app.click('[data-testid="tab-mas"]'); app.click('#masSeg [data-seg="dinero"]'); app.click(`[data-testid="dn-${vista}"]`); };

describe('plata junta (por defecto)', { skip: SKIP }, () => {
  test('sin apartados propios: no hay chip "Plata de:", ni tarjeta "Organiza", ni avisos de negocio en rojo', async () => {
    const app = await bootApp({ db: baseDB(), cfg: CFG });
    try {
      await quick(app, 'compré un 13 en 3.5 nequi');
      assert.equal(app.$('[data-testid="f-fondo-chip"]'), null, 'no debe mostrar "Plata de:"');
      await guardar(app);
      app.click('[data-testid="tab-inicio"]');
      assert.equal(app.$('[data-testid="organizar"]'), null);
      assert.equal(app.$('[data-testid="fondo-chips"]'), null);
      dinero(app, 'para');
      const t = norm(app.text('#fonBody'));
      assert.match(t, /plata libre/i);
      assert.doesNotMatch(t, /esta usando/i);
      // Plata libre = todo lo que hay (3M − 3.5M = −500K se muestra sin alarma de "negocio usando plata personal")
      assert.equal(app.$$('[data-testid="fondo-neg"]').length, 0);
    } finally { app.close(); }
  });
  test('con un apartado propio (Ahorro): Repartir desde Plata libre guarda personal→ahorro; el cuadre sigue ✅', async () => {
    const app = await bootApp({ db: baseDB(), cfg: CFG });
    try {
      dinero(app, 'para');
      app.click('[data-testid="fondo-nuevo"]'); app.type('#f-nombre', 'Ahorro'); await guardar(app);
      const ah = core.L(app.db, 'fondos').find(f => f.nombre === 'Ahorro'); assert.ok(ah);
      app.click(`[data-a="repartir"][data-fondo="__libre"]`);
      app.type('#f-monto', '200000'); await guardar(app);
      const r = core.L(app.db, 'repartos')[0];
      assert.deepEqual([r.from, r.to, r.monto], ['personal', ah.id, 200000]);
      const bf = core.balancesFondos(app.db);
      assert.equal(bf[ah.id], 200000);
      assert.equal((bf.negocio || 0) + (bf.personal || 0), 2800000);
    } finally { app.close(); }
  });
  test('el interruptor activa la separación y vuelve Negocio/Personal', async () => {
    const app = await bootApp({ db: baseDB(), cfg: CFG });
    try {
      dinero(app, 'para');
      app.click('[data-testid="toggle-separar"]'); await app.settle();
      assert.equal(app.cfg ? app.cfg.separarNP : true, true);
      const t = norm(app.text('#fonBody'));
      assert.match(t, /negocio/i); assert.match(t, /personal/i); assert.doesNotMatch(t, /plata libre/i);
    } finally { app.close(); }
  });
});
