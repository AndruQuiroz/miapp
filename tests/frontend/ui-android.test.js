'use strict';
// App de Android: window.MiAppNativo (simulado) → captura de Nequi a "Por clasificar", eventos de la notificación, dictado nativo, Ajustes.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../helpers/core');
const { bootApp, e2eSkipReason, norm } = require('../e2e/harness');
const SKIP = e2eSkipReason();
const CFG = { onboarded: true };

function nativo(cola, extra) {
  const st = { cola: cola.slice(), confirmados: [], abiertos: [], escuchando: null, estado: { leerNotis: true, avisos: true, bateria: false, marca: 'Xiaomi', capturas: 3, version: '1.0.7' } };
  const n = Object.assign({
    pendientes: () => JSON.stringify(st.cola),
    confirmar: ids => { const s = new Set(JSON.parse(ids)); st.confirmados.push(...s); st.cola = st.cola.filter(x => !s.has(x.id)); return s.size; },
    estado: () => JSON.stringify(st.estado),
    abrir: q => st.abiertos.push(q),
    escuchar: cb => { st.escuchando = cb; },
    listo: () => {}, probar: () => {}, guardarArchivo: () => true, version: () => '1.0.7'
  }, extra || {});
  return { st, globals: { MiAppNativo: n } };
}
const NQ = { id: 'n1', t: Date.parse('2026-10-05T09:00:00-05:00'), pkg: 'com.nequi.MobileApp', texto: 'Nequi Recibiste $1.600.000 de CAMILO PEREZ' };

describe('app de Android', { skip: SKIP }, () => {
  test('al abrir trae lo capturado de Nequi a "Por clasificar" una sola vez', async () => {
    const N = nativo([NQ, Object.assign({}, NQ, { id: 'n2' })]);
    const app = await bootApp({ db: core.emptyDB(), cfg: CFG, globals: N.globals });
    try {
      await app.settle();
      const p = core.L(app.db, 'pend');
      assert.equal(p.length, 1, 'la misma notificación repetida no se duplica');
      assert.deepEqual([p[0].monto, p[0].dir, p[0].quien, p[0].bolsillo, p[0].fecha], [1600000, 'in', 'CAMILO PEREZ', 'nequi', '2026-10-05']);
      assert.deepEqual(N.st.confirmados.sort(), ['n1', 'n2']);
      app.window.miappNativoSync(); await app.settle();
      assert.equal(core.L(app.db, 'pend').length, 1);
    } finally { app.close(); }
  });
  test('tocar "🎙️ Contar" en la notificación abre ¿Qué fue esto? y el dictado nativo; al registrar se quita el pendiente', async () => {
    const N = nativo([NQ]);
    const app = await bootApp({ db: core.emptyDB(), cfg: CFG, globals: N.globals });
    try {
      app.window.miappNativoEvento({ accion: 'voz', noti: NQ.texto, id: 'n1' }); await app.advance(500);
      assert.match(norm(app.text('#sheetTitle')), /que fue esto/);
      assert.ok(N.st.escuchando, 'pidió el dictado al teléfono');
      app.window[N.st.escuchando]('abono de camilo'); await app.advance(800); await app.settle();
      assert.match(app.$('#qInput').value, /abono de camilo 1600000/);
      assert.equal(core.L(app.db, 'pend').length, 0);
    } finally { app.close(); }
  });
  test('botón atrás: cierra la hoja, luego vuelve a Inicio, luego deja salir', async () => {
    const N = nativo([]);
    const app = await bootApp({ db: core.emptyDB(), cfg: CFG, globals: N.globals });
    try {
      app.click('[data-testid="tab-stock"]');
      app.window.miappNativoEvento({ accion: 'voz' }); await app.advance(400);
      assert.equal(app.window.miappAtras(), true);
      assert.equal(app.window.miappAtras(), true);
      assert.equal(app.window.miappAtras(), false);
    } finally { app.close(); }
  });
  test('Ajustes muestra los permisos y abre el ajuste del teléfono', async () => {
    const N = nativo([]);
    const app = await bootApp({ db: core.emptyDB(), cfg: CFG, globals: N.globals });
    try {
      app.click('[data-testid="tab-mas"]'); app.click('#masSeg [data-seg="ajustes"]'); await app.settle();
      assert.match(norm(app.text('[data-testid="and-leer"]')), /activo · 3 capturadas/);
      app.click('[data-testid="and-bateria"] [data-a="andAbrir"]');
      assert.deepEqual(N.st.abiertos, ['bateria']);
      assert.ok(app.$('[data-testid="and-auto"]'), 'en Xiaomi/Poco muestra Inicio automático');
    } finally { app.close(); }
  });
  test('en el navegador: ofrece descargar la APK', async () => {
    const app = await bootApp({ db: core.emptyDB(), cfg: CFG });
    try {
      app.click('[data-testid="tab-mas"]'); app.click('#masSeg [data-seg="ajustes"]'); await app.settle();
      assert.match(app.$('[data-testid="and-bajar"]').getAttribute('href'), /releases\/latest\/download\/MiApp\.apk/);
    } finally { app.close(); }
  });
});

describe('widget y recordatorios', { skip: SKIP }, () => {
  test('cada cambio le deja al teléfono el resumen (caja, pendientes, cobros con fecha, semana)', async () => {
    let ultimo = null;
    const N = nativo([NQ], { resumen: j => { ultimo = JSON.parse(j); } });
    const db = core.emptyDB();
    db.bolsillos = db.bolsillos.map(b => Object.assign({}, b, { ini: b.id === 'nequi' ? 500000 : 0, u: 5 }));
    db.cobros = [{ id: 'c1', nombre: 'Camilo', total: 300000, pagado: 0, bolsillo: '', fecha: '2026-10-01', compromiso: '2026-10-04', u: 1 }];
    const app = await bootApp({ db, cfg: CFG, globals: N.globals });
    try {
      await app.advance(600);
      assert.ok(ultimo, 'mandó el resumen al abrir');
      assert.equal(ultimo.caja, 500000); assert.equal(ultimo.pend, 1); assert.equal(ultimo.deben, 300000); assert.equal(ultimo.vencidos, 1);
      assert.deepEqual(ultimo.cobros, [{ nombre: 'Camilo', pend: 300000, compromiso: '2026-10-04' }]);
      assert.match(ultimo.semana, /Caja/);
      assert.equal(ultimo.recDiario, true);
      app.type('#qInput', 'almuerzo 18 mil'); app.submit('#qForm'); await app.settle(); app.submit('#sheetForm'); await app.advance(600);
      assert.equal(ultimo.caja, 482000);
      app.click('[data-testid="tab-mas"]'); app.click('#masSeg [data-seg="ajustes"]'); await app.settle();
      app.click('[data-testid="and-widgetPlata"] [data-a="andToggle"]'); await app.settle();
      assert.equal(ultimo.widgetPlata, false);
    } finally { app.close(); }
  });
  test('el botón 💬 del widget abre el asistente', async () => {
    const N = nativo([]);
    const app = await bootApp({ db: core.emptyDB(), cfg: CFG, globals: N.globals });
    try {
      app.window.miappNativoEvento({ accion: 'asis' }); await app.settle();
      assert.match(norm(app.text('#sheetTitle')), /hablale a tu app/);
    } finally { app.close(); }
  });
});

describe('gastos automáticos (pagos con la tarjeta Nequi)', { skip: SKIP }, () => {
  const T0 = Date.parse('2026-10-05T09:00:00-05:00');
  const noti = (id, texto, min, pkg) => ({ id, t: T0 + (min || 0) * 60000, pkg: pkg || 'com.nequi.MobileApp', texto });
  test('todo "Pagaste … en …" se anota solo (conocido con su categoría, desconocido en Otro, sin límite de monto); el mismo pago dos veces cuenta una', async () => {
    const N = nativo([
      noti('s1', 'NEQUI: Pagaste 35.500,00 en RAPPI COLOMBIA*DL'),
      noti('a1', 'Nequi Pagaste $35.500 en RAPPI COLOMBIA', 1),
      noti('s2', 'NEQUI: Pagaste 3.000,00 en CENTRO COMERCIAL LOS MOLI', 5),
      noti('s3', 'NEQUI: Pagaste 26.900,00 en FRISBY Q58', 10),
      noti('s4', 'NEQUI: Pagaste 41.145,00 en JUANBE SANDIEGO', 20),
      noti('s5', 'NEQUI: Pagaste 450.000,00 en ARTURO CALLE', 30),
      noti('a2', 'Nequi Enviaste $20.000 a JUAN PEREZ', 40)
    ]);
    const app = await bootApp({ db: core.emptyDB(), cfg: CFG, globals: N.globals });
    try {
      await app.settle();
      const g = core.L(app.db, 'gastos').sort((a, b) => a.t - b.t);
      assert.deepEqual(g.map(x => [x.desc, x.valor, x.cat]), [
        ['Rappi', 35500, 'Comida'], ['Parqueadero C.C. Los Molinos', 3000, 'Transporte'], ['Frisby', 26900, 'Comida'],
        ['Juanbe Sandiego', 41145, 'Otro'], ['Arturo Calle', 450000, 'Personal']]);
      assert.deepEqual(core.L(app.db, 'pend').map(x => [x.monto, x.quien]), [[20000, 'JUAN PEREZ']], 'el envío a una persona pregunta');
    } finally { app.close(); }
  });
  test('reverso / devolución / reembolso → pregunta (por clasificar), no toca el gasto', async () => {
    const N = nativo([noti('s1', 'NEQUI: Pagaste 35.500,00 en RAPPI COLOMBIA*DL'),
      noti('r1', 'NEQUI: Reversamos 35.500,00 de tu compra en RAPPI COLOMBIA*DL a tu Tarjeta', 90),
      noti('r2', 'Nequi Te devolvimos $12.000 de tu compra en GOOGLE PLAY', 95)]);
    const app = await bootApp({ db: core.emptyDB(), cfg: CFG, globals: N.globals });
    try {
      await app.settle();
      assert.deepEqual(core.L(app.db, 'gastos').map(x => x.desc), ['Rappi']);
      assert.deepEqual(core.L(app.db, 'pend').map(x => [x.monto, x.dir]).sort((a, b) => a[0] - b[0]), [[12000, 'in'], [35500, 'in']]);
    } finally { app.close(); }
  });
  test('"No era eso" devuelve el gasto a por clasificar; lo que aprendió también se anota solo', async () => {
    const box = { rech: [] };
    const db = core.emptyDB();
    db.reglas = [{ id: 'juanbe sandiego', kind: 'gasto', desc: 'Juanbe (ropa)', cat: 'Personal', tipo: 'personal', u: 1 }];
    const N = nativo([noti('s3', 'NEQUI: Pagaste 26.900,00 en FRISBY Q58'), noti('s4', 'NEQUI: Pagaste 41.145,00 en JUANBE SANDIEGO', 5)],
      { rechazados: () => JSON.stringify(box.rech), confirmarRechazos: ids => { box.rech = box.rech.filter(x => !JSON.parse(ids).includes(x)); } });
    const app = await bootApp({ db, cfg: CFG, globals: N.globals });
    try {
      await app.settle();
      assert.deepEqual(core.L(app.db, 'gastos').map(x => [x.desc, x.cat]).sort(), [['Frisby', 'Comida'], ['Juanbe (ropa)', 'Personal']]);
      box.rech = ['s3'];
      app.window.miappNativoSync(); await app.settle();
      assert.deepEqual(core.L(app.db, 'gastos').map(x => x.desc), ['Juanbe (ropa)']);
      assert.deepEqual(core.L(app.db, 'pend').map(x => [x.monto, x.quien]), [[26900, 'Frisby']]);
    } finally { app.close(); }
  });
});
