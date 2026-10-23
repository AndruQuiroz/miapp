// Permite correr `node --test tests/` (Node 22 resuelve la carpeta a este index.js): carga TODOS los *.test.js de tests/ (recursivo,
// incluida tests/e2e/ y tests/frontend/). Si un archivo no carga (sintaxis, require roto) se registra UN test que falla con el motivo
// en vez de tumbar toda la corrida. Equivalente sin shim y recomendado:  node --test 'tests/**/*.test.js'   (con comillas)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out); else if (e.name.endsWith('.test.js')) out.push(f);
  }
  return out;
}

for (const f of walk(__dirname)) {
  try { require(f); }
  catch (err) { test(`carga de ${path.relative(__dirname, f)}`, () => { throw err; }); }
}
