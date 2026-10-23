'use strict';
// Equipos: pedidos de clientes (aviso al comprar) y calculadora de negociación.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../helpers/core');
const { bootApp, e2eSkipReason, norm } = require('../e2e/harness');
const SKIP = e2eSkipReason();

// las herramientas nuevas viven en Más → 🧰 Extras, no en las pestañas principales
const irAExtras = app => { app.click('[data-testid="tab-mas"]'); app.click('[data-testid="mas-extras"]'); };
const guardar = async app => { app.submit('#sheetForm'); await app.settle(); };

describe('pedidos de clientes', { skip: SKIP }, () => {
  test('crear un pedido y que al comprar ese modelo avise quién lo buscaba', async () => {
    const app = await bootApp({ db: core.emptyDB(), cfg: { onboarded: true } });
    try {
      irAExtras(app);
      app.click('[data-testid="pedido-nuevo"]'); await app.settle();
      app.type('#f-modelo', 'iPhone 15 Pro 256'); app.type('#f-cliente', 'Mateo'); app.type('#f-tel', '300 123 4567');
      await guardar(app);
      const p = core.L(app.db, 'pedidos')[0];
      assert.equal(p.modelo, 'iPhone 15 Pro 256'); assert.equal(p.cliente, 'Mateo');
      // la pestaña lo muestra
      irAExtras(app);
      assert.match(norm(app.text('#extrasBody')), /iphone 15 pro 256[\s\S]*mateo/);
      // comprar ese modelo → aviso
      app.type('#qInput', 'compré un 15 pro 256 en 2.8 nequi'); app.submit('#qForm'); await app.settle();
      await guardar(app); await app.advance(900);
      assert.match(norm(app.text('body')), /mateo lo estaba buscando/);
      // la pestaña ahora marca que tienes uno en stock
      irAExtras(app);
      assert.match(norm(app.text('[data-testid="pedido"]')), /tienes 1/);
    } finally { app.close(); }
  });
  test('"ya se lo vendí" quita el pedido de la lista', async () => {
    const db = core.emptyDB();
    db.pedidos = [{ id: 'p1', modelo: 'iPhone 14', cliente: 'Ana', estado: '', fecha: '2026-10-01', u: 1 }];
    const app = await bootApp({ db, cfg: { onboarded: true } });
    try {
      irAExtras(app);
      app.click('[data-testid="pedido-ok"]'); await app.settle();
      assert.equal(app.$('[data-testid="pedido"]'), null);
      assert.equal(core.L(app.db, 'pedidos')[0].estado, 'cumplido');
    } finally { app.close(); }
  });
});

describe('Equipos queda limpio', { skip: SKIP }, () => {
  test('Equipos solo tiene En stock / Vendidos; nada de pedidos ni calculadora', async () => {
    const app = await bootApp({ db: core.emptyDB(), cfg: { onboarded: true } });
    try {
      app.click('[data-testid="tab-stock"]'); await app.settle();
      assert.equal(app.$('#stSeg [data-seg="pedidos"]'), null);
      assert.equal(app.$('#v-stock [data-testid="calc-abrir"]'), null);
      assert.equal(app.$('#v-stock [data-testid="publicar"]'), null);
    } finally { app.close(); }
  });
});

describe('calculadora de negociación', { skip: SKIP }, () => {
  test('calcula la ganancia en vivo y no registra nada', async () => {
    const app = await bootApp({ db: core.emptyDB(), cfg: { onboarded: true } });
    try {
      irAExtras(app);
      app.click('[data-testid="calc-abrir"]'); await app.settle();
      app.type('#calc-compra', '2100000'); app.type('#calc-venta', '2500000'); await app.settle();
      assert.match(norm(app.text('[data-testid="calc-resultado"]')), /ganarias[\s\S]*400\.000/);
      assert.equal(core.L(app.db, 'items').length, 0, 'la calculadora no registra');
    } finally { app.close(); }
  });
});
