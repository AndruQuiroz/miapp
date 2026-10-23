#!/usr/bin/env node
'use strict';
/**
 * Genera tests/fixtures/demo-db.json: ~3 meses de datos de DEMOSTRACIÓN para probar la app a mano,
 * en jsdom o en el backend. Es DETERMINISTA: misma salida byte a byte en cualquier máquina y día
 * (el "hoy" del demo está fijo en 2026-10-05; no usa el reloj ni la zona horaria).
 *
 *   node tests/fixtures/make-demo.js            → escribe tests/fixtures/demo-db.json
 *   node tests/fixtures/make-demo.js --check    → exit 1 si demo-db.json no coincide con lo que genera este script
 *   node tests/fixtures/make-demo.js --stdout   → imprime el JSON
 *
 * Contenido (todo con el modelo de SPEC §3; montos en COP enteros):
 *   20 productos (12 vendidos —2 a crédito— y 8 en stock), 25 gastos (12 negocio / 13 personal), 3 ingresos,
 *   4 cobros (1 préstamo, 2 ventas a crédito, 1 saldado) con 6 abonos, 3 transfers, 1 ajuste,
 *   3 pend (por clasificar), 2 reglas y los bolsillos efectivo/nequi/nequi_pareja con saldo inicial.
 *   SPEC §13 (apartados): 4 fondos (negocio, personal, 🏠 Casa con meta, 🐷 Ahorro), iniFondos en efectivo y nequi,
 *   4 repartos, 1 gasto marcado con fondo 'Casa' y 1 gasto pagado desde el Nequi de la pareja. Ningún apartado queda en negativo.
 *   Coherente: ningún bolsillo queda en negativo ni al final ni en NINGÚN día intermedio
 *   (lo verifica este mismo script al generar y tests/demo-db.test.js).
 *
 * Para cargarlo en la app: pega el JSON en localStorage 'miapp_db_v2' o usa "Importar JSON" (hace mergeDB).
 */
const fs = require('node:fs');
const path = require('node:path');
const { rng } = require('../helpers/rng');

const TODAY = '2026-10-05';
const OUT = path.join(__dirname, 'demo-db.json');

/* ── utilidades locales (a propósito NO usan core.js: el fixture no debe depender del código que se prueba) ── */
const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0');
};
const day = off => addDays(TODAY, -off);                           // day(88) = 88 días antes de hoy
const ts = (ymd, hh = 12, mm = 0) => {                              // epoch ms de una hora LOCAL de Colombia (UTC-5 fijo)
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hh + 5, mm);
};

const SEED = 20261005;
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/* ═══════════════ datos ═══════════════ */
function build() {
  // TODO el estado vive DENTRO de build(): llamarla dos veces en el mismo proceso da exactamente lo mismo
  const r = rng(SEED);
  const r4 = () => Array.from({ length: 4 }, () => B36[r.int(0, 35)]).join('');
  const mkId = (u, prefix = '') => prefix + u.toString(36) + r4();  // mismo formato que el cliente: Date.now().toString(36)+random(4)
  let minute = 0;                                                    // minutos distintos para que cada u sea único y creciente por día
  const nextU = ymd => ts(ymd, 9 + Math.floor(minute / 60) % 12, minute++ % 60);
  const db = {};
  const col = n => (db[n] = db[n] || []);

  /* bolsillos con saldo inicial (onboarding hace 90 días) */
  const uOnb = ts(day(90), 9, 0);
  db.bolsillos = [
    { id: 'efectivo', nombre: 'Efectivo', ini: 450000, alias: ['efectivo', 'cash', 'fisico', 'billete', 'plata en mano', 'en mano'], iniFondos: { negocio: 300000 }, u: uOnb },
    { id: 'nequi', nombre: 'Nequi', ini: 4000000, alias: ['nequi', 'mi nequi', 'neki', 'nequy'], iniFondos: { negocio: 3500000 }, u: uOnb + 1 },
    { id: 'nequi_pareja', nombre: 'Nequi pareja', ini: 250000, alias: ['nequi de mi pareja', 'pareja', 'mi novia', 'mi esposa', 'mi mujer', 'mi amor', 'de ella'], u: uOnb + 2 },
  ];
  /* apartados (SPEC §13): las semillas con u real (el usuario las organizó en el onboarding) + 2 creados por él */
  db.fondos = [
    { id: 'negocio', nombre: 'Negocio', emoji: '💼', alias: ['negocio', 'capital', 'del negocio', 'plata del negocio'], orden: 0, u: uOnb + 3 },
    { id: 'personal', nombre: 'Personal', emoji: '👤', alias: ['personal', 'lo personal', 'mi plata', 'para mi'], orden: 1, u: uOnb + 4 },
  ];
  const uCasa = ts(day(40), 8, 0), uAhorro = ts(day(8), 8, 0);
  const idCasa = mkId(uCasa), idAhorro = mkId(uAhorro);
  db.fondos.push({ id: idCasa, nombre: 'Casa', emoji: '🏠', alias: ['casa', 'arriendo', 'servicios'], meta: 900000, orden: 2, u: uCasa });
  db.fondos.push({ id: idAhorro, nombre: 'Ahorro', emoji: '🐷', alias: ['ahorro', 'alcancia'], orden: 3, u: uAhorro });

  /* ── productos ── */
  // [desc, cat, cond, notes, buyPrice, buyPocket, buyOff, targetPrice, venta|null]
  // venta = {price, paid (omitido = completo), pocket, off, notes}
  const P = [
    ['iPhone 13 128GB', 'Celulares', 'bueno', 'Batería 89%, con caja', 1650000, 'nequi', 88, 2000000, { price: 1950000, pocket: 'nequi', off: 80, notes: 'Entrega en El Poblado' }],
    ['PS5 825GB + 2 controles', 'Consolas', 'bueno', 'Edición con lector', 1800000, 'nequi', 84, 2200000, { price: 2150000, pocket: 'nequi', off: 70, notes: '' }],
    ['Nike Air Force 1 talla 42', 'Calzado', 'nuevo', 'Blancos, sin uso', 280000, 'efectivo', 80, 380000, { price: 380000, pocket: 'efectivo', off: 75, notes: '' }],
    ['AirPods Pro 2da gen', 'Accesorios', 'bueno', '', 450000, 'nequi', 75, 620000, { price: 600000, pocket: 'nequi', off: 66, notes: 'Envío por Servientrega' }],
    ['Xbox Series S', 'Consolas', 'bueno', 'Con un control', 850000, 'nequi', 66, 1050000, { price: 1050000, pocket: 'nequi', off: 52, notes: '' }],
    ['Samsung Galaxy S21', 'Celulares', 'bueno', 'Pantalla con un rayón leve', 900000, 'nequi', 62, 1150000, { price: 1100000, pocket: 'nequi', off: 50, notes: '' }],
    ["Chaqueta Levi's talla M", 'Ropa', 'regular', 'Algo desgastada en el codo', 90000, 'efectivo', 55, 150000, { price: 150000, pocket: 'efectivo', off: 45, notes: '' }],
    ['MacBook Air M1 8/256', 'Computadores', 'bueno', 'Ciclos de batería: 212', 2900000, 'nequi', 50, 3500000, { price: 3500000, paid: 2500000, pocket: 'nequi', off: 38, notes: 'Quedó debiendo $1.000.000' }],
    ['Funko Pop Batman', 'Coleccionables', 'nuevo', 'En caja', 60000, 'efectivo', 45, 110000, { price: 110000, pocket: 'efectivo', off: 40, notes: '' }],
    ['Nintendo Switch OLED', 'Consolas', 'bueno', 'Con dock y 2 joy-con', 1100000, 'nequi', 42, 1400000, { price: 1350000, paid: 1000000, pocket: 'nequi', off: 30, notes: 'Quedó debiendo $350.000' }],
    ['Monitor Samsung 24"', 'Computadores', 'bueno', '', 380000, 'nequi', 35, 460000, { price: 450000, pocket: 'nequi', off: 28, notes: '' }],
    ['Teclado mecánico Redragon', 'Accesorios', 'regular', 'Falta una tecla', 160000, 'efectivo', 28, 190000, { price: 140000, pocket: 'efectivo', off: 20, notes: 'Lo rematé' }],
    // en stock
    ['iPhone 11 64GB', 'Celulares', 'regular', 'Batería 78%', 700000, 'nequi', 34, 880000, null],
    ['Tablet Samsung A8', 'Computadores', 'bueno', '', 420000, 'nequi', 15, 520000, null],
    ['Jordan 1 Retro talla 41', 'Calzado', 'nuevo', 'Chicago, con caja', 650000, 'nequi', 65, 850000, null],
    ['Reloj Casio vintage', 'Accesorios', 'bueno', 'Funciona perfecto', 120000, 'efectivo', 12, 190000, null],
    ['Cámara GoPro Hero 9', 'Accesorios', 'bueno', 'Con 2 baterías', 700000, 'nequi', 9, 900000, null],
    ['Lego Star Wars Halcón Milenario', 'Coleccionables', 'nuevo', 'Me lo dieron como parte de pago', 320000, '', 6, 420000, null],
    ['Laptop Lenovo Legion 5', 'Computadores', 'bueno', 'RTX 3060, 16GB RAM', 2400000, 'nequi', 4, 2900000, null],
    ['Camiseta Nike dri-fit talla L', 'Ropa', 'nuevo', '', 45000, 'efectivo', 2, 80000, null],
  ];
  const itemIds = [];
  for (const [desc, cat, cond, notes, buyPrice, buyPocket, buyOff, targetPrice, v] of P) {
    const buyDate = day(buyOff);
    const it = { id: '', desc, cat, cond, notes, buyPrice, buyPocket, buyDate, targetPrice, status: 'stock' };
    let u = nextU(buyDate);
    if (v) {
      Object.assign(it, { status: 'sold', sellPrice: v.price, sellPaid: v.paid === undefined ? v.price : v.paid, sellPocket: v.pocket, sellDate: day(v.off), sellNotes: v.notes });
      u = nextU(it.sellDate);                                       // la última modificación es la venta
    }
    it.id = mkId(u);
    it.u = u;
    itemIds.push(it.id);
    col('items').push(it);
  }

  /* ── gastos ── [desc, valor, cat, tipo, bolsillo, off] ── */
  const G = [
    // negocio (12)
    ['Envío iPhone 13 (Servientrega)', 14000, 'Envíos', 'negocio', 'nequi', 80],
    ['Envío PS5', 18000, 'Envíos', 'negocio', 'nequi', 70],
    ['Envío AirPods', 9000, 'Envíos', 'negocio', 'nequi', 66],
    ['Envío Xbox (Interrapidísimo)', 15000, 'Envíos', 'negocio', 'efectivo', 52],
    ['Envío Galaxy S21', 12000, 'Envíos', 'negocio', 'nequi', 50],
    ['Cajas y burbuja', 25000, 'Empaques', 'negocio', 'efectivo', 85],
    ['Bolsas y cinta', 18000, 'Empaques', 'negocio', 'efectivo', 60],
    ['Cajas medianas', 22000, 'Empaques', 'negocio', 'nequi', 30],
    ['Comisión Mercado Libre', 35000, 'Comisiones', 'negocio', 'nequi', 70],
    ['Comisión Mercado Libre', 28000, 'Comisiones', 'negocio', 'nequi', 38],
    ['Impulsar publicación Facebook', 50000, 'Publicidad', 'negocio', 'nequi', 72],
    ['Publicidad Instagram', 80000, 'Publicidad', 'negocio', 'nequi', 33],
    // personal (13)
    ['Almuerzo', 18000, 'Comida', 'personal', 'efectivo', 86],
    ['Almuerzo con los del grupo', 25000, 'Comida', 'personal', 'efectivo', 60],
    ['Domicilio Rappi', 32000, 'Comida', 'personal', 'nequi_pareja', 41],
    ['Tinto y empanada', 15000, 'Comida', 'personal', 'efectivo', 18],
    ['Cena', 40000, 'Comida', 'personal', 'nequi', 3],
    ['Taxi', 12000, 'Transporte', 'personal', 'efectivo', 77],
    ['Uber al aeropuerto', 20000, 'Transporte', 'personal', 'nequi', 48],
    ['Metro y bus', 8000, 'Transporte', 'personal', 'efectivo', 9],
    ['Internet', 95000, 'Servicios', 'personal', 'nequi', 58, 'casa'],
    ['Plan de celular', 60000, 'Servicios', 'personal', 'nequi', 27],
    ['Cine', 35000, 'Entretenimiento', 'personal', 'efectivo', 64],
    ['Netflix', 15900, 'Entretenimiento', 'personal', 'nequi', 36],
    ['Zapatos para mí', 120000, 'Personal', 'personal', 'nequi', 22],
  ];
  for (const [desc, valor, cat, tipo, bolsillo, off, fondo] of G) {
    const fecha = day(off), u = nextU(fecha);
    const g = { id: mkId(u), desc, valor, cat, tipo, bolsillo, fecha, u };
    if (fondo === 'casa') g.fondo = idCasa;
    col('gastos').push(g);
  }

  /* ── ingresos (que no son ventas) ── */
  for (const [desc, valor, bolsillo, off] of [['Sueldo julio', 1300000, 'nequi', 70], ['Regalo de cumpleaños', 150000, 'efectivo', 45], ['Sueldo septiembre', 1300000, 'nequi', 10]]) {
    const fecha = day(off), u = nextU(fecha);
    col('ingresos').push({ id: mkId(u), desc, valor, bolsillo, fecha, u });
  }

  /* ── cobros y abonos ── */
  const cobro = (o, off) => { const fecha = day(off), u = nextU(fecha); const c = { id: mkId(u), tel: '', compromiso: '', notas: '', ...o, fecha, u }; col('cobros').push(c); return c; };
  const abono = (c, monto, bolsillo, off) => { const fecha = day(off), u = nextU(fecha); col('abonos').push({ id: mkId(u), cobroId: c.id, monto, bolsillo, fecha, u }); };
  const idMacbook = itemIds[7], idSwitch = itemIds[9];
  // 1) préstamo (salió plata de Nequi), pendiente, compromiso a futuro
  const cPrest = cobro({ nombre: 'Camilo Restrepo', tel: '3001234567', total: 300000, pagado: 0, bolsillo: 'nequi', compromiso: day(-10), notas: 'Préstamo para el arriendo' }, 26);
  abono(cPrest, 100000, 'nequi', 9);
  // 2) venta a crédito (MacBook): la plata no salió de ningún bolsillo; compromiso VENCIDO
  const cMac = cobro({ nombre: 'Laura Giraldo', tel: '3109876543', total: 1000000, pagado: 0, bolsillo: '', compromiso: day(3), notas: 'MacBook Air M1', itemId: idMacbook }, 38);
  abono(cMac, 300000, 'nequi', 20);
  abono(cMac, 200000, 'efectivo', 8);
  // 3) venta a crédito (Switch): compromiso HOY
  const cSw = cobro({ nombre: 'Sebastián Mora', tel: '3205551234', total: 350000, pagado: 0, bolsillo: '', compromiso: day(0), notas: 'Nintendo Switch OLED', itemId: idSwitch }, 30);
  abono(cSw, 100000, 'nequi', 10);
  // 4) préstamo ya SALDADO (prestó 150.000 en efectivo; le devolvieron 50.000 al instante y el resto en 2 abonos)
  const cHer = cobro({ nombre: 'Don Hernán', tel: '3157778899', total: 150000, pagado: 50000, bolsillo: 'efectivo', notas: 'Préstamo corto' }, 60);
  abono(cHer, 60000, 'efectivo', 50);
  abono(cHer, 40000, 'efectivo', 41);

  /* ── transfers ── */
  for (const [from, to, monto, off] of [['nequi', 'efectivo', 200000, 78], ['nequi', 'efectivo', 150000, 44], ['efectivo', 'nequi', 100000, 14]]) {
    const fecha = day(off), u = nextU(fecha);
    col('transfers').push({ id: mkId(u), from, to, monto, fecha, u });
  }

  /* ── repartos entre apartados (no mueven plata de bolsillo) ── [from, to, monto, off, nota] ── */
  for (const [from, to, monto, off, nota] of [
    ['personal', 'negocio', 1000000, 60, 'Metí 1M al negocio'],
    ['personal', idCasa, 300000, 40, 'Aparté para el arriendo'],
    ['personal', idCasa, 300000, 10, 'Aparté para el arriendo'],
    ['personal', idAhorro, 200000, 8, 'Primer ahorro'],
  ]) {
    const fecha = day(off), u = nextU(fecha);
    col('repartos').push({ id: mkId(u), from, to, monto, fecha, nota, u });
  }

  /* ── ajuste ── */
  { const fecha = day(5), u = nextU(fecha); col('ajustes').push({ id: mkId(u), bolsillo: 'nequi', delta: -4200, fecha, nota: 'Cuadre con el saldo real de Nequi', u }); }

  /* ── pend (capturados de notificaciones; los crea el servidor, id con prefijo p) ── */
  const pend = (raw, monto, dir, quien, off, h, mi) => { const fecha = day(off), u = ts(fecha, h, mi); col('pend').push({ id: mkId(u, 'p'), raw, monto, dir, quien, fecha, bolsillo: 'nequi', u }); };
  pend('Enviaste $12.000 a SERVIENTREGA', 12000, 'out', 'SERVIENTREGA', 1, 16, 5);
  pend('Recibiste $85.000 de PEDRO GOMEZ', 85000, 'in', 'PEDRO GOMEZ', 1, 18, 40);
  pend('Pagaste $15.900 en NETFLIX', 15900, 'out', 'NETFLIX', 0, 7, 12);

  /* ── reglas aprendidas (id = normKey(quien)) ── */
  const uRegla = ts(day(36), 20, 0);
  db.reglas = [
    { id: 'servientrega', kind: 'gasto', desc: 'Envío Servientrega', cat: 'Envíos', tipo: 'negocio', u: uRegla },
    { id: 'netflix', kind: 'gasto', desc: 'Netflix', cat: 'Entretenimiento', tipo: 'personal', u: uRegla + 1 },
  ];

  // orden estable de claves (el mismo que COLS)
  const COLS = ['items', 'gastos', 'ingresos', 'cobros', 'abonos', 'transfers', 'ajustes', 'pend', 'bolsillos', 'reglas', 'fondos', 'repartos', 'contactos', 'topes', 'pedidos'];
  const out = {};
  for (const c of COLS) out[c] = db[c] || [];
  return out;
}

/* ═══════════════ autoverificación: ningún saldo negativo, ningún día ═══════════════ */
function minBalancesOf(db) {
  const rows = [];
  const push = (p, d, date) => { if (p) rows.push({ p, d, date }); };
  for (const i of db.items) {
    push(i.buyPocket, -i.buyPrice, i.buyDate);
    if (i.status === 'sold') push(i.sellPocket, i.sellPaid, i.sellDate);
  }
  db.gastos.forEach(g => push(g.bolsillo, -g.valor, g.fecha));
  db.ingresos.forEach(g => push(g.bolsillo, g.valor, g.fecha));
  db.abonos.forEach(a => push(a.bolsillo, a.monto, a.fecha));
  db.cobros.forEach(c => { if (c.bolsillo) push(c.bolsillo, -(c.total - c.pagado), c.fecha); });
  db.transfers.forEach(t => { push(t.from, -t.monto, t.fecha); push(t.to, t.monto, t.fecha); });
  db.ajustes.forEach(a => push(a.bolsillo, a.delta, a.fecha));
  const cur = Object.fromEntries(db.bolsillos.map(b => [b.id, b.ini]));
  const lo = { ...cur };
  const days = [...new Set(rows.map(x => x.date))].sort();
  for (const d of days) {
    rows.filter(x => x.date === d).forEach(x => { cur[x.p] += x.d; });
    for (const k of Object.keys(cur)) lo[k] = Math.min(lo[k], cur[k]);
  }
  return { lo, final: cur };
}

function buildDemoDB() {
  const db = build();
  const { lo } = minBalancesOf(db);
  for (const [k, v] of Object.entries(lo)) if (v < 0) throw new Error(`make-demo: el bolsillo ${k} llega a ${v} (negativo). Ajusta los montos.`);
  return db;
}

const toJSON = db => JSON.stringify(db, null, 2) + '\n';

module.exports = { buildDemoDB, toJSON, TODAY, OUT, minBalancesOf };

if (require.main === module) {
  const arg = process.argv[2];
  const text = toJSON(buildDemoDB());
  if (arg === '--stdout') process.stdout.write(text);
  else if (arg === '--check') {
    const actual = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
    if (actual !== text) { console.error('demo-db.json NO está al día. Corre: node tests/fixtures/make-demo.js'); process.exit(1); }
    console.log('demo-db.json está al día.');
  } else {
    fs.writeFileSync(OUT, text);
    const db = JSON.parse(text);
    const { final } = minBalancesOf(db);
    console.log(`demo-db.json escrito (${text.length} bytes). Saldos finales: ` + Object.entries(final).map(([k, v]) => `${k} ${v}`).join(' · '));
  }
}
