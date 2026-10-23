'use strict';
// Exige que app/quick.js no empeore en el corpus de entrenamiento (SPEC §12.1).
// El umbral vive en tests/corpus/umbral.json: el Frontend lo sube a medida que mejora el parser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { scoreFile } = require('./score.js');

const FRASES = path.join(__dirname, 'frases.json');
const UMBRALES = JSON.parse(fs.readFileSync(path.join(__dirname, 'umbral.json'), 'utf8'));
const UMBRAL = UMBRALES.global;
const FRASES2 = path.join(__dirname, 'frases2.json');
const FRASES3 = path.join(__dirname, 'frases3.json');

test(`corpus §12.1: frases.json ≥ ${UMBRAL}% de frases totalmente correctas`, () => {
  const r = scoreFile(FRASES);
  assert.ok(r.total >= 450, `el corpus debe tener ≥450 casos (tiene ${r.total})`);
  assert.ok(r.pct >= UMBRAL,
    `bajó el acierto del registro rápido: ${r.pct}% < umbral ${UMBRAL}%. Corre: node tests/corpus/score.js tests/corpus/frases.json --fallos`);
});

test(`corpus §12.1: frases2.json ≥ ${UMBRALES.frases2}% de frases totalmente correctas`, () => {
  const r = scoreFile(FRASES2);
  assert.ok(r.total >= 220, `frases2.json debe tener ≥220 casos (tiene ${r.total})`);
  assert.ok(r.pct >= UMBRALES.frases2,
    `bajó el acierto en frases2: ${r.pct}% < umbral ${UMBRALES.frases2}%. Corre: node tests/corpus/score.js tests/corpus/frases2.json --fallos`);
});

test(`corpus §12.1: frases3.json ≥ ${UMBRALES.frases3}% de frases totalmente correctas`, () => {
  const r = scoreFile(FRASES3);
  assert.ok(r.total >= 240, `frases3.json debe tener ≥240 casos (tiene ${r.total})`);
  assert.ok(r.pct >= UMBRALES.frases3,
    `bajó el acierto en frases3: ${r.pct}% < umbral ${UMBRALES.frases3}%. Corre: node tests/corpus/score.js tests/corpus/frases3.json --fallos`);
});

test('corpus §12.1: los casos tienen el formato acordado', () => {
  const casos = JSON.parse(fs.readFileSync(FRASES, 'utf8')).concat(JSON.parse(fs.readFileSync(FRASES2, 'utf8')), JSON.parse(fs.readFileSync(FRASES3, 'utf8')));
  const KINDS = new Set(['compra', 'venta', 'gasto', 'ingreso', 'cobro', 'abono', 'transfer', 'reparto']);
  const ids = new Set();
  for (const c of casos) {
    assert.ok(c.id && !ids.has(c.id), 'id repetido o vacío: ' + c.id); ids.add(c.id);
    assert.equal(typeof c.texto, 'string');
    assert.ok(c.grupo && c.ctx, c.id + ' sin grupo/ctx');
    assert.ok(Array.isArray(c.esperado) && c.esperado.length, c.id + ' sin esperado');
    for (const e of c.esperado) {
      assert.ok(KINDS.has(e.kind), c.id + ' kind raro ' + e.kind);
      for (const k of ['monto', 'bolsillo', 'cat', 'tipo', 'desc', 'tradeIn', 'fecha']) assert.ok(k in e, c.id + ' falta ' + k);
    }
  }
});
