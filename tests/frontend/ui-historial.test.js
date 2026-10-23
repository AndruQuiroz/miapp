'use strict';
// Historial "tipo X": movimientos agrupados por día con encabezado (Hoy / Ayer / fecha).
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../helpers/core');
const { bootApp, e2eSkipReason, norm } = require('../e2e/harness');
const SKIP = e2eSkipReason();
const HOY = require('../helpers/clock').NOW_ISO.slice(0, 10);
const AYER = core.shiftDate(HOY, -1);

describe('historial por día', { skip: SKIP }, () => {
  test('agrupa por día con encabezados Hoy/Ayer y muestra nombre y monto', async () => {
    const db = core.emptyDB();
    db.gastos = [
      { id: 'g1', desc: 'Rappi', valor: 35500, cat: 'Comida', tipo: 'personal', bolsillo: 'nequi', fecha: HOY, u: 2 },
      { id: 'g2', desc: 'Frisby', valor: 26900, cat: 'Comida', tipo: 'personal', bolsillo: 'nequi', fecha: AYER, u: 1 }
    ];
    db.ingresos = [{ id: 'i1', desc: 'Sueldo', valor: 1300000, bolsillo: 'nequi', fecha: HOY, u: 3 }];
    const app = await bootApp({ db, cfg: { onboarded: true } });
    try {
      app.click('[data-testid="tab-movs"]'); await app.settle();
      const heads = app.$$('.dia-h').map(e => norm(e.textContent));
      assert.deepEqual(heads, ['hoy', 'ayer']);
      const t = norm(app.text('#movsBody'));
      assert.match(t, /rappi/); assert.match(t, /sueldo/); assert.match(t, /frisby/);
    } finally { app.close(); }
  });
});
