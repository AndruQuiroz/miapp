'use strict';
/**
 * Apps Script Web App FALSO (SPEC §5 y §7) para las pruebas e2e: mismo contrato que server/server.gs, construido sobre el
 * MISMO core.js (mergeDB, parseNoti, summaryText, remindersText). No hace red: createFakeServer().fetch(url, init) devuelve
 * una promesa con una respuesta tipo Response.
 *
 *   const server = createFakeServer({ key: 'K', db: demoDB, now: () => clock.now });
 *   window.fetch = server.fetch;
 *
 * Reproduce a propósito lo que haría el navegador de verdad:
 *  - CORS: un POST con Content-Type distinto de text/plain / x-www-form-urlencoded / multipart, o con cabeceras propias,
 *    dispararía un preflight que Apps Script NO contesta → aquí el fetch RECHAZA con TypeError('Failed to fetch') y se
 *    cuenta en server.preflightViolations (SPEC §5: "SIN poner Content-Type JSON").
 *  - Modo sin conexión (server.offline = true) y fallos programados (server.failNext(2, 'network'|'http500'|'busy'|'badjson')).
 *  - Clave mala → {ok:false, error:'Clave incorrecta'} (SPEC §10.7).
 *  - capture: monto 0 → added:false; dedup del mismo texto en 10 min; pend con id 'p…', fecha=today() y bolsillo por parámetro.
 */
const core = require('../helpers/core');
const { withNow } = require('../helpers/clock');

const SIMPLE_CT = /^(text\/plain|application\/x-www-form-urlencoded|multipart\/form-data)\b/i;
const SIMPLE_HEADERS = new Set(['accept', 'accept-language', 'content-language', 'content-type']);

function createFakeServer(opts = {}) {
  const state = {
    key: opts.key || 'CLAVE1234567890X',
    db: opts.db ? JSON.parse(JSON.stringify(opts.db)) : core.emptyDB(),
    now: opts.now || (() => Date.now()),
    calls: [],              // {method, action, url, headers, body, at}
    offline: false,
    preflightViolations: 0,
    _fail: [],              // fallos programados
    _seq: 0,
  };

  const resp = (status, body, type) => ({
    ok: status >= 200 && status < 300, status, statusText: status === 200 ? 'OK' : 'Error', redirected: false, type: 'cors', url: '',
    headers: { get: k => (String(k).toLowerCase() === 'content-type' ? type : null), has: k => String(k).toLowerCase() === 'content-type' },
    text: async () => body,
    json: async () => JSON.parse(body),
    clone() { return resp(status, body, type); },
  });
  const json = (o, status = 200) => resp(status, JSON.stringify(o), 'application/json');
  const text = (s) => resp(200, String(s), 'text/plain');

  const dateOf = ms => core.ymd(new Date(ms));            // TZ del proceso = America/Bogota (helpers/clock)
  const asNow = fn => withNow(state.now(), fn);           // core.today()/summaryText usan new Date(): congelado a la hora de la ventana

  function capture(raw, bolsillo) {
    raw = String(raw || '').trim();
    const r = core.parseNoti(raw);
    if (!raw || !r.monto) return { ok: true, added: false };
    const now = state.now();
    const dup = (state.db.pend || []).some(p => p.raw === raw && now - (p.u || 0) < 10 * 60 * 1000);
    if (dup) return { ok: true, added: false };
    state.db.pend.push({ id: 'p' + now.toString(36) + (++state._seq).toString(36), raw, monto: r.monto, dir: r.dir, quien: r.quien, fecha: dateOf(now), bolsillo: bolsillo || 'nequi', u: now });
    return { ok: true, added: true };
  }

  function handle(urlStr, init = {}) {
    const url = new URL(urlStr, 'https://script.google.com/macros/s/FAKE/exec');
    const method = String(init.method || 'GET').toUpperCase();
    const headers = {};
    const h = init.headers;
    if (h && typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => { headers[String(k).toLowerCase()] = String(v); });   // Headers / Map
    else if (Array.isArray(h)) for (const [k, v] of h) headers[String(k).toLowerCase()] = String(v);
    else if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);
    const body = init.body == null ? '' : String(init.body);
    const call = { method, url: url.href, headers, body, action: url.searchParams.get('action') || '', at: state.now() };
    state.calls.push(call);

    // CORS: ¿habría preflight?
    if (method === 'POST') {
      const ct = headers['content-type'];
      const raro = Object.keys(headers).filter(h => !SIMPLE_HEADERS.has(h));
      if ((ct && !SIMPLE_CT.test(ct)) || raro.length) { state.preflightViolations++; call.preflight = true; return Promise.reject(new TypeError('Failed to fetch')); }
    }
    if (state.offline) return Promise.reject(new TypeError('Failed to fetch'));
    const f = state._fail.shift();
    if (f) {
      if (f === 'network') return Promise.reject(new TypeError('Failed to fetch'));
      if (f === 'http500') return Promise.resolve(resp(500, 'Internal Server Error', 'text/html'));
      if (f === 'badjson') return Promise.resolve(resp(200, '<html>Error de Google</html>', 'text/html'));
      if (f === 'busy') return Promise.resolve(json({ ok: false, error: 'Ocupado, reintenta' }));
    }

    let action = call.action, key = url.searchParams.get('key'), payload = null;
    if (method === 'POST' && action !== 'capture') {
      try { payload = JSON.parse(body); } catch { return Promise.resolve(json({ ok: false, error: 'Solicitud inválida' })); }
      action = payload.action || action; key = payload.key != null ? payload.key : key;
    }
    const isText = action === 'summary' || action === 'reminders';
    const fail = msg => Promise.resolve(isText ? text(msg) : json({ ok: false, error: msg }));
    if (key !== state.key) return fail('Clave incorrecta');

    switch (action) {
      case 'ping': return Promise.resolve(json({ ok: true }));
      case 'sync': {
        if (!payload || typeof payload.db !== 'object') return fail('Falta db');
        state.db = core.mergeDB(state.db, payload.db);
        return Promise.resolve(json({ ok: true, db: state.db }));
      }
      case 'capture': {
        const raw = method === 'POST' ? body : url.searchParams.get('text');
        return Promise.resolve(json(capture(raw, url.searchParams.get('bolsillo'))));
      }
      case 'summary': return Promise.resolve(text(asNow(() => core.summaryText(state.db))));
      case 'reminders': return Promise.resolve(text(asNow(() => core.remindersText(state.db))));
      default: return fail('Acción desconocida');
    }
  }

  const server = {
    get db() { return state.db; },
    set db(v) { state.db = v; },
    get key() { return state.key; },
    get calls() { return state.calls; },
    get preflightViolations() { return state.preflightViolations; },
    get offline() { return state.offline; },
    set offline(v) { state.offline = !!v; },
    set now(fn) { state.now = fn; },
    fetch: (u, i) => handle(String(u), i),
    /** Programa los próximos n pedidos para que fallen: 'network' | 'http500' | 'busy' | 'badjson'. */
    failNext(n = 1, modo = 'network') { for (let i = 0; i < n; i++) state._fail.push(modo); },
    /** Simula a MacroDroid mandando una notificación (sin pasar por fetch ni por CORS). */
    capture: (raw, bolsillo) => capture(raw, bolsillo),
    callsTo: action => state.calls.filter(c => c.action === action || (c.method === 'POST' && c.body.includes(`"action":"${action}"`))),
    reset() { state.calls.length = 0; state._fail.length = 0; state.preflightViolations = 0; },
  };
  return server;
}

module.exports = { createFakeServer };
