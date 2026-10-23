'use strict';
/**
 * Ayudas para las pruebas en navegador REAL (Playwright + Chromium) de la app contra tests/e2e/server-mock.js.
 *
 *   loadPlaywright()      ubica `playwright` SIN instalarlo globalmente (SPEC §9). Orden: $PLAYWRIGHT_DIR (carpeta node_modules),
 *                         miapp/node_modules y el scratchpad de QA (.../scratchpad/qa/pw-deps/node_modules).
 *   browserSkipReason()   motivo para saltarse TODO si falta algo (playwright, Chromium, openssl, archivos de la app) o false.
 *   new Phone(...)        un "celular": contexto de navegador propio (localStorage, caché y service worker aparte), viewport 390x844,
 *                         móvil con táctil, es-CO, hora de Bogotá. Recoge errores de consola / pageerror / peticiones caídas y diálogos.
 *
 * Instalar (nunca global; el navegador YA está en /opt/pw-browsers, NO correr `playwright install`):
 *     mkdir -p <carpeta> && cd <carpeta> && npm init -y && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright@1.56.1 chart.js@4.4.0
 *     export PLAYWRIGHT_DIR=<carpeta>/node_modules     # (o instálalo en miapp/)
 */
require('../helpers/clock');   // TZ=America/Bogota también en este proceso (el Code.gs simulado calcula "hoy" con ella)
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_DIR = process.env.APP_DIR_E2E ? path.resolve(process.env.APP_DIR_E2E) : path.join(ROOT, 'app');
const SHOTS = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : path.join(__dirname, 'shots');
const SCRATCH_PW = '/tmp/claude-0/-home-claude/06e1c601-47b9-59d5-b935-12c557c2f42b/scratchpad/qa/pw-deps/node_modules';
const CANDIDATES = [process.env.PLAYWRIGHT_DIR, path.join(ROOT, 'node_modules'), SCRATCH_PW].filter(Boolean);

const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const flat = s => String(s == null ? '' : s).replace(/[ \t  ]+/g, ' ').replace(/\s*\n\s*/g, ' | ').trim();

let pwCache;
function loadPlaywright() {
  if (pwCache !== undefined) return pwCache;
  pwCache = null;
  for (const base of CANDIDATES) {
    for (const dir of [path.join(base, 'playwright'), base]) {
      try {
        const pkg = path.join(dir, 'package.json');
        if (fs.existsSync(pkg) && JSON.parse(fs.readFileSync(pkg, 'utf8')).name === 'playwright') { pwCache = require(dir); return pwCache; }
      } catch { /* siguiente candidato */ }
    }
  }
  return pwCache;
}

function browserSkipReason(appDir = APP_DIR) {
  const pw = loadPlaywright();
  if (!pw) return 'playwright no está instalado (ver tests/README.md, sección "Navegador real"; PLAYWRIGHT_DIR=<node_modules>)';
  let exe = '';
  try { exe = pw.chromium.executablePath(); } catch { /* sin navegador */ }
  if (!exe || !fs.existsSync(exe)) return 'no hay Chromium (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers); no corras `playwright install`';
  try { execFileSync('openssl', ['version'], { stdio: 'pipe' }); } catch { return 'falta openssl (el servidor simulado genera su certificado con él)'; }
  const falta = ['index.html', 'core.js', 'quick.js', 'app.js', 'sw.js', 'manifest.json'].filter(f => !fs.existsSync(path.join(appDir, f)));
  if (falta.length) return `la app aún no tiene: ${falta.join(', ')}`;
  if (!fs.existsSync(path.join(ROOT, 'dist', 'apps-script', 'Code.gs'))) return 'falta dist/apps-script/Code.gs (node server/build.js)';
  return false;
}

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

class Phone {
  /**
   * @param {import('playwright').Browser} browser
   * @param {object} mock  lo que devuelve startMock()
   * @param {string} name  'celular 1' (prefijo de los mensajes de error)
   */
  constructor(browser, mock, name) {
    Object.assign(this, { browser, mock, name, errors: [], ignored: [], dialogs: [], dialogAnswer: true, _allow: [] });
  }

  async init() {
    this.ctx = await this.browser.newContext({
      ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 },
      isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'es-CO', timezoneId: 'America/Bogota',
      userAgent: UA, serviceWorkers: 'allow', reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write']
    });
    // ¿alguna vez se pintó la pantalla de saldos iniciales ("¿Cuánto tienes hoy?")? (§10.3: nunca en un celular que ya usa la nube)
    await this.ctx.addInitScript(() => {
      window.__saldosShown = false;
      // historial de avisos (toasts): otro aviso (p. ej. de sincronización) puede reemplazar al esperado en milisegundos;
      // waitToast revisa todo lo que se mostró desde el último aviso encontrado, así no depende de la suerte del tiempo.
      window.__toasts = [];
      new MutationObserver(ms => {
        if (document.querySelector('#onbEfe')) window.__saldosShown = true;
        const t = document.querySelector('#toast');
        if (!t || !t.classList.contains('on')) return;
        // un aviso nuevo = toast() rearma su contenido (childList en #toast) o lo vuelve a mostrar (clase "on")
        if (ms.some(m => m.target === t)) window.__toasts.push(t.innerText);
      }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'], characterData: true });
    });
    this.page = await this.ctx.newPage();
    this.page.setDefaultTimeout(15000);
    const bad = (donde, texto) => {
      const t = `[${donde}] ${texto}`;
      if (this._allow.some(re => re.test(t))) this.ignored.push(t); else this.errors.push(t);
    };
    this.page.on('console', m => { if (m.type() === 'error') bad('console', m.text() + (m.location() && m.location().url ? ` (${m.location().url.replace(/^https:\/\/[^/]+/, '')}:${m.location().lineNumber})` : '')); });
    this.page.on('pageerror', e => bad('pageerror', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' <- ') : String(e)));
    this.page.on('requestfailed', r => bad('requestfailed', `${r.method()} ${r.url().replace(/\?.*$/, '')} ${(r.failure() || {}).errorText || ''}`));
    this.page.on('crash', () => bad('crash', 'la página se cayó'));
    this.page.on('dialog', async d => {
      this.dialogs.push({ type: d.type(), message: d.message() });
      if (this.dialogAnswer) await d.accept(); else await d.dismiss();
    });
    return this;
  }

  /** Ignora (y cuenta aparte) los errores que casen con `re` mientras dure `fn`; sirve para fases a propósito rotas (sin red, servidor caído). */
  async tolerating(re, fn) {
    this._allow.push(re);
    try { return await fn(); } finally { this._allow.splice(this._allow.indexOf(re), 1); }
  }
  assertClean(msg) { assert.deepEqual(this.errors, [], `${this.name}: ${msg || 'errores de consola / pageerror / peticiones caídas'}`); }

  async close() { try { await this.ctx.close(); } catch { /* ya cerrado */ } }

  /* ─── navegación ─── */
  async open(search = '') {
    this._toastIdx = 0;
    const resp = await this.page.goto(this.mock.appUrl + search, { waitUntil: 'load' });
    await this.page.waitForFunction(() => { const h = document.querySelector('#hdrDate'); return !!(h && h.textContent.trim()); });
    return resp;
  }
  async reload() {
    this._toastIdx = 0;
    const resp = await this.page.reload({ waitUntil: 'load' });
    await this.page.waitForFunction(() => { const h = document.querySelector('#hdrDate'); return !!(h && h.textContent.trim()); });
    return resp;
  }
  async blur() { await this.page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); }); }
  async tab(name) {
    await this.blur();
    if (name === 'cobros') {   // ronda 11: Cobros vive dentro de Plata (Te deben)
      await this.page.click('[data-testid=tab-movs]');
      await this.page.waitForSelector('#v-movs.on');
      await this.page.click('[data-testid=plata-deben]');
      await this.page.waitForSelector('#plataDeben:not([hidden])');
      return;
    }
    await this.page.click(`[data-testid=tab-${name}]`);
    await this.page.waitForSelector(`#v-${name}.on`);
  }
  /** Más > Análisis | Dinero (antes Bolsillos; abre en ¿Dónde está?) | Ajustes */
  async mas(seg) {
    await this.tab('mas');
    await this.page.click(`#masSeg button[data-seg=${seg}]`);
    await this.page.waitForSelector(`[data-mas=${seg}]:not([hidden])`);
  }

  /* ─── lectura ─── */
  async text() { return flat(await this.page.evaluate(() => document.body.innerText)); }
  async has(re, scope) {
    const t = scope ? flat(await this.page.innerText(scope)) : await this.text();
    return re instanceof RegExp ? re.test(t) : t.includes(re);
  }
  async waitText(re, timeout = 15000) {
    await this.page.waitForFunction(([src, fl]) => new RegExp(src, fl).test(document.body.innerText.replace(/[ \t  ]+/g, ' ')), [re.source, re.flags], { timeout });
  }
  async waitGone(re, timeout = 15000) {
    await this.page.waitForFunction(([src, fl]) => !new RegExp(src, fl).test(document.body.innerText.replace(/[ \t  ]+/g, ' ')), [re.source, re.flags], { timeout });
  }
  async toastText() { return flat(await this.page.evaluate(() => { const t = document.querySelector('#toast'); return t && t.classList.contains('on') ? t.innerText : ''; })); }
  async waitToast(re, timeout = 15000) {
    const from = this._toastIdx || 0;
    const h = await this.page.waitForFunction(([src, fl, i0]) => {
      const L = window.__toasts || [], rx = new RegExp(src, fl);
      for (let i = Math.min(i0, L.length); i < L.length; i++) if (rx.test(L[i])) return { i, txt: L[i] };
      return false;
    }, [re.source, re.flags, from], { timeout });
    const { i, txt } = await h.jsonValue();
    this._toastIdx = i + 1;
    return flat(txt);
  }
  async syncLabel() { return flat(await this.page.textContent('#syncBtn')); }
  async waitSync(label, timeout = 15000) {
    await this.page.waitForFunction(l => document.querySelector('#syncBtn').textContent.trim() === l, label, { timeout });
  }
  /** bolsillos de Inicio: {Efectivo:'$450.000', Nequi:'…'} */
  async pocketChips() {
    return this.page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#inicioBody .pock')].filter(b => b.querySelector('b') && b.dataset.id)
      .map(b => [b.querySelector('small').textContent.trim(), b.querySelector('b').textContent.trim()])));
  }
  /** las 4 tarjetas de Inicio: {'Caja hoy': {val, sub}, …} */
  async kpis() {
    return this.page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#inicioBody .kpis .card')].map(c =>
      [c.querySelector('.lbl').textContent.trim(), { val: c.querySelector('.val').textContent.trim(), sub: (c.querySelector('.sub') || { textContent: '' }).textContent.trim() }])));
  }

  /* ─── almacenamiento de la app ─── */
  async ls(key) { return this.page.evaluate(k => localStorage.getItem(k), key); }
  async db() { const s = await this.ls('miapp_db_v2'); return s ? JSON.parse(s) : null; }
  async cfg() { const s = await this.ls('miapp_cfg'); return s ? JSON.parse(s) : null; }

  /* ─── formulario (hoja inferior) ─── */
  async sheetOpen() { return this.page.evaluate(() => document.querySelector('#sheet').classList.contains('on')); }
  async waitSheet(open = true) { await this.page.waitForFunction(o => document.querySelector('#sheet').classList.contains('on') === o, open); }
  /** {title, v:{campo: valor}, visible:[campos visibles]}: para los campos tipo botones (seg) el valor es el data-v activo */
  async form() {
    return this.page.evaluate(() => {
      const v = {}, visible = [];
      document.querySelectorAll('#sheetBody .fld[data-fk]').forEach(w => {
        const k = w.dataset.fk;
        if (!w.hidden) visible.push(k);
        const el = w.querySelector('#f-' + k);
        if (!el) return;
        if (el.classList.contains('opts')) { const on = el.querySelector('button.on'); v[k] = on ? on.dataset.v : null; } else v[k] = el.value;
      });
      return { title: document.querySelector('#sheetTitle').textContent.trim(), v, visible };
    });
  }
  async setField(k, value, { typing = false } = {}) {
    const sel = '#f-' + k;
    const info = await this.page.evaluate(s => { const el = document.querySelector(s); return el ? { tag: el.tagName, opts: el.classList.contains('opts') } : null; }, sel);
    assert.ok(info, `${this.name}: el formulario no tiene el campo ${k}`);
    if (info.opts) await this.page.click(`${sel} button[data-v="${value}"]`);
    else if (info.tag === 'SELECT') await this.page.selectOption(sel, String(value));
    else if (typing) { await this.page.click(sel); await this.page.fill(sel, ''); await this.page.locator(sel).pressSequentially(String(value)); }
    else await this.page.fill(sel, String(value));
  }
  async save() {
    await this.page.click('[data-testid=form-save]');
    await this.waitSheet(false);
  }
  /** escribe en la barra de registro rápido y toca ➤ → queda el formulario prellenado abierto */
  async quick(texto) {
    await this.tab('inicio');
    await this.page.fill('[data-testid=quick-input]', texto);
    await this.page.click('[data-testid=quick-go]');
    await this.waitSheet(true);
    return this.form();
  }

  /* ─── sincronización ─── */
  /** toca el indicador del header (sync manual) y espera a que el servidor reciba un sync nuevo y el indicador diga "Al día" */
  async syncNow() {
    const antes = this.mock.calls('sync').length;
    await this.page.click('#syncBtn');
    await this.page.waitForFunction(() => document.querySelector('#syncBtn').textContent.trim() === 'Al día');
    assert.ok(this.mock.calls('sync').length > antes, `${this.name}: el toque en el indicador no llegó al servidor`);
  }

  /* ─── capturas ─── */
  /** full: pantalla completa. Se agranda el viewport hasta el alto de la página (no `fullPage`, que dibuja el header y la barra fijos a media imagen) */
  async shot(name, { full = false } = {}) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const vp = this.page.viewportSize();
    let grown = false;
    if (full) {
      const h = Math.min(4200, await this.page.evaluate(() => Math.ceil(document.documentElement.scrollHeight)));
      if (h > vp.height) { await this.page.setViewportSize({ width: vp.width, height: h }); grown = true; }
    }
    await this.page.waitForTimeout(150);
    const file = path.join(SHOTS, name + '.png');
    await this.page.screenshot({ path: file });
    if (grown) await this.page.setViewportSize(vp);
    return file;
  }
}

/** espera (sondeando) hasta que fn() sea verdadero; si no, falla con `msg`. Para estados del servidor. */
async function until(fn, { timeout = 12000, every = 100, msg = 'condición no cumplida' } = {}) {
  const fin = Date.now() + timeout;
  let last;
  for (;;) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    if (Date.now() > fin) assert.fail(`${msg} (esperé ${timeout} ms)${last instanceof Error ? ': ' + last.message : ''}`);
    await new Promise(r => setTimeout(r, every));
  }
}

module.exports = { loadPlaywright, browserSkipReason, Phone, until, norm, flat, APP_DIR, SHOTS, ROOT, CANDIDATES };
