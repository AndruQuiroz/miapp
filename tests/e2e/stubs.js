'use strict';
/**
 * Stubs de las APIs del navegador que jsdom no trae (o que no queremos que hagan de verdad).
 * installStubs(window, clock, opts) los instala ANTES de que corran los scripts de la app y devuelve los
 * "controles" con los que la prueba mira lo que pasó o dispara eventos:
 *
 *   chart       → window.Chart falso. chart.instances[i] = {type, data, options, destroyed, updates}
 *   speech      → webkitSpeechRecognition falso. speech.say('compré ps5 1.2M nequi'), speech.fail('not-allowed')
 *   sw          → navigator.serviceWorker falso. sw.registrations = [{url, options}]
 *   clipboard   → navigator.clipboard.writeText + document.execCommand('copy'). clipboard.text
 *   dialogs     → alert/confirm/prompt. dialogs.confirmAnswers.push(false) para contestar; dialogs.log = [...]
 *   opened      → window.open(url) guardado (WhatsApp wa.me, etc.)
 *   downloads   → <a download>.click() + URL.createObjectURL: [{filename, href, blobText}]
 *   navigations → "navegaciones" que jsdom no implementa (anchors con href): [href]
 *   net         → net.setOnline(false) cambia navigator.onLine y dispara el evento 'offline'/'online'
 *   page        → page.setVisible(false) cambia document.visibilityState y dispara 'visibilitychange'
 *   errors      → window.onerror / unhandledrejection / console.error: [{type, message}]
 */

function installStubs(window, clock, opts = {}) {
  const ctl = { errors: [], opened: [], downloads: [], navigations: [], logs: [] };
  const document = window.document, navigator = window.navigator;
  const def = (obj, k, v) => Object.defineProperty(obj, k, { value: v, configurable: true, writable: true });

  /* ── errores y consola ── */
  window.addEventListener('error', e => ctl.errors.push({ type: 'error', message: String((e.error && e.error.stack) || e.message) }));
  window.addEventListener('unhandledrejection', e => ctl.errors.push({ type: 'unhandledrejection', message: String(e.reason && e.reason.stack || e.reason) }));
  for (const lvl of ['error', 'warn', 'log', 'info']) {
    const orig = window.console[lvl].bind(window.console);
    window.console[lvl] = (...a) => {
      ctl.logs.push({ level: lvl, args: a });
      if (lvl === 'error') ctl.errors.push({ type: 'console.error', message: a.map(String).join(' ') });
      if (opts.echoConsole) orig(...a);
    };
  }

  /* ── Chart.js falso (o ausente: chart:'absent' prueba que la app no se cae sin CDN) ── */
  ctl.chart = { instances: [] };
  if (opts.chart !== 'absent') {
    class Chart {
      constructor(ctx, cfg) { this.ctx = ctx; this.config = cfg; this.type = cfg && cfg.type; this.data = cfg && cfg.data; this.options = cfg && cfg.options; this.destroyed = false; this.updates = 0; ctl.chart.instances.push(this); }
      update() { this.updates++; } destroy() { this.destroyed = true; } resize() {} render() {}
      static register() {} static getChart() { return undefined; }
    }
    Chart.defaults = { font: {}, color: '', plugins: { legend: { labels: {} }, tooltip: {} }, scale: {}, scales: {} };
    window.Chart = Chart;
    // canvas.getContext no existe en jsdom sin el paquete canvas: devolvemos un contexto mudo
    window.HTMLCanvasElement.prototype.getContext = function () { return new Proxy({}, { get: (t, k) => (k === 'canvas' ? this : () => ({ addColorStop() {} })), set: () => true }); };
  }

  /* ── dictado: webkitSpeechRecognition ── */
  ctl.speech = { instances: [], supported: opts.speech !== false };
  if (opts.speech !== false) {
    class SpeechRecognition {
      constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; this.maxAlternatives = 1; this.started = false; ctl.speech.instances.push(this); }
      start() { if (this.started) throw Object.assign(new Error('already started'), { name: 'InvalidStateError' }); this.started = true; if (this.onstart) this.onstart(); }
      stop() { this._end(); } abort() { this._end(); }
      _end() { if (!this.started) return; this.started = false; if (this.onend) this.onend(); }
    }
    window.webkitSpeechRecognition = SpeechRecognition;
    window.SpeechRecognition = SpeechRecognition;
    const last = () => { const r = ctl.speech.instances[ctl.speech.instances.length - 1]; if (!r) throw new Error('speech: la app todavía no creó ningún reconocedor'); return r; };
    /** El usuario dicta una frase (resultado final) y el reconocedor termina. */
    ctl.speech.say = (frase, confidence = 0.9) => {
      const r = last();
      const alt = { transcript: frase, confidence };
      const res = [alt]; res.isFinal = true; res.item = i => res[i];
      const results = [res]; results.item = i => results[i];
      if (r.onresult) r.onresult({ results, resultIndex: 0, type: 'result' });
      r._end();
    };
    /** Error del reconocedor: 'not-allowed' (sin permiso), 'network' (sin internet), 'no-speech', 'aborted'… */
    ctl.speech.fail = (error = 'network') => { const r = last(); if (r.onerror) r.onerror({ error, message: '', type: 'error' }); r._end(); };
    ctl.speech.last = last;
  }

  /* ── service worker ── */
  ctl.sw = { registrations: [] };
  if (opts.serviceWorker !== false) {
    const reg = (url, options) => { const r = { url, options, scope: (options && options.scope) || './', update: async () => {}, unregister: async () => true, addEventListener() {} }; ctl.sw.registrations.push(r); return r; };
    def(navigator, 'serviceWorker', { register: async (url, options) => reg(url, options), ready: Promise.resolve({ scope: './', update: async () => {} }), controller: null, addEventListener() {}, getRegistrations: async () => ctl.sw.registrations });
  }

  /* ── portapapeles ── */
  ctl.clipboard = { text: null, writes: [] };
  def(navigator, 'clipboard', { writeText: async t => { ctl.clipboard.text = String(t); ctl.clipboard.writes.push(String(t)); }, readText: async () => ctl.clipboard.text || '' });
  document.execCommand = cmd => { if (cmd === 'copy') { const el = document.activeElement; const sel = window.getSelection && String(window.getSelection()); const t = (el && el.value) || sel || ''; ctl.clipboard.text = t; ctl.clipboard.writes.push(t); return true; } return false; };

  /* ── diálogos nativos ── */
  ctl.dialogs = { log: [], confirmAnswers: [], promptAnswers: [], defaultConfirm: true };
  window.alert = m => { ctl.dialogs.log.push({ type: 'alert', message: String(m) }); };
  window.confirm = m => { const a = ctl.dialogs.confirmAnswers.length ? ctl.dialogs.confirmAnswers.shift() : ctl.dialogs.defaultConfirm; ctl.dialogs.log.push({ type: 'confirm', message: String(m), answer: a }); return a; };
  window.prompt = (m, d) => { const a = ctl.dialogs.promptAnswers.length ? ctl.dialogs.promptAnswers.shift() : null; ctl.dialogs.log.push({ type: 'prompt', message: String(m), default: d, answer: a }); return a; };

  /* ── window.open (WhatsApp), navegaciones y descargas ── */
  window.open = (url, target, features) => { ctl.opened.push({ url: String(url), target, features }); return null; };
  const AP = window.HTMLAnchorElement.prototype;
  const origClick = AP.click;
  AP.click = function () {
    if (this.hasAttribute('download')) { const d = { filename: this.getAttribute('download'), href: this.href }; d.blobText = ctl.downloads._blobs && ctl.downloads._blobs.get(this.href); ctl.downloads.push(d); return; }
    const href = this.getAttribute('href') || '';
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) { ctl.navigations.push(new URL(href, window.location.href).href); return; }
    return origClick.call(this);
  };
  ctl.downloads._blobs = new Map();
  let blobSeq = 0;
  window.URL.createObjectURL = blob => { const u = 'blob:https://test.local/' + (++blobSeq); ctl.downloads._blobs.set(u, blob); return u; };
  window.URL.revokeObjectURL = () => {};
  /** Contenido de texto de la última descarga (los Blob de jsdom se leen con FileReader). */
  ctl.downloads.lastText = () => new Promise((res, rej) => {
    const last = ctl.downloads[ctl.downloads.length - 1];
    if (!last) return rej(new Error('no hubo descargas'));
    const blob = last.blobText;
    if (!blob) return res('');
    if (typeof blob === 'string') return res(blob);
    const fr = new window.FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsText(blob);
  });

  /* ── red / visibilidad ── */
  let online = opts.online !== false;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  ctl.net = { setOnline(v) { v = !!v; if (v === online) return; online = v; window.dispatchEvent(new window.Event(v ? 'online' : 'offline')); }, get online() { return online; } };
  let visible = true;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (visible ? 'visible' : 'hidden') });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });
  ctl.page = { setVisible(v) { v = !!v; if (v === visible) return; visible = v; document.dispatchEvent(new window.Event('visibilitychange')); }, get visible() { return visible; } };

  /* ── varios que jsdom no trae ── */
  window.matchMedia = window.matchMedia || (q => ({ matches: /standalone/.test(q) ? !!opts.standalone : false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.IntersectionObserver = window.IntersectionObserver || class { observe() {} unobserve() {} disconnect() {} };
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
  if (!window.AbortSignal.timeout) window.AbortSignal.timeout = ms => { const c = new window.AbortController(); clock.setTimeout(() => c.abort(), ms); return c.signal; };
  def(navigator, 'vibrate', () => true);
  if (!('share' in navigator)) { /* sin Web Share: la app debe tener plan B */ }

  return ctl;
}

module.exports = { installStubs };
