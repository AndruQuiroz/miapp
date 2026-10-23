'use strict';
/**
 * ORÁCULO independiente de saldos (NO usa core.balances): un "libro mayor" donde cada movimiento
 * de plata es una fila {pocket, delta, date, kind, ref}. Se escribió desde SPEC §3, no copiando
 * core.js; sirve para (a) comparar contra core.balances (test diferencial / fuzz) y (b) verificar
 * que ningún bolsillo se queda en negativo EN NINGÚN DÍA (balancesAt), no solo al final.
 *
 *  compra con buyPocket       → −buyPrice            (fecha buyDate)
 *  venta (status sold)        → +sellPaid ?? sellPrice en sellPocket (fecha sellDate)
 *  gasto                      → −valor     ingreso → +valor     abono → +monto
 *  cobro con bolsillo         → −(total − pagado)    (préstamo: lo que salió de verdad)
 *  transfer                   → −monto en from, +monto en to
 *  ajuste                     → +delta
 *  Todo registro con del:1 se ignora; un bolsillo '' / vacío no mueve plata.
 */
function ledger(db) {
  const live = c => ((db && db[c]) || []).filter(x => x && !x.del);
  const rows = [];
  const push = (pocket, delta, date, kind, ref) => {
    if (pocket === undefined || pocket === null || pocket === '') return;
    rows.push({ pocket, delta: Number(delta) || 0, date: date || '', kind, ref });
  };
  for (const i of live('items')) {
    push(i.buyPocket, -Number(i.buyPrice), i.buyDate, 'compra', i.id);
    if (i.status === 'sold') push(i.sellPocket, (i.sellPaid === undefined || i.sellPaid === null) ? i.sellPrice : i.sellPaid, i.sellDate, 'venta', i.id);
  }
  for (const g of live('gastos')) push(g.bolsillo, -Number(g.valor), g.fecha, 'gasto', g.id);
  for (const g of live('ingresos')) push(g.bolsillo, Number(g.valor), g.fecha, 'ingreso', g.id);
  for (const a of live('abonos')) push(a.bolsillo, Number(a.monto), a.fecha, 'abono', a.id);
  for (const c of live('cobros')) if (c.bolsillo) push(c.bolsillo, -((Number(c.total) || 0) - (Number(c.pagado) || 0)), c.fecha, 'prestamo', c.id);
  for (const t of live('transfers')) { push(t.from, -Number(t.monto), t.fecha, 'transfer-sale', t.id); push(t.to, Number(t.monto), t.fecha, 'transfer-entra', t.id); }
  for (const a of live('ajustes')) push(a.bolsillo, Number(a.delta), a.fecha, 'ajuste', a.id);
  return rows;
}

/** Saldos finales según el libro mayor (incluye bolsillos con ini aunque no tengan movimientos). */
function ledgerBalances(db, upTo) {
  const b = {};
  ((db && db.bolsillos) || []).filter(p => p && !p.del).forEach(p => { b[p.id] = Number(p.ini) || 0; });
  for (const r of ledger(db)) {
    if (upTo && r.date > upTo) continue;
    b[r.pocket] = (b[r.pocket] || 0) + r.delta;
  }
  return b;
}

/** Saldos al cierre de `date` (inclusive). */
const balancesAt = (db, date) => ledgerBalances(db, date);

/**
 * Recorre día a día [from, to] y devuelve el peor (más bajo) saldo visto por bolsillo.
 * Un movimiento del mismo día se aplica completo (no se puede ordenar dentro del día sin hora).
 */
function minBalances(db, from, to) {
  const rows = ledger(db);
  const days = [...new Set(rows.map(r => r.date).filter(Boolean))].sort();
  const lo = {};
  const cur = {};
  ((db && db.bolsillos) || []).filter(p => p && !p.del).forEach(p => { cur[p.id] = Number(p.ini) || 0; lo[p.id] = cur[p.id]; });
  for (const d of days) {
    if ((from && d < from) || (to && d > to)) continue;
    for (const r of rows.filter(x => x.date === d)) cur[r.pocket] = (cur[r.pocket] || 0) + r.delta;
    for (const k of Object.keys(cur)) lo[k] = Math.min(k in lo ? lo[k] : Infinity, cur[k]);
  }
  return lo;
}

module.exports = { ledger, ledgerBalances, balancesAt, minBalances };
