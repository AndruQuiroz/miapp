/* Pruebas del backend (dist/apps-script/Code.gs) con un Google Apps Script falso en memoria.
   Ejecutar: node --test server/test/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const core = require('../../app/core.js');
const {build} = require('../build.js');

build(); // siempre probamos el Code.gs recién generado
const {makeEnv, formatDate} = require('./env.js');

const HOY = () => formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');
let T = Date.now();
const tick = () => ++T;

/* ── Constructores de registros ── */
const item = o => Object.assign({id: 'i' + tick(), u: tick(), desc: 'Producto', cat: 'Otro', cond: 'bueno', notes: '',
  buyPrice: 0, buyPocket: 'nequi', buyDate: HOY(), targetPrice: null, status: 'stock',
  sellPrice: 0, sellPaid: null, sellPocket: '', sellDate: '', sellNotes: ''}, o);
const gasto = o => Object.assign({id: 'g' + tick(), u: tick(), desc: 'Gasto', valor: 0, cat: 'Otro', tipo: 'personal', bolsillo: 'nequi', fecha: HOY()}, o);
const sorted = db => {
  const o = {};
  core.COLS.forEach(c => { o[c] = (db[c] || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id))); });
  return JSON.parse(JSON.stringify(o));
};

/** Un "celular": guarda su DB local y sincroniza como la app (POST sync + mergeDB local). */
function phone(env) {
  const p = {
    db: core.emptyDB(),
    sync() {
      const r = env.sync(p.db);
      assert.equal(r.ok, true, 'sync falló: ' + r.error);
      p.db = core.mergeDB(p.db, r.db);
      return r;
    },
    edit(col, id, cambios) {
      p.db[col] = p.db[col].map(r => (r.id === id ? Object.assign({}, r, cambios, {u: tick()}) : r));
    }
  };
  return p;
}

const rowsOf = (env, n) => env.sheet(n).rows();
const rowBy = (rows, label) => rows.find(r => r[0] === label);

/* ═════════════ setup / clave ═════════════ */

test('setup crea la clave (16 caracteres), las hojas, oculta _db y es idempotente', () => {
  const env = makeEnv();
  assert.equal(env.ctx.verClave(), '');
  assert.match(env.logs.join('\n'), /ejecuta primero la función setup/);

  const k = env.setup();
  assert.match(k, /^[a-km-np-z2-9]{16}$/);
  assert.equal(env.store.KEY, k);
  assert.ok(env.logs.includes('TU CLAVE: ' + k), 'debe imprimir TU CLAVE: xxxx');
  for (const n of ['Resumen', 'Inventario', 'Gastos', 'Ingresos', 'Cobros', 'Bolsillos', 'Apartados', '_db']) {
    assert.ok(env.sheet(n), 'falta la hoja ' + n);
  }
  assert.equal(env.sheet('_db').isSheetHidden(), true);
  assert.equal(env.sheet('Resumen').isSheetHidden(), false);
  // Encabezados en negrita y fila congelada
  assert.deepEqual(rowsOf(env, 'Gastos'), [['Fecha', 'Descripción', 'Categoría', 'Tipo', 'Bolsillo', 'Apartado', 'Valor']]);
  assert.equal(env.sheet('Gastos').weights['1,1'], 'bold');
  assert.equal(env.sheet('Gastos').getFrozenRows(), 1);

  // Repetir setup: misma clave, sin hojas duplicadas
  env.sheet('_db').showSheet();
  const nHojas = env.ss.getSheets().length;
  assert.equal(env.setup(), k);
  assert.equal(env.ss.getSheets().length, nHojas);
  assert.equal(env.sheet('_db').isSheetHidden(), true, 'setup vuelve a ocultar _db');
  assert.equal(env.ctx.verClave(), k);

  // Dos instalaciones distintas → claves distintas
  const otra = makeEnv();
  assert.notEqual(otra.setup(), k);
});

test('clave incorrecta, sin clave o sin setup → error en español', () => {
  const env = makeEnv();
  assert.deepEqual(env.parse(env.get({action: 'ping', key: 'x'})), {ok: false, error: 'Falta ejecutar setup en Apps Script'});
  env.setup();
  const mal = {ok: false, error: 'Clave incorrecta'};
  assert.deepEqual(env.parse(env.get({action: 'ping', key: 'mala'})), mal);
  assert.deepEqual(env.parse(env.get({action: 'ping'})), mal);
  assert.deepEqual(env.sync(core.emptyDB(), 'mala'), mal);
  assert.deepEqual(env.parse(env.post({action: 'capture', key: 'mala'}, 'Enviaste $1.000 a PRUEBA')), mal);
  assert.equal(env.stored().pend.length, 0);
  for (const action of ['summary', 'reminders']) {
    const out = env.get({action, key: 'mala'});
    assert.equal(out.getMimeType(), 'TEXT');
    assert.equal(out.getContent(), 'Clave incorrecta');
  }
  // Espacios al copiar/pegar la clave se toleran
  assert.deepEqual(env.parse(env.get({action: 'ping', key: '  ' + env.key() + ' '})), {ok: true});
});

test('ping, URL abierta en el navegador, acción desconocida y JSON inválido', () => {
  const env = makeEnv();
  env.setup();
  const k = env.key();
  assert.deepEqual(env.parse(env.get({action: 'ping', key: k})), {ok: true});
  assert.deepEqual(env.parse(env.post({}, JSON.stringify({action: 'ping', key: k}))), {ok: true});
  const nav = env.parse(env.get({}));
  assert.equal(nav.ok, true);
  assert.match(nav.mensaje, /servidor funcionando/);
  assert.deepEqual(env.parse(env.get({action: 'borrar', key: k})), {ok: false, error: 'Acción desconocida: borrar'});
  assert.deepEqual(env.parse(env.post({}, '{esto no es json')), {ok: false, error: 'Datos inválidos: se esperaba JSON'});
  assert.equal(env.parse(env.get({action: 'sync', key: k})).ok, false);
  assert.deepEqual(env.parse(env.post({}, JSON.stringify({action: 'sync', key: k, db: [1, 2]}))),
    {ok: false, error: 'Datos inválidos: db debe ser un objeto'});
});

/* ═════════════ sync ═════════════ */

test('sync ida y vuelta: dos celulares con cambios distintos (y borrados) convergen', () => {
  const env = makeEnv();
  env.setup();
  const A = phone(env), B = phone(env);

  // A: saldos iniciales, dos compras y un gasto
  A.db.bolsillos = A.db.bolsillos.map(b => (b.id === 'nequi_pareja' ? b : Object.assign({}, b, {ini: b.id === 'nequi' ? 500000 : 100000, u: tick()})));
  A.db.items.push(item({id: 'i1', desc: 'PS5', cat: 'Consolas', buyPrice: 1200000}));
  A.db.items.push(item({id: 'i2', desc: 'Tenis', cat: 'Calzado', buyPrice: 90000}));
  A.db.gastos.push(gasto({id: 'g1', desc: 'Envío', valor: 12000, cat: 'Envíos', tipo: 'negocio'}));
  A.sync();
  B.sync();
  assert.deepEqual(sorted(B.db), sorted(A.db), 'B recibe todo lo de A');

  // Cambios en paralelo, sin sincronizar entre ellos
  A.edit('gastos', 'g1', {desc: 'Envío Bogotá'});                   // A edita g1 (más viejo)…
  B.edit('gastos', 'g1', {del: 1});                                 // …B lo borra después → gana el borrado
  B.edit('items', 'i1', {status: 'sold', sellPrice: 1500000, sellPaid: 1500000, sellPocket: 'efectivo', sellDate: HOY()});
  B.db.ingresos.push({id: 'in1', u: tick(), desc: 'Sueldo', valor: 1300000, bolsillo: 'nequi', fecha: HOY()});
  A.edit('items', 'i2', {del: 1});                                  // A borra i2
  A.db.cobros.push({id: 'c1', u: tick(), nombre: 'Juan', tel: '3001234567', total: 200000, pagado: 0, bolsillo: 'nequi',
    fecha: HOY(), compromiso: '', notas: '', itemId: ''});

  A.sync(); B.sync(); A.sync();

  assert.deepEqual(sorted(A.db), sorted(B.db), 'los dos celulares quedan iguales');
  assert.deepEqual(sorted(env.stored()), sorted(A.db), 'y la nube también');
  const g1 = A.db.gastos.find(g => g.id === 'g1');
  assert.equal(g1.del, 1, 'el borrado lógico gana (no se borra físicamente)');
  assert.equal(A.db.items.find(i => i.id === 'i2').del, 1);
  assert.equal(A.db.items.find(i => i.id === 'i1').status, 'sold');
  assert.ok(A.db.cobros.find(c => c.id === 'c1'));
  assert.ok(B.db.ingresos.find(c => c.id === 'in1'));
  assert.equal(core.L(A.db, 'gastos').length, 0);
});

test('sync sin cambios NO reescribe nada (ni _db ni hojas legibles)', () => {
  const env = makeEnv();
  env.setup();
  const A = phone(env), B = phone(env);
  A.db.items.push(item({desc: 'Celular', buyPrice: 300000}));
  A.sync();
  const antes = env.ss.spies.setValues;
  A.sync();
  B.sync(); // B solo trae datos: tampoco escribe
  A.sync();
  assert.equal(env.ss.spies.setValues, antes, 'no debe llamar setValues si nada cambió');
  assert.equal(env.store.HOJAS_PENDIENTES, undefined);
  // Un cambio real sí escribe
  A.edit('items', A.db.items[0].id, {desc: 'Celular Xiaomi'});
  A.sync();
  assert.ok(env.ss.spies.setValues > antes);
});

test('DB grande (>200.000 caracteres) se trocea con "~" y se relee idéntica; sin partir emojis', () => {
  const env = makeEnv();
  env.setup();
  const db = core.emptyDB();
  for (let i = 0; i < 400; i++) {
    db.items.push(item({id: 'big' + i, desc: 'Producto ' + i + ' 🎮', notes: 'x'.repeat(480) + ' ñáé😀 "comillas" \\ \n'}));
  }
  const r = env.sync(db);
  assert.equal(r.ok, true);
  const json = JSON.stringify(r.db);
  assert.ok(json.length > 200000, 'la prueba necesita más de 200.000 caracteres: ' + json.length);

  const sh = env.sheet('_db');
  const filas = sh.rows();
  assert.ok(filas.length >= 5, 'debe usar varias celdas: ' + filas.length);
  filas.forEach(([v], i) => {
    assert.equal(typeof v, 'string');
    assert.equal(v[0], '~', 'cada trozo empieza con ~');
    assert.ok(v.length <= 45001, 'trozo ' + i + ' demasiado largo');
    assert.equal(sh.formats[(i + 1) + ',1'], '@', 'columna A con formato texto');
  });
  assert.deepEqual(env.stored(), JSON.parse(json));
  assert.deepEqual(sorted(phone(env).sync().db), sorted(r.db), 'otro celular la recibe completa');

  // Un emoji justo en el borde de un trozo no se daña
  const base = JSON.stringify(Object.assign(core.emptyDB(), {items: [{id: 'e', u: 5, notes: '@@@'}]}));
  const pad = 44999 - base.indexOf('@@@');
  const conEmoji = Object.assign(core.emptyDB(), {items: [{id: 'e', u: 5, notes: 'a'.repeat(pad) + '😀😀 fin'}]});
  const s = JSON.stringify(conEmoji);
  assert.ok(s.charCodeAt(44999) >= 0xD800 && s.charCodeAt(44999) <= 0xDBFF, 'el emoji cae en el borde');
  env.ctx.writeDB_(s);
  assert.deepEqual(env.stored(), conEmoji);

  // Si la base se achica, se limpian las celdas sobrantes
  env.ctx.writeDB_(JSON.stringify(core.emptyDB()));
  assert.equal(sh.getLastRow(), 1);
  assert.deepEqual(env.stored(), core.emptyDB());
});

test('_db dañada → error claro y NO se sobrescribe', () => {
  const env = makeEnv();
  env.setup();
  const A = phone(env);
  A.db.items.push(item({desc: 'Algo'}));
  A.sync();
  env.sheet('_db').data[0][0] = '~{roto';
  const antes = env.ss.spies.setValues;
  const r = env.sync(A.db);
  assert.equal(r.ok, false);
  assert.match(r.error, /No pude leer la hoja _db/);
  assert.equal(env.ss.spies.setValues, antes);
  assert.equal(env.sheet('_db').data[0][0], '~{roto');
});

/* ═════════════ capture ═════════════ */

test('capture por POST: agrega pend correcto, usa el bolsillo del parámetro y deduplica 10 min', () => {
  const env = makeEnv();
  env.setup();
  const k = env.key();
  const cap = (body, params, type) => env.parse(env.post(Object.assign({action: 'capture', key: k}, params), body, type));

  assert.deepEqual(cap('Nequi:  Enviaste $12.000 a SERVIENTREGA SA', {bolsillo: 'efectivo'}), {ok: true, added: true});
  let pend = env.stored().pend;
  assert.equal(pend.length, 1);
  const p = pend[0];
  assert.match(p.id, /^p/);
  assert.equal(p.raw, 'Nequi: Enviaste $12.000 a SERVIENTREGA SA');
  assert.equal(p.monto, 12000);
  assert.equal(p.dir, 'out');
  assert.equal(p.quien, 'SERVIENTREGA SA');
  assert.equal(p.bolsillo, 'efectivo');
  assert.equal(p.fecha, HOY());
  assert.equal(typeof p.u, 'number');

  // Misma notificación al rato → no se repite
  const rep = cap('Nequi: Enviaste $12.000 a SERVIENTREGA SA', {bolsillo: 'efectivo'});
  assert.deepEqual(rep, {ok: true, added: false}, 'respuesta exacta del contrato');
  assert.equal(env.stored().pend.length, 1);

  // 11 minutos después sí entra (es otro movimiento)
  env.clock.now = Date.now() + 11 * 60 * 1000;
  assert.equal(cap('Nequi: Enviaste $12.000 a SERVIENTREGA SA', {bolsillo: 'efectivo'}).added, true);
  assert.equal(env.stored().pend.length, 2);

  // Aunque ya la hayan clasificado (pend borrado), el repetido inmediato se ignora
  const A = phone(env);
  A.sync();
  const ultimo = A.db.pend.find(x => x.id !== p.id);
  A.edit('pend', ultimo.id, {del: 1});
  A.sync();
  assert.equal(cap('Nequi: Enviaste $12.000 a SERVIENTREGA SA', {bolsillo: 'efectivo'}).added, false);

  // Entrada, sin bolsillo → nequi
  assert.equal(cap('Recibiste $50.000 de JUAN PEREZ').added, true);
  const entrada = env.stored().pend.find(x => x.monto === 50000);
  assert.equal(entrada.dir, 'in');
  assert.equal(entrada.quien, 'JUAN PEREZ');
  assert.equal(entrada.bolsillo, 'nequi');

  // El bolsillo se acepta por nombre ("Efectivo ")
  assert.equal(cap('Pagaste $8.000 en TIENDA D1', {bolsillo: 'Efectivo '}).added, true);
  assert.equal(env.stored().pend.find(x => x.monto === 8000).bolsillo, 'efectivo');

  // Content-Type de formulario: se lee igual el cuerpo crudo
  assert.equal(cap('Pagaste $35.900 en RAPPI COLOMBIA', {'Pagaste $35.900 en RAPPI COLOMBIA': ''},
    'application/x-www-form-urlencoded').added, true);
  assert.equal(env.stored().pend.find(x => x.monto === 35900).quien, 'RAPPI COLOMBIA');

  // Cuerpo "text=..." codificado
  assert.equal(cap('text=Pagaste%20%2420.000%20en%20MERCADO').added, true);
  assert.equal(env.stored().pend.find(x => x.monto === 20000).raw, 'Pagaste $20.000 en MERCADO');
});

test('capture sin monto no agrega ni escribe', () => {
  const env = makeEnv();
  env.setup();
  const antes = env.ss.spies.setValues;
  for (const body of ['Tienes una nueva notificación de Nequi', '', '   ']) {
    const r = env.parse(env.post({action: 'capture', key: env.key()}, body));
    assert.deepEqual(r, {ok: true, added: false});
  }
  assert.equal(env.stored().pend.length, 0);
  assert.equal(env.ss.spies.setValues, antes);
});

test('capture por GET con text', () => {
  const env = makeEnv();
  env.setup();
  const r = env.parse(env.get({action: 'capture', key: env.key(), bolsillo: 'nequi', text: 'Enviaste $1.000 a PRUEBA'}));
  assert.deepEqual(r, {ok: true, added: true});
  const p = env.stored().pend[0];
  assert.equal(p.monto, 1000);
  assert.equal(p.dir, 'out');
  assert.equal(p.quien, 'PRUEBA');
  assert.equal(p.bolsillo, 'nequi');
});

test('capture es rápido: no reescribe hojas legibles; el siguiente sync las pone al día una vez', () => {
  const env = makeEnv();
  env.setup();
  const resumen = env.sheet('Resumen');
  const vistas = resumen.spies.setValues;
  const r = env.parse(env.post({action: 'capture', key: env.key()}, 'Enviaste $1.000 a PRUEBA'));
  assert.equal(r.added, true);
  assert.equal(resumen.spies.setValues, vistas, 'capture no toca las hojas legibles');
  assert.equal(env.store.HOJAS_PENDIENTES, '1');

  const db0 = env.sheet('_db').spies.setValues;
  phone(env).sync(); // sin cambios en datos, pero refresca hojas pendientes
  assert.equal(env.sheet('_db').spies.setValues, db0, 'no reescribe _db');
  assert.equal(resumen.spies.setValues, vistas + 1);
  assert.equal(rowBy(rowsOf(env, 'Resumen'), 'Por clasificar')[1], 1);
  assert.equal(env.store.HOJAS_PENDIENTES, undefined);

  const total = env.ss.spies.setValues;
  phone(env).sync();
  assert.equal(env.ss.spies.setValues, total, 'el siguiente sync ya no escribe');
});

/* ═════════════ summary / reminders ═════════════ */

test('summary y reminders devuelven texto plano', () => {
  const env = makeEnv();
  env.setup();
  const k = env.key();
  let s = env.get({action: 'summary', key: k});
  assert.equal(s.getMimeType(), 'TEXT');
  assert.match(s.getContent(), /^📊 Sin ventas esta semana\n💸 Gastos \$0/);
  let r = env.get({action: 'reminders', key: k});
  assert.equal(r.getMimeType(), 'TEXT');
  assert.equal(r.getContent(), '', 'sin nada que avisar → vacío');

  const A = phone(env);
  A.db.items.push(item({desc: 'PS5', buyPrice: 1200000, status: 'sold', sellPrice: 1500000, sellPaid: 1500000, sellPocket: 'efectivo', sellDate: HOY()}));
  A.db.cobros.push({id: 'c1', u: tick(), nombre: 'Juan Pérez', tel: '', total: 200000, pagado: 0, bolsillo: '',
    fecha: HOY(), compromiso: core.shiftDate(HOY(), -1), notas: '', itemId: ''});
  A.sync();
  env.parse(env.post({action: 'capture', key: k}, 'Enviaste $1.000 a PRUEBA'));

  s = env.get({action: 'summary', key: k}).getContent();
  assert.match(s, /📊 1 venta por \$1\.5M · utilidad \$300K/);
  assert.match(s, /🤝 Te deben \$200K: Juan \$200K/);
  assert.match(s, /📲 1 movimiento por clasificar/);
  r = env.get({action: 'reminders', key: k}).getContent();
  assert.match(r, /🤝 Juan Pérez debía pagarte el .*: \$200K/);
  assert.match(r, /📲 Tienes 1 movimiento por clasificar/);
  assert.equal(r, env.run('remindersText(readDB_())'));
});

/* ═════════════ hojas legibles ═════════════ */

test('hojas legibles: filas, formatos y texto peligroso escapado', () => {
  const env = makeEnv();
  env.setup();
  const A = phone(env);
  const hoy = HOY();
  A.db.bolsillos = A.db.bolsillos.map(b => (b.id === 'nequi_pareja' ? b : Object.assign({}, b, {ini: b.id === 'nequi' ? 500000 : 100000, u: tick()})));
  A.db.items.push(
    item({id: 'i1', desc: 'PS5', cat: 'Consolas', buyPrice: 1200000, buyPocket: 'nequi', targetPrice: 1500000}),
    item({id: 'i2', desc: 'Xbox', cat: 'Consolas', buyPrice: 800000, buyPocket: 'nequi', status: 'sold',
      sellPrice: 1000000, sellPaid: 700000, sellPocket: 'efectivo', sellDate: hoy}),
    item({id: 'i3', desc: 'Borrado', buyPrice: 5000, del: 1}),
    item({id: 'i4', desc: '=HYPERLINK("http://x")', buyPrice: 50000, buyPocket: ''}));
  A.db.gastos.push(
    gasto({desc: 'Envío', valor: 12000, cat: 'Envíos', tipo: 'negocio', bolsillo: 'nequi'}),
    gasto({desc: '+Almuerzo', valor: 18000, cat: 'Comida', tipo: 'personal', bolsillo: 'efectivo'}),
    gasto({desc: 'Viejo', valor: 99999, del: 1}));
  A.db.ingresos.push({id: 'in1', u: tick(), desc: 'Sueldo', valor: 1300000, bolsillo: 'nequi', fecha: hoy});
  A.db.cobros.push({id: 'c1', u: tick(), nombre: 'Juan', tel: '+57 300 123 4567', total: 300000, pagado: 0, bolsillo: '',
    fecha: hoy, compromiso: '', notas: '@pendiente', itemId: 'i2'});
  A.db.abonos.push({id: 'a1', u: tick(), cobroId: 'c1', monto: 100000, bolsillo: 'efectivo', fecha: hoy});
  A.sync();

  // Inventario: 3 productos vivos, en stock primero
  const inv = rowsOf(env, 'Inventario');
  assert.equal(inv.length, 4);
  assert.deepEqual(inv[0].slice(0, 6), ['Producto', 'Categoría', 'Condición', 'Estado', 'Fecha compra', 'Costo']);
  assert.deepEqual(inv.slice(1).map(r => r[3]), ['En stock', 'En stock', 'Vendido']);
  const xbox = inv.find(r => r[0] === 'Xbox');
  assert.equal(xbox[9], 1000000);  // precio venta
  assert.equal(xbox[10], 700000);  // cobrado
  assert.equal(xbox[11], 'Efectivo');
  assert.equal(xbox[12], 200000);  // ganancia
  assert.ok(inv.some(r => r[0] === "'=HYPERLINK(\"http://x\")"), 'fórmula escapada con apóstrofo');
  assert.equal(inv.find(r => r[0] === 'PS5')[7], 1500000);
  assert.equal(inv.find(r => r[0].includes('HYPERLINK'))[6], 'No salió de mis bolsillos');
  assert.equal(inv[0][14], 'Apartado');
  assert.ok(inv.slice(1).every(r => r[14] === '💼 Negocio'), 'los productos son plata del negocio');
  const shI = env.sheet('Inventario');
  assert.equal(shI.weights['1,1'], 'bold');
  assert.equal(shI.getFrozenRows(), 1);
  assert.equal(shI.formats['2,6'], '$#,##0');
  assert.equal(shI.formats['4,13'], '$#,##0');

  // Gastos: 2 vivos (el borrado no sale), texto con "+" escapado
  const gas = rowsOf(env, 'Gastos');
  assert.equal(gas.length, 3);
  assert.ok(gas.some(r => r[1] === "'+Almuerzo" && r[3] === 'Personal' && r[4] === 'Efectivo' && r[5] === '👤 Personal' && r[6] === 18000));
  assert.ok(gas.some(r => r[1] === 'Envío' && r[3] === 'Negocio' && r[5] === '💼 Negocio' && r[6] === 12000));
  assert.equal(env.sheet('Gastos').formats['2,7'], '$#,##0');

  assert.deepEqual(rowsOf(env, 'Ingresos'), [['Fecha', 'Descripción', 'Bolsillo', 'Apartado', 'Valor'], [hoy, 'Sueldo', 'Nequi', '👤 Personal', 1300000]]);

  const cob = rowsOf(env, 'Cobros');
  assert.equal(cob.length, 2);
  assert.deepEqual(cob[1], ['Juan', "'+57 300 123 4567", hoy, 300000, 100000, 200000, '', 'Pendiente', "'@pendiente"]);

  // Bolsillos = balances() de core
  const bal = core.balances(env.stored());
  const bol = rowsOf(env, 'Bolsillos');
  assert.deepEqual(bol.slice(1), [
    ['Efectivo', 100000, bal.efectivo],
    ['Nequi', 500000, bal.nequi],
    ['Nequi pareja', 0, 0],
    ['TOTAL', 600000, bal.efectivo + bal.nequi]]);

  // Apartados (SPEC §13): negocio = −1.2M −800K +700K −12K +100K (abono de la venta a crédito) = −1.212.000
  //                       personal = ini 600K − 18K + sueldo 1.3M = 1.882.000 → total 670.000 = total bolsillos
  const apa = rowsOf(env, 'Apartados');
  assert.deepEqual(apa, [
    ['Apartado', 'Saldo', 'Meta', 'Avance meta (%)', 'Nota'],
    ['💼 Negocio', -1212000, '', '', 'En rojo: se usó plata de otros apartados'],
    ['👤 Personal', 1882000, '', '', ''],
    ['TOTAL EN APARTADOS', 670000, '', '', ''],
    ['Total en bolsillos', 670000, '', '', '✅ Cuadra']]);
  assert.equal(env.sheet('Apartados').formats['2,2'], '$#,##0');
  assert.equal(env.sheet('Apartados').weights['1,1'], 'bold');
  assert.equal(env.sheet('Apartados').getFrozenRows(), 1);
  assert.equal(bal.nequi, 500000 - 1200000 - 800000 + 1300000 - 12000);
  assert.equal(bal.efectivo, 100000 + 700000 - 18000 + 100000);

  // Resumen = monthStats del mes actual
  const res = rowsOf(env, 'Resumen');
  const ms = core.monthStats(env.stored(), hoy.slice(0, 7));
  assert.deepEqual(res[0], ['Concepto', 'Valor']);
  assert.equal(rowBy(res, 'Ventas')[1], ms.ventas);
  assert.equal(rowBy(res, 'Utilidad neta')[1], 1000000 - 800000 - 12000);
  assert.equal(rowBy(res, 'Gastos personales')[1], 18000);
  assert.equal(rowBy(res, 'Compras de inventario')[1], ms.compras);
  assert.equal(rowBy(res, 'Te deben')[1], 200000);
  assert.equal(rowBy(res, 'Cobros pendientes')[1], 1);
  assert.equal(rowBy(res, 'En stock (costo)')[1], 1250000);
  assert.equal(rowBy(res, 'Productos en stock')[1], 2);
  assert.equal(rowBy(res, 'Caja total')[1], bal.efectivo + bal.nequi);
  assert.equal(rowBy(res, 'Nequi')[1], bal.nequi);
  assert.equal(rowBy(res, 'SALDOS POR APARTADO')[1], '');
  assert.equal(rowBy(res, '💼 Negocio')[1], -1212000);
  assert.equal(rowBy(res, '👤 Personal')[1], 1882000);
  const fila = res.findIndex(r => r[0] === 'Ventas') + 1;
  assert.equal(env.sheet('Resumen').formats[fila + ',2'], '$#,##0');
  assert.equal(env.sheet('Resumen').formats[(res.findIndex(r => r[0] === 'Número de ventas') + 1) + ',2'], undefined);
});

test('si las hojas legibles fallan, los datos se guardan igual y se reintenta luego', () => {
  const env = makeEnv();
  env.setup();
  const inv = env.sheet('Inventario');
  const original = inv.clearContents;
  inv.clearContents = () => { throw new Error('hoja protegida'); };
  const A = phone(env);
  A.db.items.push(item({desc: 'Bici'}));
  const r = A.sync();
  assert.match(r.aviso, /no pude actualizar las hojas legibles: hoja protegida/);
  assert.equal(env.stored().items.length, 1);
  assert.equal(env.store.HOJAS_PENDIENTES, '1');
  inv.clearContents = original;
  A.sync();
  assert.equal(env.store.HOJAS_PENDIENTES, undefined);
  assert.equal(rowsOf(env, 'Inventario')[1][0], 'Bici');
});

/* ═════════════ concurrencia ═════════════ */

test('tryLock fallido → "Ocupado, reintenta" (JSON o texto); el lock siempre se libera', () => {
  const env = makeEnv();
  env.setup();
  const k = env.key();
  env.lock.fail = true;
  const ocupado = {ok: false, error: 'Ocupado, reintenta'};
  assert.deepEqual(env.sync(core.emptyDB()), ocupado);
  assert.deepEqual(env.parse(env.post({action: 'capture', key: k}, 'Enviaste $1.000 a PRUEBA')), ocupado);
  assert.equal(env.get({action: 'summary', key: k}).getContent(), 'Ocupado, reintenta');
  assert.equal(env.get({action: 'reminders', key: k}).getMimeType(), 'TEXT');
  assert.deepEqual(env.parse(env.get({action: 'ping', key: k})), {ok: true}, 'ping no necesita el lock');
  assert.equal(env.lock.releases, 0);

  env.lock.fail = false;
  env.lock.tries = 0;
  phone(env).sync();
  env.get({action: 'summary', key: k});
  env.parse(env.post({action: 'capture', key: k}, 'sin monto'));
  assert.equal(env.lock.releases, env.lock.tries);
  assert.equal(env.lock.held, false);
});

test('el código cargado expone solo setup/verClave/doGet/doPost sin sufijo', () => {
  const src = require('fs').readFileSync(path.resolve(__dirname, '..', 'server.gs'), 'utf8');
  const {topNames, PUBLICAS} = require('../build.js');
  const libres = topNames(src).filter(n => !/_$/.test(n));
  assert.deepEqual(libres.sort(), PUBLICAS.slice().sort());
});

/* ═════════════ SPEC §13: Nequi pareja y apartados ═════════════ */

test('capture con bolsillo=nequi_pareja guarda el pend en ese bolsillo (también en una base vieja sin la semilla)', () => {
  const env = makeEnv();
  env.setup();
  // base guardada por una versión anterior: 10 colecciones y solo efectivo/nequi
  const vieja = {items: [], gastos: [], ingresos: [], cobros: [], abonos: [], transfers: [], ajustes: [], pend: [], reglas: [],
    bolsillos: [{id: 'efectivo', nombre: 'Efectivo', ini: 0, u: 1}, {id: 'nequi', nombre: 'Nequi', ini: 0, u: 1}]};
  env.ctx.writeDB_(JSON.stringify(vieja));
  const k = env.key();
  assert.deepEqual(env.parse(env.post({action: 'capture', key: k, bolsillo: 'nequi_pareja'}, 'Enviaste $25.000 a TIENDA')), {ok: true, added: true});
  assert.deepEqual(env.parse(env.get({action: 'capture', key: k, bolsillo: 'Nequi pareja', text: 'Recibiste $10.000 de ANA'})), {ok: true, added: true});
  const pend = env.stored().pend;
  assert.deepEqual(pend.map(p => [p.monto, p.dir, p.bolsillo]), [[25000, 'out', 'nequi_pareja'], [10000, 'in', 'nequi_pareja']]);
});

test('sync con una base guardada VIEJA: agrega las semillas una sola vez y luego no reescribe', () => {
  const env = makeEnv();
  env.setup();
  const vieja = {items: [], gastos: [], ingresos: [], cobros: [], abonos: [], transfers: [], ajustes: [], pend: [], reglas: [],
    bolsillos: [{id: 'efectivo', nombre: 'Efectivo', ini: 0, u: 1}, {id: 'nequi', nombre: 'Nequi', ini: 700000, u: 1790000000000}]};
  env.ctx.writeDB_(JSON.stringify(vieja));
  // un celular con la app VIEJA (sin semillas nuevas) sincroniza
  const r = env.sync(vieja);
  assert.equal(r.ok, true);
  const s = env.stored();
  assert.deepEqual(core.COLS.filter(c => !Array.isArray(s[c])), []);
  assert.deepEqual(s.bolsillos.map(b => b.id), ['efectivo', 'nequi', 'nequi_pareja']);
  assert.deepEqual(s.fondos.map(f => f.id), ['negocio', 'personal']);
  assert.equal(s.bolsillos.find(b => b.id === 'nequi').ini, 700000, 'no pisa lo que el usuario editó');
  assert.ok(Array.isArray(s.bolsillos.find(b => b.id === 'efectivo').alias));
  assert.deepEqual(rowsOf(env, 'Bolsillos').map(f => f[0]), ['Bolsillo', 'Efectivo', 'Nequi', 'Nequi pareja', 'TOTAL']);
  // ni el celular viejo ni uno nuevo provocan más escrituras
  const n = env.ss.spies.setValues;
  env.sync(vieja);
  const nuevo = phone(env);
  nuevo.sync();
  env.sync(core.mergeDB(vieja, core.emptyDB()));
  assert.equal(env.ss.spies.setValues, n, 'converge: no reescribe');
  assert.deepEqual(sorted(core.ensureSeeds(nuevo.db)), sorted(env.stored()));
});

test('hoja Apartados con apartados del usuario, meta, repartos y el chequeo de cuadre', () => {
  const env = makeEnv();
  env.setup();
  const A = phone(env);
  A.db.bolsillos = A.db.bolsillos.map(b => (b.id === 'nequi' ? Object.assign({}, b, {ini: 2000000, iniFondos: {negocio: 1500000}, u: tick()}) : b));
  A.db.fondos.push({id: 'arr', nombre: 'Arriendo', emoji: '🏠', alias: ['arriendo'], meta: 800000, orden: 2, u: tick()});
  A.db.repartos.push({id: 'r1', from: 'personal', to: 'arr', monto: 300000, fecha: HOY(), nota: '', u: tick()});
  A.db.gastos.push(gasto({desc: 'Mercado', valor: 50000, bolsillo: 'nequi_pareja', fondo: 'arr'}));
  A.sync();
  const apa = rowsOf(env, 'Apartados');
  assert.deepEqual(apa.slice(1), [
    ['💼 Negocio', 1500000, '', '', ''],
    ['👤 Personal', 200000, '', '', ''],
    ['🏠 Arriendo', 250000, 800000, 31.3, ''],
    ['TOTAL EN APARTADOS', 1950000, '', '', ''],
    ['Total en bolsillos', 1950000, '', '', '✅ Cuadra']]);
  assert.equal(rowsOf(env, 'Gastos')[1][5], '🏠 Arriendo');
  assert.equal(rowsOf(env, 'Gastos')[1][4], 'Nequi pareja');
  assert.deepEqual(rowsOf(env, 'Bolsillos').find(f => f[0] === 'Nequi pareja'), ['Nequi pareja', 0, -50000]);
  // summary incluye la línea de apartados
  const txt = env.get({action: 'summary', key: env.key()}).getContent();
  assert.match(txt, /^💼 Negocio \$1\.5M · 👤 Personal \$200K · 🏠 Arriendo \$250K$/m);
});

/* ═════════════ SPEC §14: Inventario ampliado, Contactos, Topes y comentario del mes ═════════════ */

test('Inventario con datos del equipo, contactos, costos extra y ganancia real; hojas Contactos y Topes', () => {
  const env = makeEnv();
  env.setup();
  assert.ok(env.sheet('Contactos') && env.sheet('Topes'), 'setup crea Contactos y Topes');
  const A = phone(env);
  const hoy = HOY();
  A.db.contactos.push({id: 'k1', nombre: 'Mateo', tel: '3001112233', tipo: 'proveedor', notas: '=raro', u: tick()});
  A.db.items.push(
    item({id: 'x1', desc: 'iPhone 13', buyPrice: 1600000, imei: '356789012345678', bateria: 89, almac: '128GB', color: 'Azul', proveedorId: 'k1',
      status: 'sold', sellPrice: 2100000, sellPaid: 2100000, sellPocket: 'nequi', sellDate: hoy, cliente: 'Laura'}),
    item({id: 'x2', desc: 'PS5', buyPrice: 1500000, proveedor: 'mateo'}));
  A.db.gastos.push(gasto({desc: 'Cambio de pantalla', valor: 120000, tipo: 'negocio', cat: 'Otro', itemId: 'x1'}));
  A.db.topes.push({id: 't1', cat: '__personal', limite: 100000, u: tick()}, {id: 't2', cat: 'Otro', limite: 1000000, u: tick()});
  A.db.gastos.push(gasto({desc: 'Almuerzos', valor: 90000, tipo: 'personal', cat: 'Comida'}));
  A.sync();

  const inv = rowsOf(env, 'Inventario');
  const h = inv[0];
  assert.deepEqual(h.slice(16), ['IMEI', 'Batería (%)', 'Almac.', 'Color', 'Proveedor', 'Cliente', 'Costos extra', 'Ganancia real', 'IMEI 2', 'N.º de serie', 'Ciclos', 'IMEI verificado']);
  const fila = n => { const r = inv.find(f => f[0] === n); return Object.fromEntries(h.map((k, i) => [k, r[i]])); };
  const ip = fila('iPhone 13');
  assert.deepEqual([ip.IMEI, ip['Batería (%)'], ip['Almac.'], ip.Color, ip.Proveedor, ip.Cliente, ip['Costos extra'], ip['Ganancia real']],
    ["'356789012345678", 89, '128GB', 'Azul', 'Mateo', 'Laura', 120000, 2100000 - 1600000 - 120000]);
  assert.equal(fila('PS5')['Ganancia real'], '');
  assert.equal(fila('PS5').Proveedor, 'mateo');
  const shI = env.sheet('Inventario');
  assert.equal(shI.formats['2,' + (h.indexOf('Ganancia real') + 1)], '$#,##0');

  assert.deepEqual(rowsOf(env, 'Contactos'), [
    ['Nombre', 'Celular', 'Tipo', 'Compras', 'Comprado', 'Ventas', 'Vendido', 'Ganancia', 'Te debe', 'Último movimiento', 'Notas'],
    ['Mateo', '3001112233', 'Proveedor', 2, 3100000, 0, 0, 0, 0, hoy, "'=raro"]]);

  assert.deepEqual(rowsOf(env, 'Topes'), [
    ['Categoría', 'Límite del mes', 'Gastado', '% usado', 'Estado'],
    ['Todo lo personal', 100000, 90000, 90, '⚠️ Cerca del tope'],
    ['Otro', 1000000, 120000, 12, '✅ Bien']]);
  assert.ok(rowBy(rowsOf(env, 'Resumen'), 'Comentario del mes'));

  // reminders con el tope cerca
  assert.match(env.get({action: 'reminders', key: env.key()}).getContent(), /⚠️ Ya gastaste el 90% de tu tope personal/);
});
