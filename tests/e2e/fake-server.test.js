'use strict';
/**
 * Pruebas del servidor Apps Script FALSO (tests/e2e/fake-server.js). No necesitan jsdom.
 * Comprueban que el doble respeta el contrato del SPEC §5/§7 (si el doble miente, las pruebas e2e mienten).
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { NOW_MS, HOY } = require('../helpers/clock');
const core = require('../helpers/core');
const { createFakeServer } = require('./fake-server');

const KEY = 'CLAVE-DE-PRUEBA';
const EXEC = 'https://script.google.com/macros/s/AKfycbFAKE/exec';
const mk = (o = {}) => createFakeServer({ key: KEY, now: () => NOW_MS, ...o });
const post = (s, body, qs = '', headers) => s.fetch(`${EXEC}${qs}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), ...(headers ? { headers } : {}) });
const get = (s, qs) => s.fetch(`${EXEC}?${qs}`);

describe('servidor Apps Script falso: contrato del SPEC §5', () => {
  test('ping: ok con la clave; "Clave incorrecta" con otra o sin clave', async () => {
    const s = mk();
    assert.deepEqual(await (await get(s, `action=ping&key=${KEY}`)).json(), { ok: true });
    assert.deepEqual(await (await get(s, 'action=ping&key=mala')).json(), { ok: false, error: 'Clave incorrecta' });
    assert.deepEqual(await (await get(s, 'action=ping')).json(), { ok: false, error: 'Clave incorrecta' });
  });

  test('sync: mergea (gana el u mayor, tombstones) y responde {ok:true, db}', async () => {
    const s = mk({ db: { ...core.emptyDB(), gastos: [{ id: 'a', valor: 1, u: 5 }, { id: 'b', valor: 2, u: 5 }] } });
    const entrante = { ...core.emptyDB(), gastos: [{ id: 'a', valor: 99, u: 9 }, { id: 'b', del: 1, u: 8 }, { id: 'c', valor: 3, u: 1 }] };
    const j = await (await post(s, { action: 'sync', key: KEY, db: entrante })).json();
    assert.equal(j.ok, true);
    assert.deepEqual(j.db.gastos.map(g => [g.id, g.valor || null, !!g.del]).sort(), [['a', 99, false], ['b', null, true], ['c', 3, false]]);
    assert.deepEqual(s.db.gastos.length, 3);   // el servidor guardó el resultado
  });

  test('CORS: un POST con Content-Type application/json (o cabeceras propias) se RECHAZA como haría el navegador (preflight sin respuesta)', async () => {
    const s = mk();
    await assert.rejects(post(s, { action: 'sync', key: KEY, db: core.emptyDB() }, '', { 'Content-Type': 'application/json' }), TypeError);
    await assert.rejects(post(s, { action: 'sync', key: KEY, db: core.emptyDB() }, '', { 'X-Mi-Cabecera': '1' }), TypeError);
    assert.equal(s.preflightViolations, 2);
    // sin Content-Type (queda text/plain) y con text/plain explícito sí pasan
    assert.equal((await (await post(s, { action: 'sync', key: KEY, db: core.emptyDB() })).json()).ok, true);
    assert.equal((await (await post(s, { action: 'sync', key: KEY, db: core.emptyDB() }, '', { 'Content-Type': 'text/plain;charset=utf-8' })).json()).ok, true);
  });

  test('capture: POST con el texto crudo → agrega un pend (id "p…", fecha de hoy, bolsillo por parámetro); GET con ?text= también', async () => {
    const s = mk();
    const j = await (await post(s, 'Enviaste $12.000 a MARIA LOPEZ', `?action=capture&key=${KEY}&bolsillo=nequi`)).json();
    assert.deepEqual(j, { ok: true, added: true });
    const p = s.db.pend[0];
    assert.match(p.id, /^p/);
    assert.deepEqual({ monto: p.monto, dir: p.dir, quien: p.quien, fecha: p.fecha, bolsillo: p.bolsillo, u: p.u }, { monto: 12000, dir: 'out', quien: 'MARIA LOPEZ', fecha: HOY, bolsillo: 'nequi', u: NOW_MS });
    assert.equal(p.raw, 'Enviaste $12.000 a MARIA LOPEZ');
    const j2 = await (await get(s, `action=capture&key=${KEY}&bolsillo=efectivo&text=${encodeURIComponent('Recibiste $5.000 de JUAN')}`)).json();
    assert.equal(j2.added, true);
    assert.equal(s.db.pend[1].bolsillo, 'efectivo');
  });

  test('capture: monto 0 (promo, OTP, texto vacío) → added:false; el mismo texto dentro de 10 min → no se duplica; pasados 10 min sí', async () => {
    let ahora = NOW_MS;
    const s = mk({ now: () => ahora });
    const cap = t => post(s, t, `?action=capture&key=${KEY}`).then(r => r.json());
    assert.equal((await cap('Gana $20.000 invitando a un amigo')).added, false);
    assert.equal((await cap('Tu código de seguridad de Nequi es 482913')).added, false);
    assert.equal((await cap('')).added, false);
    assert.equal(s.db.pend.length, 0);
    assert.equal((await cap('Enviaste $1.000 a PRUEBA')).added, true);
    assert.equal((await cap('Enviaste $1.000 a PRUEBA')).added, false);
    ahora += 11 * 60 * 1000;
    assert.equal((await cap('Enviaste $1.000 a PRUEBA')).added, true);
    assert.equal(s.db.pend.length, 2);
  });

  test('summary y reminders: texto plano con summaryText/remindersText a la hora de la ventana; clave mala → texto de error', async () => {
    const s = mk({ db: { ...core.emptyDB(), cobros: [{ id: 'c1', nombre: 'Laura Giraldo', total: 500000, pagado: 0, compromiso: '2026-10-02', fecha: '2026-09-01', u: 1 }] } });
    const r = await get(s, `action=reminders&key=${KEY}`);
    assert.equal(r.headers.get('content-type'), 'text/plain');
    assert.match(await r.text(), /Laura/);
    assert.match(await (await get(s, `action=summary&key=${KEY}`)).text(), /Resumen|semana/i);
    assert.equal(await (await get(s, 'action=summary&key=mala')).text(), 'Clave incorrecta');
    assert.equal(await (await get(mk(), `action=reminders&key=${KEY}`)).text(), '');   // nada que avisar → ''
  });

  test('modo sin conexión y fallos programados (network, http500, busy, badjson)', async () => {
    const s = mk();
    s.offline = true;
    await assert.rejects(get(s, `action=ping&key=${KEY}`), TypeError);
    s.offline = false;
    s.failNext(1, 'http500'); assert.equal((await get(s, `action=ping&key=${KEY}`)).status, 500);
    s.failNext(1, 'busy'); assert.deepEqual(await (await get(s, `action=ping&key=${KEY}`)).json(), { ok: false, error: 'Ocupado, reintenta' });
    s.failNext(1, 'badjson'); await assert.rejects((await get(s, `action=ping&key=${KEY}`)).json());
    s.failNext(1, 'network'); await assert.rejects(get(s, `action=ping&key=${KEY}`), TypeError);
    assert.equal((await (await get(s, `action=ping&key=${KEY}`)).json()).ok, true);   // se agotaron los fallos
  });

  test('registra cada llamada (callsTo) y server.capture() simula a MacroDroid sin pasar por fetch', async () => {
    const s = mk();
    await get(s, `action=ping&key=${KEY}`);
    await post(s, { action: 'sync', key: KEY, db: core.emptyDB() });
    assert.equal(s.callsTo('ping').length, 1);
    assert.equal(s.callsTo('sync').length, 1);
    assert.equal(s.calls[1].method, 'POST');
    assert.deepEqual(s.capture('Pagaste $35.600 en RAPPI'), { ok: true, added: true });
    assert.equal(s.db.pend[0].quien, 'RAPPI');
  });
});
