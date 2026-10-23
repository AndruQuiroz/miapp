/** @OnlyCurrentDoc */
/* ═══════════════════════════════════════════════
   server.gs — el "servidor" de Mi App dentro de tu Google Sheet.

   Qué hace:
   · Guarda TODA tu información en la hoja oculta "_db" (es la copia en la nube).
   · Sincroniza con la app de tu celular (o con varios celulares).
   · Recibe las notificaciones de Nequi que le manda MacroDroid.
   · Le responde a MacroDroid el resumen semanal y los recordatorios.
   · Arma hojas fáciles de leer desde el PC: Resumen, Inventario, Gastos,
     Ingresos, Cobros, Bolsillos (DÓNDE está la plata), Apartados (PARA QUÉ es),
     Contactos (clientes y proveedores) y Topes (límites de gasto del mes).
     ¡No las edites a mano! Se regeneran solas.

   Funciones que TÚ puedes ejecutar desde el editor (menú de arriba):
   · setup     → crea tu clave y las hojas. Puedes repetirla sin miedo:
                 no borra datos ni cambia la clave. También refresca las hojas.
   · verClave  → te vuelve a mostrar tu clave.
   Las funciones que terminan en "_" son internas (Google no las muestra).
═══════════════════════════════════════════════ */

// ── Ajustes generales ──
const HOJA_DB_ = '_db';                 // hoja oculta con los datos (no la toques)
const TROZO_ = 45000;                   // letras por celda (Google permite máx. 50.000)
const DEDUP_MS_ = 10 * 60 * 1000;       // 10 minutos: avisos repetidos de Nequi se ignoran
const ESPERA_MS_ = 25000;               // cuánto esperar si otra petición está escribiendo
const PROP_CLAVE_ = 'KEY';              // nombre de la propiedad donde vive tu clave
const PROP_HOJAS_ = 'HOJAS_PENDIENTES'; // "1" = falta refrescar las hojas legibles
const FMT_PLATA_ = '$#,##0';
const HOJAS_LEGIBLES_ = ['Resumen', 'Inventario', 'Gastos', 'Ingresos', 'Cobros', 'Bolsillos', 'Apartados', 'Contactos', 'Topes'];
const ACCIONES_ = ['ping', 'sync', 'capture', 'summary', 'reminders'];
const MESES_LARGOS_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];


/* ═════════════ 1. FUNCIONES PARA TI ═════════════ */

/** Prepara todo. Ejecútala una vez (repetirla no daña nada). */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let clave = props.getProperty(PROP_CLAVE_);
  const esNueva = !clave;
  if (esNueva) {
    clave = nuevaClave_();
    props.setProperty(PROP_CLAVE_, clave);
  }

  // Crea las hojas que falten (primero las visibles, luego la oculta)
  const ss = libro_();
  HOJAS_LEGIBLES_.forEach(function (n) { hoja_(ss, n); });
  const db = hoja_(ss, HOJA_DB_);
  try { db.hideSheet(); } catch (err) { /* ya estaba oculta o no se pudo: no pasa nada */ }

  // Refresca las hojas legibles con lo que ya haya guardado
  try {
    writeViews_(readDB_());
    marcarHojas_(false);
  } catch (err) {
    Logger.log('⚠️ No pude refrescar las hojas: ' + err.message);
  }
  SpreadsheetApp.flush();

  Logger.log('══════════════════════════════════');
  Logger.log('TU CLAVE: ' + clave);
  Logger.log('══════════════════════════════════');
  Logger.log(esNueva ? '✅ Listo: clave creada y hojas preparadas.'
                     : '✅ Listo: ya tenías clave (no cambió) y las hojas están al día.');
  Logger.log('Siguiente paso: botón azul "Implementar" > "Nueva implementación" > tipo "Aplicación web".');
  Logger.log('   Ejecutar como: "Yo"  ·  Quién tiene acceso: "Cualquier usuario"  ·  Implementar.');
  Logger.log('Copia la URL que termina en /exec y pégala, junto con TU CLAVE, en Mi App > Más > Ajustes.');
  return clave;
}

/** Muestra tu clave en el registro de ejecución. */
function verClave() {
  const clave = PropertiesService.getScriptProperties().getProperty(PROP_CLAVE_);
  Logger.log(clave ? 'TU CLAVE: ' + clave : 'Todavía no tienes clave: ejecuta primero la función setup.');
  return clave || '';
}


/* ═════════════ 2. ENTRADA DESDE INTERNET ═════════════
   Google llama a doGet (enlaces) y doPost (envíos) cuando la app
   o MacroDroid usan la URL /exec. Ambas pasan por handle_. */

function doGet(e) { return handle_(e, 'GET'); }
function doPost(e) { return handle_(e, 'POST'); }

function handle_(e, metodo) {
  e = e || {};
  const p = e.parameter || {};
  let accion = minus_(p.action);
  // summary y reminders responden texto plano (también sus errores)
  const fallo = function (msg) {
    return (accion === 'summary' || accion === 'reminders') ? texto_(msg) : json_({ok: false, error: msg});
  };
  let lock = null;
  try {
    // El cuerpo crudo del envío (POST). Se lee igual sin importar el Content-Type.
    const cuerpo = (metodo === 'POST' && e.postData && e.postData.contents != null) ? String(e.postData.contents) : '';

    // Si no es una captura, el cuerpo es JSON: {action, key, db}
    let datos = {};
    if (metodo === 'POST' && accion !== 'capture' && cuerpo.trim()) {
      try {
        const x = JSON.parse(cuerpo);
        if (x && typeof x === 'object' && !Array.isArray(x)) datos = x;
      } catch (err) {
        if (!accion || accion === 'sync') return json_({ok: false, error: 'Datos inválidos: se esperaba JSON'});
      }
      if (!accion) accion = minus_(datos.action);
    }

    if (!accion) {
      // Alguien abrió la URL en el navegador: solo confirmamos que el servidor vive.
      if (metodo === 'GET' && p.key == null) {
        return json_({ok: true, mensaje: 'Mi App: servidor funcionando ✅. Pega esta URL y tu clave en Mi App > Más > Ajustes.'});
      }
      return fallo('Falta la acción');
    }
    if (ACCIONES_.indexOf(accion) < 0) return fallo('Acción desconocida: ' + accion);

    // ── Clave ──
    const clave = PropertiesService.getScriptProperties().getProperty(PROP_CLAVE_);
    if (!clave) return fallo('Falta ejecutar setup en Apps Script');
    const dada = p.key != null ? p.key : datos.key;
    if (String(dada == null ? '' : dada).trim() !== clave) return fallo('Clave incorrecta');

    if (accion === 'ping') return json_({ok: true});
    if (accion === 'sync' && metodo !== 'POST') return fallo('La sincronización se hace con POST');

    // ── Un solo turno a la vez (evita que dos celulares se pisen) ──
    lock = LockService.getScriptLock();
    if (!lock.tryLock(ESPERA_MS_)) { lock = null; return fallo('Ocupado, reintenta'); }

    if (accion === 'sync') return json_(sync_(datos.db));
    if (accion === 'capture') return json_(capture_(textoCaptura_(cuerpo, p), p.bolsillo));
    if (accion === 'summary') return texto_(summaryText(readDB_()));
    return texto_(remindersText(readDB_()));
  } catch (err) {
    Logger.log('❌ Error en "' + accion + '": ' + (err && err.stack ? err.stack : err));
    return fallo('Error en el servidor: ' + (err && err.message ? err.message : err));
  } finally {
    if (lock) {
      try { SpreadsheetApp.flush(); } catch (err) { /* nada */ }
      lock.releaseLock();
    }
  }
}


/* ═════════════ 3. ACCIONES ═════════════ */

/** Sincronizar: une lo del celular con lo guardado (gana el cambio más reciente). */
function sync_(entrante) {
  if (entrante != null && (typeof entrante !== 'object' || Array.isArray(entrante))) {
    return {ok: false, error: 'Datos inválidos: db debe ser un objeto'};
  }
  const guardado = readDB_(true);              // tal cual está guardado (para saber si algo cambió)
  const antes = JSON.stringify(guardado);
  // Une y completa las semillas nuevas (Nequi pareja, apartados Negocio/Personal) si la base es de una versión anterior
  const merged = ensureSeeds(mergeDB(guardado, entrante || {}));
  const despues = JSON.stringify(merged);
  const res = {ok: true, db: merged};

  // La app sincroniza cada minuto: SOLO escribimos si de verdad cambió algo.
  const cambio = despues !== antes;
  if (cambio) writeDB_(despues);
  const pendientes = hojasPendientes_();
  if (cambio || pendientes) {
    try {
      writeViews_(merged);
      if (pendientes) marcarHojas_(false);
    } catch (err) {
      // Los datos ya quedaron a salvo en _db; las hojas se reintentan en el próximo sync.
      marcarHojas_(true);
      Logger.log('⚠️ No pude actualizar las hojas legibles: ' + (err && err.stack ? err.stack : err));
      res.aviso = 'Datos guardados, pero no pude actualizar las hojas legibles: ' + err.message;
    }
  }
  return res;
}

/** Captura: guarda una notificación de Nequi en "Por clasificar" (pend). */
function capture_(texto, bolsilloParam) {
  const raw = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!raw) return {ok: true, added: false};
  const n = parseNoti(raw);
  if (!n.monto) return {ok: true, added: false};

  const db = readDB_();
  const ahora = Date.now();
  // Android a veces repite la misma notificación: si llegó igual hace < 10 min, se ignora.
  const repetido = db.pend.some(function (r) {
    return r && r.raw === raw && Math.abs(ahora - creado_(r)) < DEDUP_MS_;
  });
  if (repetido) return {ok: true, added: false};

  db.pend.push({
    id: nuevoId_('p'), raw: raw, monto: n.monto, dir: n.dir, quien: n.quien,
    fecha: today(), bolsillo: bolsilloId_(db, bolsilloParam), u: ahora, t: ahora
  });
  writeDB_(JSON.stringify(db));
  // Para responder rápido no tocamos las hojas legibles: lo hará el próximo sync.
  marcarHojas_(true);
  return {ok: true, added: true};
}

/** Texto de la notificación: cuerpo crudo del POST, o el parámetro "text". */
function textoCaptura_(cuerpo, p) {
  let t = cuerpo;
  if (/^text=/.test(t)) {
    // Alguien lo mandó como formulario "text=...": lo desarmamos.
    if (p.text != null) t = p.text;
    else {
      try { t = decodeURIComponent(t.slice(5).replace(/\+/g, ' ')); } catch (err) { t = t.slice(5); }
    }
  }
  if (!String(t).trim() && p.text != null) t = p.text;
  return String(t == null ? '' : t);
}


/* ═════════════ 4. GUARDAR Y LEER LA BASE (hoja oculta _db) ═════════════
   La base es un texto JSON partido en trozos de 45.000 letras, uno por
   celda en la columna A. Cada trozo empieza con "~" para que Google
   nunca lo confunda con un número, una fecha o una fórmula. */

/** Lee la base. crudo=true: tal cual está guardada; si no, además le completa las semillas (ensureSeeds). */
function readDB_(crudo) {
  const sh = libro_().getSheetByName(HOJA_DB_);
  const n = sh ? sh.getLastRow() : 0;
  if (!n) return emptyDB();
  const celdas = sh.getRange(1, 1, n, 1).getValues();
  let json = '';
  for (let i = 0; i < celdas.length; i++) {
    const v = celdas[i][0];
    if (v === '' || v == null) continue;
    const s = String(v);
    json += s.charAt(0) === '~' ? s.slice(1) : s;
  }
  if (!json) return emptyDB();
  let db;
  try { db = JSON.parse(json); } catch (err) { db = null; }
  if (!db || typeof db !== 'object' || Array.isArray(db)) {
    // Nunca seguimos con datos dañados: si lo hiciéramos, se podría perder información.
    throw new Error('No pude leer la hoja _db (¿la editaron a mano?). No guardé nada para no perder datos.');
  }
  COLS.forEach(function (c) { if (!Array.isArray(db[c])) db[c] = []; });
  return crudo ? db : ensureSeeds(db);
}

function writeDB_(json) {
  const sh = hoja_(libro_(), HOJA_DB_);
  const filas = trocear_(String(json), TROZO_).map(function (t) { return ['~' + t]; });
  const rango = sh.getRange(1, 1, filas.length, 1);
  rango.setNumberFormat('@'); // formato "texto sin formato"
  rango.setValues(filas);
  const ultima = sh.getLastRow();
  if (ultima > filas.length) sh.getRange(filas.length + 1, 1, ultima - filas.length, 1).clearContent();
}

/** Parte un texto en trozos de n letras sin partir un emoji por la mitad. */
function trocear_(s, n) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    let j = Math.min(i + n, s.length);
    const c = s.charCodeAt(j - 1);
    if (j < s.length && c >= 0xD800 && c <= 0xDBFF) j--;
    out.push(s.slice(i, j));
    i = j;
  }
  return out.length ? out : [''];
}


/* ═════════════ 5. HOJAS LEGIBLES (para mirar desde el PC) ═════════════ */

function writeViews_(db) {
  const ss = libro_();
  const hoy = today();
  const ym = hoy.slice(0, 7);
  const nombreB = function (id) { return nombreBolsillo_(db, id); };
  const fondo = fondoResolver(db);                       // de core.js: a qué apartado va cada registro
  const nombreF = function (id) { return nombreFondo_(db, id); };

  // ── Inventario: primero lo que está en stock, luego lo vendido ──
  const extras = new Map();                              // gastos ligados a cada producto (arreglos, envío…)
  L(db, 'gastos').forEach(function (g) { if (g.itemId != null) extras.set(g.itemId, (extras.get(g.itemId) || 0) + num_(g.valor)); });
  const items = L(db, 'items').slice().sort(function (a, b) {
    const va = a.status === 'sold' ? 1 : 0, vb = b.status === 'sold' ? 1 : 0;
    if (va !== vb) return va - vb;
    return String(b.buyDate || '').localeCompare(String(a.buyDate || ''));
  });
  escribirTabla_(ss, 'Inventario',
    ['Producto', 'Categoría', 'Condición', 'Estado', 'Fecha compra', 'Costo', 'Pagado desde',
     'Precio meta', 'Fecha venta', 'Precio venta', 'Cobrado', 'Entró a', 'Ganancia', 'Días', 'Apartado', 'Notas',
     'IMEI', 'Batería (%)', 'Almac.', 'Color', 'Proveedor', 'Cliente', 'Costos extra', 'Ganancia real', 'IMEI 2', 'N.º de serie', 'Ciclos', 'IMEI verificado'],
    items.map(function (i) {
      const v = i.status === 'sold';
      const notas = [i.notes, v ? i.sellNotes : ''].filter(function (x) { return x; }).join(' · ');
      return [
        i.desc, i.cat, i.cond, v ? 'Vendido' : 'En stock', i.buyDate, num_(i.buyPrice),
        i.buyPocket ? nombreB(i.buyPocket) : 'No salió de mis bolsillos',
        (i.targetPrice == null || i.targetPrice === '') ? '' : num_(i.targetPrice),
        v ? i.sellDate : '', v ? num_(i.sellPrice) : '',
        v ? num_(i.sellPaid != null ? i.sellPaid : i.sellPrice) : '',
        v ? nombreB(i.sellPocket) : '',
        v ? num_(i.sellPrice) - num_(i.buyPrice) : '',
        daysBetween(i.buyDate, v ? i.sellDate : hoy), nombreF(fondo('items', i)), notas,
        // el IMEI como texto (si no, Sheets lo vuelve 3,5E+14)
        i.imei ? "'" + String(i.imei) : '', (i.bateria == null || i.bateria === '') ? '' : num_(i.bateria),
        i.almac, i.color, nombreContacto(db, i.proveedorId, i.proveedor), nombreContacto(db, i.clienteId, i.cliente),
        extras.get(i.id) || 0, v ? num_(i.sellPrice) - num_(i.buyPrice) - (extras.get(i.id) || 0) : '',
        i.imei2 ? "'" + String(i.imei2) : '', i.serie || '',
        (i.ciclos == null || i.ciclos === '') ? '' : num_(i.ciclos),
        i.imeiVerif ? (i.imeiVerif + (i.imeiReporte === 'mal' ? ' · reportado' : ' · limpio')) : ''
      ];
    }),
    ['Costo', 'Precio meta', 'Precio venta', 'Cobrado', 'Ganancia', 'Costos extra', 'Ganancia real']);

  // ── Gastos ──
  escribirTabla_(ss, 'Gastos',
    ['Fecha', 'Descripción', 'Categoría', 'Tipo', 'Bolsillo', 'Apartado', 'Valor'],
    porFecha_(L(db, 'gastos'), 'fecha').map(function (g) {
      return [g.fecha, g.desc, g.cat, g.tipo === 'negocio' ? 'Negocio' : 'Personal', nombreB(g.bolsillo),
        nombreF(fondo('gastos', g)), num_(g.valor)];
    }),
    ['Valor']);

  // ── Ingresos (los que NO son ventas) ──
  escribirTabla_(ss, 'Ingresos',
    ['Fecha', 'Descripción', 'Bolsillo', 'Apartado', 'Valor'],
    porFecha_(L(db, 'ingresos'), 'fecha').map(function (g) {
      return [g.fecha, g.desc, nombreB(g.bolsillo), nombreF(fondo('ingresos', g)), num_(g.valor)];
    }),
    ['Valor']);

  // ── Cobros: primero los pendientes ──
  const cobros = porFecha_(L(db, 'cobros'), 'fecha').map(function (c) {
    const pag = cobroPagado(db, c);
    return {c: c, pag: pag, debe: Math.max(0, num_(c.total) - pag)};
  }).sort(function (a, b) { return (b.debe > 0) - (a.debe > 0); });
  escribirTabla_(ss, 'Cobros',
    ['Nombre', 'Celular', 'Fecha', 'Total', 'Abonado', 'Debe', 'Compromiso', 'Estado', 'Notas'],
    cobros.map(function (x) {
      return [x.c.nombre, x.c.tel, x.c.fecha, num_(x.c.total), num_(x.pag), x.debe,
        x.c.compromiso || '', x.debe > 0 ? 'Pendiente' : 'Saldado', x.c.notas];
    }),
    ['Total', 'Abonado', 'Debe']);

  // ── Bolsillos: saldo calculado con todos los movimientos ──
  const saldos = balances(db);
  const filasB = L(db, 'bolsillos').map(function (b) { return [b.nombre || b.id, num_(b.ini), num_(saldos[b.id])]; });
  const vivos = L(db, 'bolsillos').map(function (b) { return b.id; });
  Object.keys(saldos).forEach(function (id) {
    if (vivos.indexOf(id) < 0 && num_(saldos[id]) !== 0) filasB.push([nombreB(id) + ' (eliminado)', 0, num_(saldos[id])]);
  });
  filasB.push(['TOTAL', sumaCol_(filasB, 1), sumaCol_(filasB, 2)]);
  escribirTabla_(ss, 'Bolsillos', ['Bolsillo', 'Saldo inicial', 'Saldo actual'], filasB, ['Saldo inicial', 'Saldo actual']);

  // ── Apartados: PARA QUÉ es la plata (la suma SIEMPRE es igual a la de los bolsillos) ──
  const saldosF = balancesFondos(db);
  const idsF = fondosOrdenados(db).map(function (f) { return f.id; });
  Object.keys(saldosF).forEach(function (id) { if (idsF.indexOf(id) < 0 && num_(saldosF[id]) !== 0) idsF.push(id); });
  const filasA = idsF.map(function (id) {
    const f = (db.fondos || []).filter(function (x) { return x && x.id === id && !x.del; })[0] || {};
    const meta = +f.meta > 0 ? num_(f.meta) : '';
    const saldo = num_(saldosF[id]);
    return [nombreF(id), saldo, meta, meta ? Math.round(Math.max(0, saldo) / meta * 1000) / 10 : '',
      saldo < 0 ? 'En rojo: se usó plata de otros apartados' : ''];
  });
  const totalF = sumaCol_(filasA, 1);
  const totalB = num_(Object.keys(saldos).reduce(function (a, k) { return a + (+saldos[k] || 0); }, 0));
  filasA.push(['TOTAL EN APARTADOS', totalF, '', '', '']);
  filasA.push(['Total en bolsillos', totalB, '', '', totalF === totalB ? '✅ Cuadra' : '⚠️ No cuadra: avísale al equipo']);
  escribirTabla_(ss, 'Apartados', ['Apartado', 'Saldo', 'Meta', 'Avance meta (%)', 'Nota'], filasA, ['Saldo', 'Meta']);

  // ── Contactos: clientes y proveedores con lo que has hecho con cada uno ──
  const filasC = L(db, 'contactos').slice().sort(function (a, b) { return String(a.nombre || '').localeCompare(String(b.nombre || '')); })
    .map(function (c) {
      const st = contactoStats(db, c.id);
      const tipo = c.tipo === 'proveedor' ? 'Proveedor' : c.tipo === 'ambos' ? 'Cliente y proveedor' : 'Cliente';
      return [c.nombre, c.tel, tipo, st.compras.n, st.compras.total, st.ventas.n, st.ventas.total, st.ventas.ganancia, st.debe,
        st.ultimo ? st.ultimo.fecha : '', c.notas];
    });
  escribirTabla_(ss, 'Contactos', ['Nombre', 'Celular', 'Tipo', 'Compras', 'Comprado', 'Ventas', 'Vendido', 'Ganancia', 'Te debe', 'Último movimiento', 'Notas'],
    filasC, ['Comprado', 'Vendido', 'Ganancia', 'Te debe']);

  // ── Topes de gasto del mes actual ──
  const filasT = topesEstado(db, ym).map(function (x) {
    return [x.tope.cat === '__personal' ? 'Todo lo personal' : x.tope.cat, num_(x.tope.limite), x.gastado, x.pct,
      x.estado === 'pasado' ? '🚨 Te pasaste' : x.estado === 'cerca' ? '⚠️ Cerca del tope' : '✅ Bien'];
  });
  escribirTabla_(ss, 'Topes', ['Categoría', 'Límite del mes', 'Gastado', '% usado', 'Estado'], filasT, ['Límite del mes', 'Gastado']);

  // ── Resumen del mes actual ──
  const ms = monthStats(db, ym);
  const cp = cobrosPend(db);
  const stock = L(db, 'items').filter(function (i) { return i.status === 'stock'; });
  const F = []; // [concepto, valor, ¿es plata?]
  F.push(['Mes', MESES_LARGOS_[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4), false]);
  F.push(['Ventas', ms.ventas, true]);
  F.push(['Número de ventas', ms.nVentas, false]);
  F.push(['Costo de lo vendido', ms.costo, true]);
  F.push(['Utilidad bruta', ms.bruta, true]);
  F.push(['Gastos del negocio', ms.gN, true]);
  F.push(['Utilidad neta', ms.neta, true]);
  F.push(['Margen neto (%)', Math.round(ms.margen * 10) / 10, false]);
  F.push(['Gastos personales', ms.gP, true]);
  F.push(['Compras de inventario', ms.compras, true]);
  F.push(['Ingresos personales', ms.ing, true]);
  F.push(['Días promedio para vender', ms.diasProm == null ? '—' : ms.diasProm, false]);
  F.push(['Comentario del mes', monthInsight(db, ym) || '—', false]);
  F.push(['', '', false]);
  F.push(['SALDOS POR BOLSILLO', '', false]);
  let caja = 0;
  Object.keys(saldos).forEach(function (id) {
    if (vivos.indexOf(id) < 0 && num_(saldos[id]) === 0) return;
    caja += num_(saldos[id]);
    F.push([nombreB(id), num_(saldos[id]), true]);
  });
  F.push(['Caja total', caja, true]);
  F.push(['', '', false]);
  F.push(['SALDOS POR APARTADO', '', false]);
  idsF.forEach(function (id) { F.push([nombreF(id), num_(saldosF[id]), true]); });
  F.push(['', '', false]);
  F.push(['Te deben', sum(cp, 'pend'), true]);
  F.push(['Cobros pendientes', cp.length, false]);
  F.push(['En stock (costo)', sum(stock, 'buyPrice'), true]);
  F.push(['Productos en stock', stock.length, false]);
  F.push(['Por clasificar', L(db, 'pend').length, false]);
  F.push(['', '', false]);
  F.push(['Actualizado', Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd HH:mm'), false]);
  F.push(['Nota', 'Estas hojas se regeneran solas desde Mi App: no las edites a mano.', false]);
  const sh = escribirTabla_(ss, 'Resumen', ['Concepto', 'Valor'],
    F.map(function (f) { return [f[0], f[1]]; }), []);
  // Formato de plata solo en las filas de dinero (agrupadas para hacer pocas llamadas)
  for (let i = 0; i < F.length; i++) {
    if (!F[i][2]) continue;
    let j = i;
    while (j + 1 < F.length && F[j + 1][2]) j++;
    sh.getRange(i + 2, 2, j - i + 1, 1).setNumberFormat(FMT_PLATA_);
    i = j;
  }
}

/** Borra la hoja y escribe encabezado + filas, con formato. Devuelve la hoja. */
function escribirTabla_(ss, nombre, encabezado, filas, colsPlata) {
  const sh = hoja_(ss, nombre);
  sh.clearContents();
  const datos = [encabezado].concat(filas).map(function (f) {
    const fila = [];
    for (let k = 0; k < encabezado.length; k++) fila.push(seguro_(f[k]));
    return fila;
  });
  sh.getRange(1, 1, datos.length, encabezado.length).setValues(datos);
  sh.getRange(1, 1, 1, encabezado.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (filas.length) {
    colsPlata.forEach(function (col) {
      const c = encabezado.indexOf(col) + 1;
      if (c > 0) sh.getRange(2, c, filas.length, 1).setNumberFormat(FMT_PLATA_);
    });
  }
  return sh;
}

/** Texto seguro para una celda: lo que empiece con = + - @ no se vuelve fórmula. */
function seguro_(v) {
  if (v == null) return '';
  if (typeof v === 'number') return isFinite(v) ? v : '';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  const s = String(v).slice(0, 5000);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}


/* ═════════════ 6. AYUDANTES ═════════════ */

function libro_() {
  const ss = SpreadsheetApp.getActive();
  if (!ss) throw new Error('Este código debe estar dentro de tu Google Sheet (Extensiones > Apps Script).');
  return ss;
}

/** Devuelve la hoja con ese nombre; si no existe, la crea (la _db queda oculta). */
function hoja_(ss, nombre) {
  let sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre);
    if (nombre === HOJA_DB_) {
      try { sh.hideSheet(); } catch (err) { Logger.log('No pude ocultar _db: ' + err.message); }
    }
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function texto_(s) {
  return ContentService.createTextOutput(String(s == null ? '' : s)).setMimeType(ContentService.MimeType.TEXT);
}

function marcarHojas_(pendiente) {
  const props = PropertiesService.getScriptProperties();
  if (pendiente) props.setProperty(PROP_HOJAS_, '1');
  else props.deleteProperty(PROP_HOJAS_);
}
function hojasPendientes_() {
  return PropertiesService.getScriptProperties().getProperty(PROP_HOJAS_) === '1';
}

/** Clave de 16 letras/números fáciles de leer (sin l, o, 0, 1). */
function nuevaClave_() {
  const letras = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32 símbolos
  const hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  let k = '';
  for (let i = 0; k.length < 16 && i + 1 < hex.length; i += 2) {
    k += letras.charAt(parseInt(hex.substr(i, 2), 16) % letras.length);
  }
  return k;
}

function nuevoId_(prefijo) {
  return prefijo + Date.now().toString(36) + Utilities.getUuid().replace(/-/g, '').slice(0, 4);
}

/** Momento en que se creó un pendiente (t), o su última modificación (u) si no lo tiene. */
function creado_(r) {
  return +r.t || +r.u || 0;
}

/** Acepta el id del bolsillo ("nequi") o su nombre ("Nequi"); vacío = nequi. */
function bolsilloId_(db, param) {
  const q = String(param == null ? '' : param).trim();
  if (!q) return 'nequi';
  const norm = function (s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  };
  const vivos = L(db, 'bolsillos');
  for (let i = 0; i < vivos.length; i++) if (vivos[i].id === q) return q;
  for (let i = 0; i < vivos.length; i++) {
    if (norm(vivos[i].id) === norm(q) || norm(vivos[i].nombre) === norm(q)) return vivos[i].id;
  }
  return q.slice(0, 40);
}

/** "💼 Negocio" (emoji + nombre del apartado); si no existe, su id. */
function nombreFondo_(db, id) {
  if (id == null || id === '') return '—';
  const f = (db.fondos || []).filter(function (x) { return x && x.id === id && !x.del; })[0];
  if (!f) return id === 'personal' ? '👤 Personal' : String(id);
  return (f.emoji ? f.emoji + ' ' : '') + (f.nombre || f.id);
}

function nombreBolsillo_(db, id) {
  if (id == null || id === '') return '—';
  const b = (db.bolsillos || []).filter(function (x) { return x && x.id === id; })[0];
  return b && b.nombre ? b.nombre : String(id);
}

function porFecha_(arr, campo) {
  return arr.slice().sort(function (a, b) { return String(b[campo] || '').localeCompare(String(a[campo] || '')); });
}

function sumaCol_(filas, k) {
  return filas.reduce(function (s, f) { return s + (+f[k] || 0); }, 0);
}

function num_(v) {
  return Math.round(+v || 0);
}

function minus_(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}
