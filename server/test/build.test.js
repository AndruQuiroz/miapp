/* Pruebas de server/build.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const {build, MANIFEST} = require('../build.js');

const ROOT = path.resolve(__dirname, '..', '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'miapp-build-'));
const SERVER_OK = fs.readFileSync(path.join(ROOT, 'server', 'server.gs'), 'utf8');

test('build genera Code.gs y appsscript.json correctos', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'server', 'build.js')], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
  const code = fs.readFileSync(path.join(ROOT, 'dist', 'apps-script', 'Code.gs'), 'utf8');
  assert.equal(code.split('\n')[0], '/** @OnlyCurrentDoc */');
  assert.match(code, /GENERADO — no editar a mano/);
  assert.match(code, /CÓMO INSTALAR/);
  const core = fs.readFileSync(path.join(ROOT, 'app', 'core.js'), 'utf8').trim();
  assert.ok(code.includes(core), 'incluye core.js completo');
  assert.ok(code.indexOf('function setup()') < code.indexOf('function emptyDB()'), 'setup es la primera función');
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'apps-script', 'appsscript.json'), 'utf8'));
  assert.deepEqual(man, MANIFEST);
  assert.equal(man.timeZone, 'America/Bogota');
  assert.equal(man.runtimeVersion, 'V8');
  assert.equal(man.exceptionLogging, 'STACKDRIVER');
  assert.deepEqual(man.webapp, {executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS'});
});

function buildWith(serverSrc) {
  const dir = tmp();
  const serverFile = path.join(dir, 'server.gs');
  fs.writeFileSync(serverFile, serverSrc);
  const outDir = path.join(dir, 'out');
  try {
    return {fn: () => build({serverFile, outDir}), outDir};
  } finally { /* el directorio se borra en cada prueba */ }
}

test('build falla si Code.gs no compila (y no escribe nada)', () => {
  const b = buildWith(SERVER_OK + '\nfunction roto_( {\n');
  assert.throws(b.fn, /no compila/);
  assert.equal(fs.existsSync(path.join(b.outDir, 'Code.gs')), false);
  fs.rmSync(path.dirname(b.outDir), {recursive: true, force: true});
});

test('build falla con nombres repetidos o internos sin "_"', () => {
  let b = buildWith(SERVER_OK + '\nfunction emptyDB(){ return {}; }\n');
  assert.throws(b.fn, /repetido.*emptyDB/);
  fs.rmSync(path.dirname(b.outDir), {recursive: true, force: true});
  b = buildWith(SERVER_OK + '\nfunction ayudante(){}\n');
  assert.throws(b.fn, /sin sufijo "_": ayudante/);
  fs.rmSync(path.dirname(b.outDir), {recursive: true, force: true});
  b = buildWith(SERVER_OK + '\nconst roto_ = noExiste_.y;\n');
  assert.throws(b.fn, /falla al cargarse/);
  fs.rmSync(path.dirname(b.outDir), {recursive: true, force: true});
});
