'use strict';
/**
 * Harness e2e (FASE 2) con jsdom: carga app/index.html + core.js + quick.js + app.js EN ESE ORDEN, igual que el navegador,
 * pero con todo lo externo controlado por la prueba:
 *
 *   const { bootApp, jsdomAvailable, appFiles } = require('./harness');
 *   const app = await bootApp({ db: demoDB, cfg: { url, key, onboarded: true }, server });
 *   app.click('#tab-stock'); app.type('#q', 'compré ps5 1.2M nequi'); await app.advance(1500);
 *   assert.equal(app.server.callsTo('sync').length, 1);
 *   app.close();
 *
 * Qué simula (ver stubs.js / fake-clock.js / fake-server.js):
 *   · origen https://usuario.github.io/miapp/ (SPEC §10.1: rutas relativas; así localStorage y serviceWorker "existen")
 *   · reloj falso (hoy = 2026-10-05 10:00 Bogotá, TZ fija del proceso): setTimeout/setInterval/Date/requestAnimationFrame
 *   · fetch → servidor Apps Script falso (con CORS realista); sin servidor: fetch rechaza ("sin señal")
 *   · localStorage sembrado ANTES de los scripts (miapp_db_v2, miapp_cfg)
 *   · Chart (o ausente), webkitSpeechRecognition (o ausente), serviceWorker, portapapeles, alert/confirm/prompt, window.open,
 *     descargas (<a download>), onLine/online/offline, visibilitychange
 * Los scripts externos (https://…) NUNCA se descargan: Chart.js se reemplaza por el stub.
 * Los scripts de la página se ejecutan en el orden del HTML; si uno lanza, se registra en app.errors y se sigue (como un navegador).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { NOW_ISO } = require('../helpers/clock');
const { loadJSDOM } = require('./jsdom-loader');
const { FakeClock } = require('./fake-clock');
const { installStubs } = require('./stubs');

const ROOT = path.resolve(__dirname, '../..');
const APP_DIR = path.join(ROOT, 'app');
const BASE_URL = 'https://usuario.github.io/miapp/';

const jsdomAvailable = () => !!loadJSDOM();

/** ¿Están los archivos de la app terminada? (para que las pruebas e2e se salten solas mientras el Frontend escribe) */
function appFiles(dir = APP_DIR) {
  const need = ['index.html', 'core.js', 'quick.js', 'app.js'];
  const missing = need.filter(f => !fs.existsSync(path.join(dir, f)));
  return { dir, ok: missing.length === 0, missing };
}
/** Razón de salto (string) o false si se puede correr. */
function e2eSkipReason(dir = APP_DIR) {
  if (!jsdomAvailable()) return 'jsdom no está instalado (ver tests/README.md → "FASE 2: e2e con jsdom")';
  const f = appFiles(dir);
  return f.ok ? false : `la app aún no está completa (faltan en ${path.relative(ROOT, dir) || '.'}: ${f.missing.join(', ')})`;
}

const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

async function bootApp(o = {}) {
  const JSDOM = loadJSDOM();
  if (!JSDOM) throw new Error('jsdom no está disponible');
  const { JSDOM: JSDOMClass, VirtualConsole } = JSDOM;
  const appDir = o.appDir || APP_DIR;
  const htmlFile = o.html || 'index.html';
  const extraDirs = [appDir, APP_DIR, ...(o.extraDirs || [])];
  const html = fs.readFileSync(path.join(appDir, htmlFile), 'utf8');

  const clock = new FakeClock(o.now || NOW_ISO);
  const vc = new VirtualConsole();
  const jsdomErrors = [];
  vc.on('jsdomError', e => { if (!/Not implemented: (navigation|window\.(scroll|alert|confirm|prompt|open))/i.test(String(e && e.message))) jsdomErrors.push(String(e && e.stack || e)); });

  const dom = new JSDOMClass(html, {
    url: BASE_URL + (o.search || ''), runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc, storageQuota: 10_000_000,
  });
  const { window } = dom;
  const document = window.document;
  clock.install(window);

  const ctl = installStubs(window, clock, o);
  if (o.globals) Object.assign(window, typeof o.globals === 'function' ? o.globals(window) : o.globals);   // p. ej. window.MiAppNativo (app de Android)
  clock.onError = e => ctl.errors.push({ type: 'timer', message: String(e && e.stack || e) });

  /* localStorage sembrado antes de los scripts */
  if (o.db) window.localStorage.setItem('miapp_db_v2', typeof o.db === 'string' ? o.db : JSON.stringify(o.db));
  if (o.cfg) window.localStorage.setItem('miapp_cfg', typeof o.cfg === 'string' ? o.cfg : JSON.stringify(o.cfg));
  if (o.storage) for (const [k, v] of Object.entries(o.storage)) window.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));

  /* red */
  const server = o.server || null;
  if (server) server.now = () => clock.now;
  const fetchLog = [];
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    fetchLog.push({ url, init, at: clock.now });
    if (!ctl.net.online) return Promise.reject(new window.TypeError('Failed to fetch'));
    if (!server) return Promise.reject(new window.TypeError('Failed to fetch'));
    return server.fetch(url, init).catch(e => { throw new window.TypeError(String(e && e.message || 'Failed to fetch')); });
  };

  /* scripts en orden del HTML */
  const ctx = dom.getInternalVMContext();
  const ran = [];
  const resolveSrc = src => {
    const clean = src.split('#')[0].split('?')[0].replace(/^\.\//, '');
    for (const d of extraDirs) { const p = path.join(d, clean); if (fs.existsSync(p)) return p; }
    return null;
  };
  for (const s of Array.from(document.querySelectorAll('script'))) {
    const type = (s.getAttribute('type') || '').toLowerCase();
    if (type === 'module') { ctl.errors.push({ type: 'harness', message: 'script type=module: SPEC §6.6 pide scripts clásicos (core.js → quick.js → app.js)' }); continue; }
    if (type && !/javascript|ecmascript/.test(type)) continue;   // JSON-LD, plantillas, etc.
    const src = s.getAttribute('src');
    let code, file;
    if (src) {
      if (/^(https?:)?\/\//i.test(src)) { ran.push({ src, skipped: 'remoto (no se descarga)' }); continue; }
      if (src.startsWith('/')) ctl.errors.push({ type: 'harness', message: `ruta absoluta "${src}": en GitHub Pages /miapp/ debe ser relativa (SPEC §10.1)` });
      const p = resolveSrc(src);
      if (!p) { ctl.errors.push({ type: 'harness', message: `no existe el script ${src}` }); ran.push({ src, missing: true }); continue; }
      code = fs.readFileSync(p, 'utf8'); file = path.relative(ROOT, p);
    } else { code = s.textContent; file = `${htmlFile}#inline${ran.length}`; }
    try { new vm.Script(code, { filename: file }).runInContext(ctx); ran.push({ src: src || '(inline)', file }); }
    catch (e) { ctl.errors.push({ type: 'script', message: `${file}: ${e && e.stack || e}` }); ran.push({ src: src || '(inline)', file, error: true }); }
  }

  /* ayudas de DOM y de tiempo */
  const settle = async (rounds = 4) => { for (let i = 0; i < rounds; i++) await new Promise(r => setImmediate(r)); };
  const $ = (sel, root = document) => (typeof sel === 'string' ? root.querySelector(sel) : sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const must = (sel, what = 'click') => { const el = $(sel); if (!el) throw new Error(`${what}: no existe ${typeof sel === 'string' ? sel : '(elemento)'}`); return el; };
  const text = (el = document.body) => (typeof el === 'string' ? must(el, 'text') : el).textContent.replace(/\s+/g, ' ').trim();
  /** Elemento más profundo cuyo texto contiene `t` (sin tildes ni mayúsculas); `within` limita la búsqueda. */
  const byText = (t, within = 'body *') => {
    const n = norm(t);
    const els = $$(within).filter(e => norm(e.textContent).includes(n));
    return els.filter(e => !Array.from(e.children).some(c => norm(c.textContent).includes(n)))[0] || null;
  };
  const fire = (el, type, init = {}) => el.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true, ...init }));
  const app = {
    window, document, dom, clock, server, ctl, ran, fetchLog, jsdomErrors,
    errors: ctl.errors, chart: ctl.chart, speech: ctl.speech, sw: ctl.sw, clipboard: ctl.clipboard, dialogs: ctl.dialogs,
    opened: ctl.opened, downloads: ctl.downloads, navigations: ctl.navigations, net: ctl.net, page: ctl.page, logs: ctl.logs,
    $, $$, text, byText, settle, fire,
    click(sel) { const el = must(sel); el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window })); return el; },
    type(sel, value) { const el = must(sel, 'type'); el.focus(); el.value = value; fire(el, 'input'); fire(el, 'change'); return el; },
    select(sel, value) { const el = must(sel, 'select'); el.value = value; fire(el, 'change'); return el; },
    check(sel, on = true) { const el = must(sel, 'check'); el.checked = !!on; fire(el, 'input'); fire(el, 'change'); return el; },
    key(sel, key, init = {}) { const el = must(sel, 'key'); for (const t of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new window.KeyboardEvent(t, { key, bubbles: true, cancelable: true, ...init })); return el; },
    submit(sel) { const el = must(sel, 'submit'); el.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); return el; },
    isHidden(sel) { let el = must(sel, 'isHidden'); while (el && el.nodeType === 1) { const cs = window.getComputedStyle(el); if (el.hidden || cs.display === 'none' || cs.visibility === 'hidden') return true; el = el.parentElement; } return false; },
    /** Avanza el reloj falso `ms` y deja que las promesas pendientes (fetch falso, async/await de la app) terminen. */
    async advance(ms = 0) { clock.advance(ms); await settle(); },
    /** Deja pasar los temporizadores pendientes hasta `max` ms (útil tras "guardar": debounce de 1,5 s + sync). */
    async idle(max = 3000) { await settle(); await app.advance(max); await settle(); },
    /** localStorage como objetos. */
    get db() { const v = window.localStorage.getItem('miapp_db_v2'); return v ? JSON.parse(v) : null; },
    get cfg() { const v = window.localStorage.getItem('miapp_cfg'); return v ? JSON.parse(v) : null; },
    /** Evalúa una expresión DENTRO de la página (acceso a los `const`/`let` globales de app.js: DB, render…). */
    evalInPage(code) { return new vm.Script(code, { filename: 'evalInPage' }).runInContext(ctx); },
    /** Falla si hubo errores no controlados (script, timer, promesa rechazada, console.error). */
    assertNoErrors() { if (ctl.errors.length || jsdomErrors.length) throw new Error('errores en la página:\n' + [...ctl.errors.map(e => `[${e.type}] ${e.message}`), ...jsdomErrors.map(e => `[jsdom] ${e}`)].join('\n')); },
    close() { try { window.close(); } catch { /* ya cerrada */ } },
  };

  await settle();   // DOMContentLoaded / load
  if (o.idle !== false) await app.advance(0);
  return app;
}

module.exports = { bootApp, jsdomAvailable, appFiles, e2eSkipReason, APP_DIR, BASE_URL, ROOT, norm };
