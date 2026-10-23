'use strict';
/**
 * Carga core.js para los tests.
 *
 * Por defecto usa app/core.js. Con CORE_PATH=/ruta/otro-core.js se puede correr la MISMA suite
 * contra otra versión (p. ej. la original antes de los arreglos de QA) y ver qué tests detectan
 * cada bug:   CORE_PATH=/ruta/core.orig.js node --test tests/core.test.js
 */
require('./clock'); // fija TZ=America/Bogota antes de cualquier fecha

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PATH = path.resolve(__dirname, '../../app/core.js');
const CORE_PATH = process.env.CORE_PATH ? path.resolve(process.env.CORE_PATH) : DEFAULT_PATH;
const core = require(CORE_PATH);

module.exports = Object.assign({}, core, {
  CORE_PATH,
  CORE_SOURCE: fs.readFileSync(CORE_PATH, 'utf8'),
  IS_DEFAULT_CORE: CORE_PATH === DEFAULT_PATH,
});
