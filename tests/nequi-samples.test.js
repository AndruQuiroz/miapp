'use strict';
/**
 * parseNoti contra las muestras que dejó DOCS en docs/nequi-samples.json.
 * OJO: son textos INFERIDOS (campo "fuente": "inferido"), NO capturas reales de Nequi. Sirven para
 * medir robustez, no para certificar el formato real. Cuando el usuario mande notificaciones
 * reales (capturas de pantalla o el texto), agrégalas al JSON con "fuente": "real" y esta suite
 * las probará sola (sin tocar código).
 *
 * Desde que core.js integró la propuesta de DOCS (SPEC §10.6) las 35 muestras son pruebas normales:
 * si una falla, parseNoti empeoró.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = require('./helpers/core');

const FILE = path.resolve(__dirname, '../docs/nequi-samples.json');
const hay = fs.existsSync(FILE);
const samples = hay ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : [];

describe('docs/nequi-samples.json: formato del archivo', { skip: !hay && 'docs/nequi-samples.json no existe' }, () => {
  test('cada muestra trae text, esperado {monto, dir, quien}, fuente y tipo válidos', () => {
    assert.ok(samples.length >= 30, `solo ${samples.length} muestras`);
    for (const s of samples) {
      assert.equal(typeof s.text, 'string'); assert.ok(s.text.length > 0);
      assert.equal(typeof s.esperado.monto, 'number');
      assert.ok(['in', 'out', '?'].includes(s.esperado.dir), s.text);
      assert.equal(typeof s.esperado.quien, 'string');
      assert.ok(['inferido', 'real'].includes(s.fuente), `${s.text}: fuente ${s.fuente}`);
      assert.ok(['movimiento', 'no-movimiento', 'ruido'].includes(s.tipo), `${s.text}: tipo ${s.tipo}`);
    }
  });
  test('los textos son únicos y el ruido siempre espera monto 0', () => {
    assert.equal(new Set(samples.map(s => s.text)).size, samples.length);
    for (const s of samples.filter(x => x.tipo === 'ruido')) assert.equal(s.esperado.monto, 0, s.text);
  });
});

describe('parseNoti sobre docs/nequi-samples.json', { skip: !hay && 'docs/nequi-samples.json no existe' }, () => {
  for (const s of samples) {
    test(`[${s.tipo}] ${s.text}`, () => {
      const r = core.parseNoti(s.text);
      assert.deepEqual({ monto: r.monto, dir: r.dir, quien: r.quien }, { monto: s.esperado.monto || 0, dir: s.esperado.dir || '?', quien: s.esperado.quien || '' });
    });
  }
});
