'use strict';
/**
 * Comprobaciones ESTÁTICAS de los entregables (sin navegador ni jsdom): sintaxis (`node --check`, SPEC §9), manifest, service worker,
 * index.html, Apps Script. Cada bloque se salta solo si el archivo todavía no existe (los equipos están escribiéndolos en paralelo).
 *   node --test tests/static.test.js
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const p = (...a) => path.join(ROOT, ...a);
const has = f => fs.existsSync(p(f));
const read = f => fs.readFileSync(p(f), 'utf8');
const skipSi = (f, extra) => (has(f) ? false : `${f} todavía no existe${extra ? ' ' + extra : ''}`);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out); else out.push(f);
  }
  return out;
}
const rel = f => path.relative(ROOT, f);

/** dimensiones de un PNG leyendo la cabecera IHDR */
function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.subarray(1, 4).toString('latin1'), 'PNG', `${rel(file)} no es un PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/* ════════════════════════════════════════════════════════════════════════════ */
describe('sintaxis: todo el JS pasa node --check (SPEC §9)', () => {
  const archivos = [...walk(p('app')), ...walk(p('server')), ...walk(p('tests')), ...walk(p('docs'))].filter(f => /\.(js|gs)$/.test(f));
  for (const f of archivos) {
    test(rel(f), () => {
      // .gs (Apps Script) se revisa copiado como .js: es JavaScript V8
      let target = f, tmp = null;
      if (f.endsWith('.gs')) { tmp = path.join(require('node:os').tmpdir(), `check-${process.pid}-${path.basename(f)}.js`); fs.copyFileSync(f, tmp); target = tmp; }
      try { execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' }); }
      catch (e) { assert.fail(`${rel(f)} no pasa node --check:\n${String(e.stderr || e.message).split('\n').slice(0, 6).join('\n')}`); }
      finally { if (tmp) fs.rmSync(tmp, { force: true }); }
    });
  }
});

describe('fechas en hora LOCAL: nada de toISOString() para obtener el día (SPEC §6.7: bug de UTC por la noche)', () => {
  const archivos = walk(p('app')).filter(f => /\.(js|html)$/.test(f));
  for (const f of archivos) {
    test(rel(f), () => {
      const src = fs.readFileSync(f, 'utf8');
      const mal = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /toISOString\(\)\s*\.\s*(slice|substring|substr|split)\s*\(\s*(0\s*,\s*10|['"]T['"])/.test(l) || /toISOString\(\)\s*\[/.test(l));
      assert.deepEqual(mal.map(([n, l]) => `${rel(f)}:${n}: ${l.trim().slice(0, 100)}`), [], 'usa ymd()/today() de core.js (hora local), no toISOString');
    });
  }
});

describe('manifest.json (SPEC §6.6 y §10.1)', { skip: skipSi('app/manifest.json') }, () => {
  const man = () => JSON.parse(read('app/manifest.json'));
  test('nombre, start_url y scope relativos, standalone, colores #080c10', () => {
    const m = man();
    assert.equal(m.name, 'Mi App');
    assert.equal(m.short_name, 'Mi App');
    assert.equal(m.start_url, './');
    assert.equal(m.scope, './');
    assert.equal(m.display, 'standalone');
    assert.equal(m.background_color, '#080c10');
    assert.equal(m.theme_color, '#080c10');
  });
  test('iconos 192, 512 y maskable 512: existen, son PNG del tamaño que dicen y con ruta relativa', () => {
    const m = man();
    assert.ok(Array.isArray(m.icons) && m.icons.length >= 3, 'faltan iconos');
    const quiere = [['192x192', false], ['512x512', false], ['512x512', true]];
    for (const [size, maskable] of quiere) {
      const ic = m.icons.find(i => i.sizes === size && (/maskable/.test(i.purpose || '') === maskable));
      assert.ok(ic, `falta el icono ${size}${maskable ? ' maskable' : ''}`);
      assert.ok(!ic.src.startsWith('/'), `ruta absoluta del icono: ${ic.src}`);
      const f = p('app', ic.src);
      assert.ok(fs.existsSync(f), `no existe ${ic.src}`);
      const { w, h } = pngSize(f);
      assert.deepEqual([w, h], size.split('x').map(Number), `${ic.src} mide ${w}x${h}`);
      assert.match(ic.type || 'image/png', /image\/png/);
    }
  });
  test('atajos: "Dictar movimiento" → ./?voz=1 y "Por clasificar" → ./?v=inicio', () => {
    const sc = man().shortcuts || [];
    const por = n => sc.find(s => s.name === n || s.short_name === n);
    assert.equal(por('Dictar movimiento') && por('Dictar movimiento').url, './?voz=1');
    assert.equal(por('Por clasificar') && por('Por clasificar').url, './?v=inicio');
  });
});

describe('sw.js (SPEC §6.6)', { skip: skipSi('app/sw.js') }, () => {
  const sw = () => read('app/sw.js');
  test('versión en una constante, skipWaiting y clients.claim', () => {
    assert.match(sw(), /(const|let|var)\s+[A-Z_]*(VERSION|VERSI[OÓ]N|CACHE)[A-Z_]*\s*=\s*['"`]/i, 'sin constante de versión/caché');
    assert.match(sw(), /skipWaiting\s*\(/);
    assert.match(sw(), /clients\.claim\s*\(/);
  });
  test('NUNCA intercepta script.google.com / googleusercontent.com ni métodos distintos de GET', () => {
    const s = sw();
    assert.match(s, /script\.google\.com/, 'debe nombrar script.google.com para excluirlo');
    assert.match(s, /googleusercontent\.com/, 'debe nombrar googleusercontent.com para excluirlo');
    assert.match(s, /method\s*!==?\s*['"]GET['"]|method\s*===?\s*['"]GET['"]/, 'debe filtrar por método GET');
  });
  test('el precache usa rutas relativas (no "/index.html" ni "/app.js")', () => {
    const rutas = [...sw().matchAll(/['"`](\/[A-Za-z0-9_.\-/]+\.(?:html|js|css|json|png))['"`]/g)].map(m => m[1]);
    assert.deepEqual(rutas, [], 'rutas absolutas en el SW (en GitHub Pages /miapp/ rompen el caché)');
  });
});

describe('index.html (SPEC §6.6, §6.7 y §10.1)', { skip: skipSi('app/index.html') }, () => {
  const html = () => read('app/index.html');
  test('idioma, viewport móvil, theme-color, manifest relativo', () => {
    const h = html();
    assert.match(h, /<html[^>]*\blang=["']es/i);
    assert.match(h, /<meta[^>]*name=["']viewport["'][^>]*width=device-width/i);
    assert.match(h, /<meta[^>]*name=["']theme-color["'][^>]*#080c10/i);
    const man = h.match(/<link[^>]*rel=["']manifest["'][^>]*href=["']([^"']+)["']/i);
    assert.ok(man, 'falta <link rel="manifest">');
    assert.ok(!man[1].startsWith('/'), `manifest con ruta absoluta: ${man[1]}`);
  });
  test('todo recurso local existe y ninguno usa ruta absoluta; scripts en el orden core → quick → app; Chart.js 4.4.0 de cdnjs', () => {
    const h = html();
    const refs = [...h.matchAll(/\b(?:src|href)\s*=\s*["']([^"'#]+)["']/gi)].map(m => m[1]).filter(r => !/^(https?:|data:|mailto:|tel:|javascript:|\/\/)/i.test(r));
    for (const r of refs) {
      assert.ok(!r.startsWith('/'), `ruta absoluta "${r}" (en GitHub Pages /miapp/ debe ser relativa)`);
      assert.ok(fs.existsSync(p('app', r.split('?')[0])), `no existe app/${r}`);
    }
    const srcs = [...h.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
    const locales = srcs.filter(s => !/^(https?:)?\/\//.test(s)).map(s => path.basename(s.split('?')[0]));
    // ronda 6: ocr.js (lector de fotos) va después de core.js; el orden core → quick → app se mantiene
    assert.deepEqual(locales, ['core.js', 'ocr.js', 'quick.js', 'movs.js', 'ia.js', 'asistente.js', 'app.js']);   // ronda 7: movs.js (pantallazo de movimientos) tras quick.js
    const chart = srcs.find(s => /chart/i.test(s));
    if (chart) { assert.match(chart, /cdnjs\.cloudflare\.com/); assert.match(chart, /4\.4\.0/); }
  });
});

describe('Apps Script: server/server.gs y dist (SPEC §7 y §10.7)', { skip: skipSi('server/server.gs') }, () => {
  const names = src => new Set([...src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm), ...src.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
  test('empieza con /** @OnlyCurrentDoc */ y define doGet, doPost, setup y verClave', () => {
    const s = read('server/server.gs');
    assert.match(s.trimStart().slice(0, 200), /@OnlyCurrentDoc/);
    for (const f of ['doGet', 'doPost', 'setup', 'verClave']) assert.match(s, new RegExp(`function\\s+${f}\\s*\\(`), `falta ${f}()`);
  });
  test('ningún nombre de nivel superior choca con los de core.js (se concatenan en un solo Code.gs)', () => {
    const a = names(read('app/core.js')), b = names(read('server/server.gs'));
    assert.deepEqual([...b].filter(n => a.has(n)), []);
  });
  test('dist/apps-script/Code.gs (si ya se generó) contiene core.js completo y appsscript.json tiene la zona y el webapp del SPEC', { skip: skipSi('dist/apps-script/Code.gs') }, () => {
    const code = read('dist/apps-script/Code.gs');
    assert.ok(code.includes(read('app/core.js').trim()), 'Code.gs no contiene el core.js actual (¿falta volver a correr server/build.js?)');
    assert.ok(code.includes(read('server/server.gs').trim()), 'Code.gs no contiene el server.gs actual');
    assert.match(code.slice(0, 300), /GENERADO/);
    if (has('dist/apps-script/appsscript.json')) {
      const j = JSON.parse(read('dist/apps-script/appsscript.json'));
      assert.equal(j.timeZone, 'America/Bogota');
      assert.equal(j.runtimeVersion, 'V8');
      assert.equal(j.webapp && j.webapp.executeAs, 'USER_DEPLOYING');
      assert.equal(j.webapp && j.webapp.access, 'ANYONE_ANONYMOUS');
    }
  });
});
