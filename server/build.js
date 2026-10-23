#!/usr/bin/env node
/* ═══════════════════════════════════════════════
   build.js — arma el archivo único que el usuario pega en Apps Script.
   Uso: node server/build.js
   Genera:
     dist/apps-script/Code.gs          = encabezado + server/server.gs + app/core.js
     dist/apps-script/appsscript.json  (zona horaria, V8, aplicación web)
   Falla (código 1) si Code.gs no compila, si no se puede ejecutar su
   nivel superior o si hay nombres repetidos entre core.js y server.gs.
═══════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
// Funciones del servidor que el usuario (o Google) llama por su nombre: no llevan "_"
const PUBLICAS = ['setup', 'verClave', 'doGet', 'doPost'];

const MANIFEST = {
  timeZone: 'America/Bogota',
  dependencies: {},
  exceptionLogging: 'STACKDRIVER',
  runtimeVersion: 'V8',
  webapp: {executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS'}
};

const HEADER = [
  '/** @OnlyCurrentDoc */',
  '/* ══════════════════════════════════════════════════════════════════',
  '   MI APP — servidor para Google Apps Script.',
  '   GENERADO — no editar a mano (sale de app/core.js + server/server.gs con server/build.js).',
  '',
  '   CÓMO INSTALAR:',
  '   1. En tu Google Sheet: Extensiones > Apps Script. Borra lo que haya y pega TODO este archivo.',
  '   2. Guarda (ícono del disquete o Ctrl+S).',
  '   3. Arriba, en la lista de funciones, elige "setup" y toca Ejecutar. Acepta los permisos.',
  '      En el "Registro de ejecución" aparece TU CLAVE.',
  '   4. Implementar > Nueva implementación > tipo "Aplicación web": Ejecutar como "Yo",',
  '      Quién tiene acceso "Cualquier usuario". Copia la URL que termina en /exec.',
  '   5. En Mi App > Más > Ajustes pega la URL y la clave y toca "Guardar y probar".',
  '   ¿Cambiaste este código? Implementar > Gestionar implementaciones > ✏️ > Versión: "Nueva versión".',
  '══════════════════════════════════════════════════════════════════ */',
  ''
].join('\n');

/** Nombres declarados en el nivel superior (function/const/let/var/class al inicio de línea). */
function topNames(src) {
  const re = /^(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:const|let|var|class)\s+([A-Za-z_$][\w$]*))/gm;
  const out = [];
  let m;
  while ((m = re.exec(src))) out.push(m[1] || m[2]);
  return out;
}

function build(opts) {
  opts = opts || {};
  const coreFile = opts.coreFile || path.join(ROOT, 'app', 'core.js');
  const serverFile = opts.serverFile || path.join(ROOT, 'server', 'server.gs');
  const outDir = opts.outDir || path.join(ROOT, 'dist', 'apps-script');

  const core = fs.readFileSync(coreFile, 'utf8').replace(/\r\n/g, '\n');
  const server = fs.readFileSync(serverFile, 'utf8').replace(/\r\n/g, '\n');

  // 1) Nombres: sin choques entre core.js y server.gs; internos del servidor con "_"
  const coreNames = topNames(core), serverNames = topNames(server);
  const errores = [];
  const dup = arr => arr.filter((n, i) => arr.indexOf(n) !== i);
  dup(coreNames.concat(serverNames)).forEach(n => errores.push('Nombre repetido en el nivel superior: ' + n));
  serverNames.forEach(n => {
    if (!/_$/.test(n) && PUBLICAS.indexOf(n) < 0) errores.push('Nombre del servidor sin sufijo "_": ' + n);
  });
  PUBLICAS.forEach(n => { if (serverNames.indexOf(n) < 0) errores.push('Falta la función pública ' + n + ' en server.gs'); });
  if (errores.length) throw new Error('build: ' + [...new Set(errores)].join('\n'));

  // 2) Armar Code.gs. El servidor va primero para que "setup" sea la primera
  //    función de la lista "Ejecutar" en el editor de Apps Script.
  const code = HEADER +
    '\n/* ─────────── server/server.gs ─────────── */\n' + server.trim() + '\n' +
    '\n/* ─────────── app/core.js (lógica compartida con la app) ─────────── */\n' + core.trim() + '\n';

  // 3) Validar: compila y su nivel superior se ejecuta sin errores
  let script;
  try {
    script = new vm.Script(code, {filename: 'Code.gs'});
  } catch (err) {
    throw new Error('build: Code.gs no compila: ' + err.message);
  }
  try {
    script.runInNewContext({}, {timeout: 2000});
  } catch (err) {
    throw new Error('build: Code.gs falla al cargarse: ' + err.message);
  }

  fs.mkdirSync(outDir, {recursive: true});
  const codePath = path.join(outDir, 'Code.gs');
  const manPath = path.join(outDir, 'appsscript.json');
  fs.writeFileSync(codePath, code);
  fs.writeFileSync(manPath, JSON.stringify(MANIFEST, null, 2) + '\n');
  return {codePath, manPath, bytes: Buffer.byteLength(code)};
}

module.exports = {build, topNames, MANIFEST, PUBLICAS};

if (require.main === module) {
  try {
    const r = build();
    console.log('OK  ' + path.relative(ROOT, r.codePath) + ' (' + r.bytes + ' bytes)');
    console.log('OK  ' + path.relative(ROOT, r.manPath));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
