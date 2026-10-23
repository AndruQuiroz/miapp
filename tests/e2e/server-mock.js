'use strict';
/**
 * Servidor local para pruebas en navegador REAL (Playwright). Reproduce, sobre HTTP de verdad, lo que la app encuentra en producción:
 *
 *   1. "script.google.com": el /exec de Apps Script. Carga dist/apps-script/Code.gs en un vm con los mocks de server/test/env.js
 *      (SpreadsheetApp, Properties, Lock, ContentService...), ejecuta setup() y atiende
 *         GET  /macros/s/<id>/exec?action=...&key=...      -> doGet({parameter, ...})
 *         POST /macros/s/<id>/exec?action=capture&...      -> doPost({parameter, postData:{contents,type}})
 *      Igual que Google: la respuesta NO sale directa; es un 302 a "script.googleusercontent.com/macros/echo?user_content_key=..."
 *      (otro origen) que fetch sigue como GET, y la respuesta final lleva  Access-Control-Allow-Origin: *.
 *      Un OPTIONS (preflight) se rechaza con 405 sin cabeceras CORS, como hace Apps Script: si la app manda un Content-Type JSON o
 *      cabeceras propias, el navegador real falla y se cuenta en stats.preflights.
 *   2. "script.googleusercontent.com": el destino del 302 (otro puerto = otro origen).
 *   3. "GitHub Pages": sirve app/ bajo /miapp/ (subruta, origen distinto al de la nube). Lo que cuelgue de "/" o de rutas absolutas
 *      da 404 como en Pages (se registra en appNotFound). /miapp -> 301 a /miapp/. Cache-Control: max-age=600 como Pages.
 *   4. "CDN": cdnjs.cloudflare.com y fonts.googleapis.com/gstatic.com. Chromium se lanza con mock.browserArgs() (--host-resolver-rules) y
 *      esos tres nombres apuntan a este servidor, que entrega Chart.js 4.4.0 real si lo encuentra (npm i chart.js@4.4.0; ver
 *      findChart) o un sustituto mínimo. Así el service worker ve las MISMAS URL que en producción (su regex de CDN, su caché,
 *      Chart.js sin red en la recarga offline). mock.setCdn('down') simula el CDN caído.
 *   Todo sobre HTTPS con un certificado propio (generado con openssl al arrancar): la app exige URL https:// y los service workers
 *   exigen contexto seguro. Usa  browser.newContext({ ignoreHTTPSErrors: true }).
 *
 * Uso desde pruebas:
 *     const { startMock } = require('./server-mock');
 *     const mock = await startMock();                 // { appUrl, execUrl, key, env, ... }
 *     mock.failNext(1, 'html'); mock.calls('sync'); mock.stats; await mock.callExec('POST', {action:'capture', key}, 'Recibiste $5.000 de ANA');
 *     await mock.close();
 *
 * A mano (para abrir la app en tu Chrome y probarla contra este servidor):
 *     node tests/e2e/server-mock.js          # imprime URL de la app, URL /exec y la clave; Ctrl+C para salir
 *     (Chrome te avisará del certificado: "Avanzado > Continuar"; o abre Chrome con --ignore-certificate-errors)
 */
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { makeEnv } = require('../../server/test/env');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_DIR = path.join(ROOT, 'app');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

/** Certificado autofirmado para localhost/127.0.0.1 (vive en un directorio temporal, se borra al cerrar). */
function makeCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miapp-cert-'));
  const key = path.join(dir, 'key.pem'), crt = path.join(dir, 'crt.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '2', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'pipe' });
  const out = { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Cliente https de Node que hace lo que fetch(): sigue 301/302/303/307/308 (POST -> GET salvo 307/308) y no valida el certificado. */
function httpsRequest(urlStr, { method = 'GET', headers = {}, body = null, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const h = Object.assign({}, headers);
    if (body != null) h['Content-Length'] = Buffer.byteLength(body);
    const req = https.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: h, rejectUnauthorized: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
          const next = new URL(res.headers.location, u).toString();
          const keep = res.statusCode === 307 || res.statusCode === 308;
          return resolve(httpsRequest(next, { method: keep ? method : 'GET', headers: keep ? headers : {}, body: keep ? body : null, maxRedirects: maxRedirects - 1 }));
        }
        let json = null; try { json = JSON.parse(text); } catch (_) { /* no era JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json, url: urlStr });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

const ERROR_HTML = '<!DOCTYPE html><html><head><title>Error</title></head><body style="font-family:sans-serif"><div>' +
  'TypeError: Cannot read properties of undefined (reading \'parameter\') (línea 87, archivo "Code")</div></body></html>';


/** Chart.js: variable CHARTJS_PATH, miapp/node_modules, o el scratchpad de QA. Si no está, un sustituto que dibuja barras. */
const SCRATCH_CHART = '/tmp/claude-0/-home-claude/06e1c601-47b9-59d5-b935-12c557c2f42b/scratchpad/qa/pw-deps/node_modules/chart.js/dist/chart.umd.js';
function findChart() {
  for (const f of [process.env.CHARTJS_PATH, path.join(ROOT, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'), SCRATCH_CHART].filter(Boolean)) {
    try { if (fs.statSync(f).isFile()) return { source: 'chart.js real (' + f + ')', real: true, code: fs.readFileSync(f, 'utf8') }; } catch (_) { /* siguiente */ }
  }
  const stub = "(function(){function C(el,cfg){this.el=el;this.cfg=cfg;(window.__charts=window.__charts||[]).push(cfg);try{var c=el.getContext('2d'),w=el.width||300,h=el.height||150,d=(cfg.data.datasets[0]||{data:[]}).data,m=Math.max.apply(null,d.concat([1]));c.fillStyle='#10d98a';d.forEach(function(v,i){var bw=w/d.length;c.fillRect(i*bw+4,h-(v/m)*(h-10),bw-8,(v/m)*(h-10))})}catch(e){}}C.prototype.destroy=function(){};C.prototype.update=function(){};C.defaults={};window.Chart=C})();";
  return { source: 'sustituto mínimo de Chart (instala chart.js@4.4.0 para el real)', real: false, code: stub };
}

/**
 * @param {object} [o]
 * @param {string} [o.appDir]    carpeta a publicar como /miapp/ (por defecto app/)
 * @param {string} [o.base]      subruta de la app (por defecto /miapp/)
 * @param {number} [o.delayMs]   latencia artificial de /exec (Apps Script real tarda 0,5-3 s)
 * @param {string} [o.scriptId]
 */
async function startMock(o = {}) {
  const appDir = path.resolve(o.appDir || process.env.APP_DIR_E2E || APP_DIR);
  const base = (o.base || '/miapp/').replace(/\/?$/, '/');
  const scriptId = o.scriptId || 'AKfycbxMOCKmiapp0123456789';
  const tls = makeCert();

  // ─── "Apps Script" ───
  const env = makeEnv();
  env.setup();
  const key = env.key();

  const state = {
    delayMs: o.delayMs || 0,
    fail: [],                       // [{mode, left}]
    log: [],                        // todas las peticiones (exec, echo, app)
    outputs: new Map(),             // token -> {mime, content}
    stats: { execCalls: 0, redirects: 0, echoReads: 0, preflights: 0, errors: 0, maxConcurrentSync: 0 },
    inflightSync: 0,
    appNotFound: [],                // rutas de la app que dieron 404
    cdn: 'up', cdnHits: []          // CDN simulado: 'up' | 'down'; urls pedidas
  };
  const chart = findChart();
  let seq = 0;
  const record = e => { const r = Object.assign({ n: ++seq, t: Date.now() }, e); state.log.push(r); return r; };

  function takeFail() {
    const f = state.fail[0];
    if (!f) return null;
    if (--f.left <= 0) state.fail.shift();
    return f.mode;
  }

  const origins = {};   // se rellenan al escuchar

  async function exec(req, res) {
    const url = new URL(req.url, 'https://127.0.0.1');
    const entry = { kind: 'exec', method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), contentType: req.headers['content-type'] || '', origin: req.headers.origin || '' };
    if (req.method === 'OPTIONS') {
      // Apps Script no contesta el preflight: sin Access-Control-Allow-*, el navegador cancela la petición real
      state.stats.preflights++;
      record(Object.assign(entry, { preflight: true, status: 405 }));
      res.writeHead(405, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<html><body>Method Not Allowed</body></html>');
    }
    const body = req.method === 'POST' ? await readBody(req) : '';
    if (url.pathname !== `/macros/s/${scriptId}/exec`) {
      record(Object.assign(entry, { status: 404, bodyBytes: body.length }));
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<html><body>Lo sentimos, no se pudo abrir el archivo en este momento.</body></html>');
    }
    state.stats.execCalls++;
    // e.parameter: primer valor de cada parámetro de la URL (+ campos del cuerpo si viene como formulario)
    const parameter = {};
    for (const [k, v] of url.searchParams) if (!(k in parameter)) parameter[k] = v;
    if (req.method === 'POST' && /application\/x-www-form-urlencoded/i.test(entry.contentType)) {
      for (const [k, v] of new URLSearchParams(body)) if (!(k in parameter)) parameter[k] = v;
    }
    let action = parameter.action || '';
    if (!action && body) { try { action = (JSON.parse(body) || {}).action || ''; } catch (_) { /* texto crudo */ } }
    Object.assign(entry, { action, bodyBytes: Buffer.byteLength(body), body, parameter });

    const esSync = action === 'sync';
    if (esSync) state.stats.maxConcurrentSync = Math.max(state.stats.maxConcurrentSync, ++state.inflightSync);
    try {
      if (state.delayMs) await new Promise(r => setTimeout(r, state.delayMs));
      const fallo = takeFail();
      const cors = { 'Access-Control-Allow-Origin': '*' };
      if (fallo === 'network') { record(Object.assign(entry, { status: 0, fallo })); return req.socket.destroy(); }
      if (fallo === 'http500') { record(Object.assign(entry, { status: 500, fallo })); res.writeHead(500, Object.assign({ 'Content-Type': 'text/html' }, cors)); return res.end('<html>Error interno</html>'); }

      let out;
      try {
        if (fallo === 'busy') env.lock.fail = true;
        try {
          if (fallo === 'html') throw new Error('boom');
          const out_ = req.method === 'POST'
            ? env.ctx.doPost({ parameter, postData: { contents: body, length: Buffer.byteLength(body), type: entry.contentType || 'text/plain', name: 'postData' } })
            : env.ctx.doGet({ parameter, queryString: url.search.slice(1), contentLength: -1 });
          out = { mime: out_.getMimeType() === 'JSON' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', content: out_.getContent() };
        } finally { env.lock.fail = false; }
      } catch (err) {
        // una excepción en Apps Script devuelve una página HTML de error (con estado 200)
        state.stats.errors++;
        out = { mime: 'text/html; charset=utf-8', content: ERROR_HTML };
      }
      if (fallo === 'badjson') out = { mime: 'application/json; charset=utf-8', content: 'esto no es json {' };

      const token = crypto.randomBytes(18).toString('base64url');
      state.outputs.set(token, out);
      state.stats.redirects++;
      record(Object.assign(entry, { status: 302, fallo: fallo || '', response: out.content.length > 4000 ? out.content.slice(0, 4000) + '…' : out.content }));
      res.writeHead(302, Object.assign({ Location: `${origins.echo}/macros/echo?user_content_key=${token}&lib=MmiappMock`, 'Content-Type': 'text/html; charset=utf-8' }, cors));
      res.end('<HTML><HEAD><TITLE>Moved Temporarily</TITLE></HEAD><BODY>Moved Temporarily</BODY></HTML>');
    } finally { if (esSync) state.inflightSync--; }
  }

  function echo(req, res) {
    const url = new URL(req.url, 'https://127.0.0.1');
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (req.method === 'OPTIONS') { state.stats.preflights++; record({ kind: 'echo', method: 'OPTIONS', preflight: true, status: 405 }); res.writeHead(405); return res.end(); }
    const out = state.outputs.get(url.searchParams.get('user_content_key'));
    record({ kind: 'echo', method: req.method, path: url.pathname, status: out ? 200 : 404 });
    if (!out || url.pathname !== '/macros/echo') { res.writeHead(404, Object.assign({ 'Content-Type': 'text/html' }, cors)); return res.end('<html>No encontrado</html>'); }
    state.stats.echoReads++;
    res.writeHead(200, Object.assign({ 'Content-Type': out.mime, 'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate' }, cors));
    res.end(out.content);
  }

  // ─── "GitHub Pages" ───
  function staticApp(req, res) {
    const url = new URL(req.url, 'https://localhost');
    let p; try { p = decodeURIComponent(url.pathname); } catch (_) { p = url.pathname; }
    const done = (status, headers, body, extra) => {
      record(Object.assign({ kind: 'app', method: req.method, path: url.pathname, status }, extra || {}));
      if (status === 404 && p !== '/favicon.ico') state.appNotFound.push(p);
      res.writeHead(status, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (p === base.slice(0, -1)) return done(301, { Location: base + url.search, 'Content-Type': 'text/html' }, '');
    if (!p.startsWith(base)) return done(404, { 'Content-Type': 'text/html; charset=utf-8' }, '<h1>404</h1><p>There isn\'t a GitHub Pages site here.</p>');
    let rel = p.slice(base.length);
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(appDir, rel);
    if (!file.startsWith(appDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return done(404, { 'Content-Type': 'text/html; charset=utf-8' }, '<h1>404</h1><p>File not found</p>');
    }
    const buf = fs.readFileSync(file);
    const etag = '"' + crypto.createHash('md5').update(buf).digest('hex').slice(0, 16) + '"';
    if (req.headers['if-none-match'] === etag) return done(304, { ETag: etag }, '');
    done(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'max-age=600', ETag: etag,
      // Pages sirve los PNG/JS con el tipo correcto y sin permisos CORS adicionales
      'Content-Length': buf.length
    }, buf, { file: rel });
  }


  // ─── "CDN" (cdnjs + Google Fonts) ───
  function cdn(req, res) {
    const url = new URL(req.url, 'https://cdnjs.cloudflare.com');
    const host = String(req.headers.host || '').split(':')[0];
    state.cdnHits.push(host + url.pathname);
    record({ kind: 'cdn', method: req.method, path: host + url.pathname, status: state.cdn === 'up' ? 200 : 503 });
    if (state.cdn !== 'up') return req.socket.destroy();     // CDN caído: la conexión se corta
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (host === 'cdnjs.cloudflare.com' && /\/chart\.umd\.min\.js$/.test(url.pathname)) {
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=30672000' }, cors));
      return res.end(chart.code);
    }
    if (host === 'fonts.googleapis.com') {
      res.writeHead(200, Object.assign({ 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'private, max-age=86400' }, cors));
      return res.end('/* fuentes simuladas: el navegador usa las del sistema */');
    }
    res.writeHead(404, cors); res.end();
  }

  const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(err => { try { res.writeHead(500); res.end(String(err && err.stack || err)); } catch (_) { /* socket ya cerrado */ } });
  const servers = {
    exec: https.createServer(tls, wrap(exec)),
    echo: https.createServer(tls, wrap(echo)),
    app: https.createServer(tls, wrap(staticApp)),
    cdn: https.createServer(tls, wrap(cdn))
  };
  const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
  const ports = { exec: await listen(servers.exec), echo: await listen(servers.echo), app: await listen(servers.app), cdn: await listen(servers.cdn) };
  // Tres ORÍGENES distintos (como github.io / script.google.com / script.googleusercontent.com): hosts y puertos diferentes
  origins.exec = `https://127.0.0.1:${ports.exec}`;
  origins.echo = `https://127.0.0.1:${ports.echo}`;
  origins.app = `https://localhost:${ports.app}`;

  const mock = {
    appUrl: origins.app + base,
    appOrigin: origins.app,
    execUrl: `${origins.exec}/macros/s/${scriptId}/exec`,
    echoOrigin: origins.echo,
    chartSource: chart.source,
    key, env, state,
    get stats() { return state.stats; },
    get log() { return state.log; },
    get appNotFound() { return state.appNotFound; },
    /** peticiones a /exec (no cuenta preflights ni el echo) filtradas por acción: 'ping' | 'sync' | 'capture' | 'summary' | 'reminders' */
    calls(action) { return state.log.filter(r => r.kind === 'exec' && !r.preflight && (!action || r.action === action)); },
    /** programa fallos de las próximas n llamadas a /exec: 'network' | 'http500' | 'html' | 'busy' | 'badjson' */
    failNext(n = 1, mode = 'network') { state.fail.push({ left: n, mode }); },
    /** cancela los fallos programados que no se hayan consumido (Chrome reintenta solo algunos POST cortados: programa varios y limpia) */
    clearFail() { state.fail.length = 0; },
    setDelay(ms) { state.delayMs = ms; },
    /** opciones listas para chromium.launch(): args (ver browserArgs) + entorno SIN variables *_proxy (Chromium las lee del entorno y
     *  mandaría todo por el proxy del sandbox, que no conoce estos nombres) */
    launchOptions() {
      const env = Object.assign({}, process.env);
      for (const k of Object.keys(env)) if (/proxy/i.test(k)) delete env[k];
      return { args: mock.browserArgs(), env };
    },
    /** 'up' | 'down': el CDN (Chart.js y fuentes) responde o corta la conexión */
    setCdn(v) { state.cdn = v; },
    get cdnHits() { return state.cdnHits; },
    /** argumentos para chromium.launch({args}): sin sandbox (root), certificado propio aceptado también por el service worker,
     *  sin proxy (HTTPS_PROXY haría ignorar el mapeo de nombres) y cdnjs/fuentes redirigidos a este servidor */
    browserArgs() {
      const map = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].map(h => `MAP ${h} 127.0.0.1:${ports.cdn}`).join(', ');
      return ['--no-sandbox', '--ignore-certificate-errors', '--no-proxy-server', `--host-resolver-rules=${map}`];
    },
    clearLog() { state.log.length = 0; state.appNotFound.length = 0; state.cdnHits.length = 0; Object.assign(state.stats, { execCalls: 0, redirects: 0, echoReads: 0, preflights: 0, errors: 0, maxConcurrentSync: 0 }); },
    /** lo guardado en la hoja _db */
    db() { return env.stored(); },
    /** lo que haría MacroDroid / curl: llamada directa a /exec siguiendo el 302. params van en la URL; body va como cuerpo del POST. */
    callExec(method, params, body, headers) {
      const u = new URL(mock.execUrl);
      for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
      return httpsRequest(u.toString(), { method, body: method === 'POST' ? (body == null ? '' : String(body)) : null, headers: Object.assign(method === 'POST' ? { 'Content-Type': 'text/plain' } : {}, headers || {}) });
    },
    /** MacroDroid: POST capture con el texto de la notificación (por defecto Content-Type text/plain; prueba también otros) */
    capture(texto, { bolsillo = 'nequi', contentType = 'text/plain', k = key } = {}) {
      return mock.callExec('POST', { action: 'capture', key: k, bolsillo }, texto, { 'Content-Type': contentType });
    },
    get(action, extra) { return mock.callExec('GET', Object.assign({ action, key }, extra || {})); },
    /** hace avanzar el reloj del servidor (Date.now de Code.gs), p. ej. para saltarse la ventana de 10 min del dedup */
    setServerNow(ms) { env.clock.now = ms; },
    async close() {
      await Promise.all(Object.values(servers).map(s => new Promise(r => { s.closeAllConnections && s.closeAllConnections(); s.close(() => r()); })));
    }
  };
  return mock;
}

module.exports = { startMock, httpsRequest, APP_DIR };

// ─── modo manual ───
if (require.main === module) {
  startMock({ delayMs: Number(process.env.DELAY_MS || 0) }).then(m => {
    console.log('Mi App contra un Apps Script simulado (carga dist/apps-script/Code.gs)\n');
    console.log('  App   :', m.appUrl);
    console.log('  /exec :', m.execUrl);
    console.log('  Clave :', m.key);
    console.log('  Chart :', m.chartSource);
    console.log('\nCaptura de prueba (como MacroDroid):');
    console.log(`  curl -sk -L -X POST -H 'Content-Type: text/plain' -d 'Recibiste $50.000 de ANA PEREZ' '${m.execUrl}?action=capture&key=${m.key}&bolsillo=nequi'`);
    console.log('\nCtrl+C para salir.');
    m.env.run('1'); // no-op: mantiene la referencia viva
  }).catch(e => { console.error(e); process.exit(1); });
}
