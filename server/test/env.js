/* Entorno falso de Google Apps Script (en memoria) para probar dist/apps-script/Code.gs con node:test.
   Imita lo que usa el servidor: SpreadsheetApp, PropertiesService, LockService,
   ContentService, Utilities y Logger. Incluye espías (contadores) y reglas reales de Sheets
   que importan: setValues exige dimensiones exactas, getRange exige ≥1 fila/columna,
   una celda admite máx. 50.000 caracteres y los "medios emojis" se dañan (U+FFFD). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const CODE = path.resolve(__dirname, '..', '..', 'dist', 'apps-script', 'Code.gs');
const MAX_CELDA = 50000;

class Range {
  constructor(sheet, r, c, nr, nc) {
    if (!(r >= 1 && c >= 1)) throw new Error('Coordenadas fuera de rango: ' + r + ',' + c);
    if (nr == null) nr = 1;
    if (nc == null) nc = 1;
    if (!(nr >= 1)) throw new Error('The number of rows in the range must be at least 1.');
    if (!(nc >= 1)) throw new Error('The number of columns in the range must be at least 1.');
    Object.assign(this, {sheet, r, c, nr, nc});
  }
  getValues() {
    this.sheet.spies.getValues++;
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) {
        const v = (this.sheet.data[this.r - 1 + i] || [])[this.c - 1 + j];
        row.push(v === undefined ? '' : v);
      }
      out.push(row);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(vals) {
    this.sheet.spies.setValues++;
    this.sheet.ss.spies.setValues++;
    if (!vals || vals.length !== this.nr) {
      throw new Error(`The number of rows in the data does not match the number of rows in the range. The data has ${vals && vals.length} but the range has ${this.nr}.`);
    }
    for (let i = 0; i < this.nr; i++) {
      const row = Array.from(vals[i]);
      if (row.length !== this.nc) {
        throw new Error(`The number of columns in the data does not match the number of columns in the range. The data has ${row.length} but the range has ${this.nc}.`);
      }
      const dest = this.sheet.data[this.r - 1 + i] || (this.sheet.data[this.r - 1 + i] = []);
      for (let j = 0; j < this.nc; j++) {
        let v = row[j];
        if (typeof v === 'string') {
          if (v.length > MAX_CELDA) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
          v = v.toWellFormed(); // Sheets no guarda "medios emojis"
        } else if (v == null) v = '';
        else if (typeof v !== 'number' && typeof v !== 'boolean' && !(v instanceof Date)) v = String(v);
        dest[this.c - 1 + j] = v;
      }
    }
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  clearContent() {
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i];
      if (!row) continue;
      for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = '';
    }
    return this;
  }
  setNumberFormat(f) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.formats[(this.r + i) + ',' + (this.c + j)] = f;
    return this;
  }
  setFontWeight(w) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.weights[(this.r + i) + ',' + (this.c + j)] = w;
    return this;
  }
}

class Sheet {
  constructor(ss, name) {
    Object.assign(this, {ss, name, data: [], formats: {}, weights: {}, hidden: false, frozen: 0});
    this.spies = {setValues: 0, getValues: 0, clearContents: 0};
  }
  getName() { return this.name; }
  getRange(r, c, nr, nc) {
    if (typeof r === 'string') throw new Error('El mock solo admite getRange(fila, col, nFilas, nCols)');
    return new Range(this, r, c, nr, nc);
  }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) {
      const row = this.data[i];
      if (row && row.some(v => v !== '' && v != null)) return i + 1;
    }
    return 0;
  }
  getLastColumn() {
    return this.data.reduce((m, row) => {
      if (!row) return m;
      for (let j = row.length - 1; j >= 0; j--) if (row[j] !== '' && row[j] != null) return Math.max(m, j + 1);
      return m;
    }, 0);
  }
  clearContents() { this.spies.clearContents++; this.data = []; return this; }
  hideSheet() {
    const visibles = this.ss.sheets.filter(s => !s.hidden && s !== this);
    if (!this.hidden && !visibles.length) throw new Error("You can't hide all the sheets in a document.");
    this.hidden = true; return this;
  }
  showSheet() { this.hidden = false; return this; }
  isSheetHidden() { return this.hidden; }
  setFrozenRows(n) { this.frozen = n; return this; }
  getFrozenRows() { return this.frozen; }
  /** Utilidad de test: valores como matriz recortada a lo usado. */
  rows() {
    const nr = this.getLastRow(), nc = this.getLastColumn();
    return nr && nc ? this.getRange(1, 1, nr, nc).getValues() : [];
  }
}

class Spreadsheet {
  constructor() {
    this.sheets = [];
    this.spies = {setValues: 0, flush: 0};
    this.insertSheet('Hoja 1');
  }
  getId() { return 'fake-ss-id'; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) {
    if (this.getSheetByName(n)) throw new Error('A sheet with the name "' + n + '" already exists.');
    const s = new Sheet(this, n);
    this.sheets.push(s);
    return s;
  }
}

/** Formato de fecha estilo Apps Script con zona horaria real (Intl). */
function formatDate(date, tz, pattern) {
  const parts = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(date.getTime())).forEach(p => { parts[p.type] = p.value; });
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, t => ({
    yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second
  })[t]);
}

/** Crea un entorno nuevo con Code.gs cargado. opts.now = ms fijos para Date.now (modificable). */
function makeEnv() {
  const ss = new Spreadsheet();
  const store = {};
  const logs = [];
  const lock = {fail: false, held: false, tries: 0, releases: 0};
  const clock = {now: null};

  const sandbox = {
    SpreadsheetApp: {
      getActive: () => ss,
      getActiveSpreadsheet: () => ss,
      flush: () => { ss.spies.flush++; }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setProperty(k, v) { store[k] = String(v); return this; },
        deleteProperty(k) { delete store[k]; return this; },
        getProperties: () => Object.assign({}, store)
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { lock.tries++; if (lock.fail) return false; lock.held = true; return true; },
        waitLock: () => { if (lock.fail) throw new Error('timeout'); lock.held = true; },
        hasLock: () => lock.held,
        releaseLock: () => { lock.held = false; lock.releases++; }
      })
    },
    ContentService: {
      MimeType: {JSON: 'JSON', TEXT: 'TEXT'},
      createTextOutput: s => ({
        content: s, mime: 'TEXT',
        setMimeType(m) { this.mime = m; return this; },
        getContent() { return this.content; },
        getMimeType() { return this.mime; }
      })
    },
    Utilities: {
      formatDate,
      getUuid: () => crypto.randomUUID()
    },
    Logger: {log: (...a) => { logs.push(a.map(String).join(' ')); }},
    __clock: clock
  };
  const ctx = vm.createContext(sandbox);
  // Reloj controlable: Date.now() usa clock.now si está definido
  vm.runInContext('(() => { const real = Date.now; Date.now = () => (__clock.now != null ? __clock.now : real()); })();', ctx);
  new vm.Script(fs.readFileSync(CODE, 'utf8'), {filename: 'Code.gs'}).runInContext(ctx);

  const parse = out => {
    if (out.getMimeType() !== 'JSON') throw new Error('Se esperaba JSON y llegó ' + out.getMimeType() + ': ' + out.getContent());
    return JSON.parse(out.getContent());
  };
  const env = {
    ctx, ss, store, logs, lock, clock,
    run: code => vm.runInContext(code, ctx),
    setup: () => ctx.setup(),
    key: () => store.KEY,
    get: params => ctx.doGet({parameter: Object.assign({}, params), queryString: '', contentLength: -1}),
    post: (params, body, type) => ctx.doPost({
      parameter: Object.assign({}, params),
      postData: {contents: body, length: Buffer.byteLength(body || ''), type: type || 'text/plain', name: 'postData'}
    }),
    parse,
    /** Lo que hace la app: POST sync con el body como texto JSON */
    sync: (db, key) => parse(env.post({}, JSON.stringify({action: 'sync', key: key == null ? store.KEY : key, db}))),
    /** DB guardada en _db (leída en el realm de node) */
    stored: () => JSON.parse(JSON.stringify(ctx.readDB_())),
    sheet: n => ss.getSheetByName(n)
  };
  return env;
}

module.exports = {makeEnv, formatDate, CODE};
