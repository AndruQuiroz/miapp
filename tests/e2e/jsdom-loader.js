'use strict';
/**
 * Ubica jsdom SIN instalarlo globalmente (SPEC §9: npm solo dentro de miapp/ o del scratchpad).
 * Orden de búsqueda:
 *   1) $JSDOM_DIR  (carpeta node_modules que contiene jsdom, o la carpeta del propio paquete)
 *   2) miapp/node_modules
 *   3) el scratchpad de QA:  .../scratchpad/qa/e2e-deps/node_modules   (donde se instaló en la FASE 1)
 * Si no hay jsdom, loadJSDOM() devuelve null y las pruebas e2e se saltan solas.
 *
 * Instalar:  cd <carpeta> && npm init -y && npm install jsdom@24   (y exportar JSDOM_DIR=<carpeta>/node_modules)
 */
const fs = require('node:fs');
const path = require('node:path');

const SCRATCH = '/tmp/claude-0/-home-claude/06e1c601-47b9-59d5-b935-12c557c2f42b/scratchpad/qa/e2e-deps/node_modules';
const CANDIDATES = [process.env.JSDOM_DIR, path.resolve(__dirname, '../../node_modules'), SCRATCH].filter(Boolean);

let cache;
function loadJSDOM() {
  if (cache !== undefined) return cache;
  cache = null;
  for (const base of CANDIDATES) {
    for (const dir of [path.join(base, 'jsdom'), base]) {
      try {
        const pkg = path.join(dir, 'package.json');
        if (fs.existsSync(pkg) && JSON.parse(fs.readFileSync(pkg, 'utf8')).name === 'jsdom') { cache = require(dir); return cache; }
      } catch { /* siguiente candidato */ }
    }
  }
  return cache;
}

module.exports = { loadJSDOM, CANDIDATES };
