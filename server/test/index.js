/* Permite correr `node --test server/test/` (Node 22 resuelve la carpeta a este index.js).
   Carga todos los *.test.js de esta carpeta. También sirve: node --test server/test/*.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort()
  .forEach(f => require(path.join(__dirname, f)));
