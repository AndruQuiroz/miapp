/** @OnlyCurrentDoc */
/* ══════════════════════════════════════════════════════════════════
   MI APP — servidor para Google Apps Script.
   GENERADO — no editar a mano (sale de app/core.js + server/server.gs con server/build.js).

   CÓMO INSTALAR:
   1. En tu Google Sheet: Extensiones > Apps Script. Borra lo que haya y pega TODO este archivo.
   2. Guarda (ícono del disquete o Ctrl+S).
   3. Arriba, en la lista de funciones, elige "setup" y toca Ejecutar. Acepta los permisos.
      En el "Registro de ejecución" aparece TU CLAVE.
   4. Implementar > Nueva implementación > tipo "Aplicación web": Ejecutar como "Yo",
      Quién tiene acceso "Cualquier usuario". Copia la URL que termina en /exec.
   5. En Mi App > Más > Ajustes pega la URL y la clave y toca "Guardar y probar".
   ¿Cambiaste este código? Implementar > Gestionar implementaciones > ✏️ > Versión: "Nueva versión".
══════════════════════════════════════════════════════════════════ */

/* ─────────── server/server.gs ─────────── */
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

/* ─────────── app/core.js (lógica compartida con la app) ─────────── */
/* ═══════════════════════════════════════════════
   core.js — lógica compartida entre la app y Google Apps Script
   (sin DOM: funciona en el navegador y en el servidor)
═══════════════════════════════════════════════ */
const COLS = ['items','gastos','ingresos','cobros','abonos','transfers','ajustes','pend','bolsillos','reglas','fondos','repartos','contactos','topes','pedidos'];

/* ── Semillas: mismo id y u:1 en todos los dispositivos → nunca se duplican al sincronizar ──
   Bolsillo = DÓNDE está la plata. Apartado (fondos) = PARA QUÉ es la plata (SPEC §13). */
const SEED_BOLSILLOS = [
  {id:'efectivo', nombre:'Efectivo', ini:0, alias:['efectivo','cash','fisico','billete','plata en mano','en mano'], u:1},
  {id:'nequi', nombre:'Nequi', ini:0, alias:['nequi','mi nequi','neki','nequy'], u:1},
  {id:'nequi_pareja', nombre:'Nequi pareja', ini:0, alias:['nequi de mi pareja','pareja','mi novia','mi esposa','mi mujer','mi amor','de ella'], u:1}
];
const SEED_FONDOS = [
  {id:'negocio', nombre:'Negocio', emoji:'💼', alias:['negocio','capital','del negocio','plata del negocio'], orden:0, u:1},
  {id:'personal', nombre:'Personal', emoji:'👤', alias:['personal','lo personal','mi plata','para mi'], orden:1, u:1}
];
const copiaSemilla = r => JSON.parse(JSON.stringify(r));

function emptyDB(){
  const d = {};
  COLS.forEach(c => d[c] = []);
  d.bolsillos = SEED_BOLSILLOS.map(copiaSemilla);
  d.fondos = SEED_FONDOS.map(copiaSemilla);
  return d;
}

/* Completa una DB existente (p. ej. de una versión anterior): crea las colecciones que falten y agrega
   las semillas que no estén. NUNCA toca un registro que ya existe (ni si está borrado ni si el usuario
   lo editó); la única excepción es darle sus alias a una semilla que sigue intacta (u ≤ 1, sin alias),
   lo cual es idéntico en todos los dispositivos. Idempotente. Modifica `db` y lo devuelve. */
function ensureSeeds(db){
  db = db || {};
  COLS.forEach(c => { if(!Array.isArray(db[c])) db[c] = []; });
  const completar = (col, seeds) => {
    const out = db[col].slice();
    seeds.forEach(s => {
      const i = out.findIndex(r => r && r.id === s.id);
      if(i < 0) out.push(copiaSemilla(s));
      else {
        const r = out[i];
        // mismo orden de claves que la semilla → el JSON es idéntico en todos los dispositivos
        if((+r.u || 0) <= 1 && !r.del && !Array.isArray(r.alias)) out[i] = Object.assign(copiaSemilla(s), r, {alias: s.alias.slice()});
      }
    });
    db[col] = out;
  };
  completar('bolsillos', SEED_BOLSILLOS);
  completar('fondos', SEED_FONDOS);
  return db;
}

/* Une dos bases: por cada registro gana el más reciente (campo u). Los borrados son {del:1}.
   Empate de u (mismo ms en dos dispositivos): gana el borrado y, si no, el JSON mayor → el resultado
   NO depende del orden (a,b) y los dispositivos siempre convergen. */
function mergeDB(a, b){
  const out = {};
  a = a || {}; b = b || {};
  const gana = (r, p) => {
    const ur = +r.u || 0, up = +p.u || 0;
    if(ur !== up) return ur > up;
    if(!!r.del !== !!p.del) return !!r.del;
    return JSON.stringify(r) > JSON.stringify(p);
  };
  COLS.forEach(c => {
    const m = new Map();
    [...(a[c] || []), ...(b[c] || [])].forEach(r => {
      if(!r || r.id == null) return;
      const p = m.get(r.id);
      if(!p || gana(r, p)) m.set(r.id, r);
    });
    out[c] = [...m.values()];
  });
  return out;
}

const L = (db, c) => ((db && db[c]) || []).filter(x => !x.del);
const sum = (arr, k) => arr.reduce((s, x) => s + (+(k ? x[k] : x) || 0), 0);

/* ── Fechas y formato ── */
const ymd = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
// En Apps Script usamos la zona de Colombia explícita; en el celular, la hora local del teléfono.
const today = () => (typeof Utilities !== 'undefined' && Utilities.formatDate)
  ? Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd')
  : ymd(new Date());
const shiftDate = (s, n) => { const [y,m,d] = s.split('-').map(Number); return ymd(new Date(y, m-1, d+n)); };
const daysBetween = (a, b) => {
  if(!a || !b) return 0;
  const p = s => { const [y,m,d] = String(s).split('-').map(Number); return Date.UTC(y, m-1, d); };
  return Math.max(0, Math.round((p(b) - p(a)) / 864e5));
};
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const fmt = n => {
  n = +n || 0; const a = Math.abs(n), s = n < 0 ? '-' : '';
  if(a >= 999500) return s + '$' + (a/1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/,'') + 'M'; // 999.500+ ya redondea a $1M (antes salía "$1000K")
  if(a >= 1e3) return s + '$' + Math.round(a/1e3) + 'K';
  return s + '$' + Math.round(a);
};
const full = n => { n = Math.round(+n || 0); return (n < 0 ? '-' : '') + '$' + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
const fd = d => { if(!d) return '—'; const [y,m,dy] = String(d).split('-'); return dy + '/' + m + '/' + String(y).slice(2); };
const monthLabel = ym => { const [y,m] = ym.split('-'); return MESES[+m-1] + ' ' + y.slice(2); };

/* ── Montos en lenguaje natural: "1.2M", "50k", "50 mil", "1.200.000", "$ 50.000,00", "1 millón 200 mil" ── */
function extractMonto(text){
  const t = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
  const B = '(?=[\\s.,;:!?)\\]}"\'»”’]|$)';   // la unidad no puede ir pegada a una letra/dígito; sí a ")", ";", comillas…
  const D = '(?:\\$\\s?)?';                    // "$50k" / "$ 50 mil": el $ se consume con el monto (no queda suelto en rest)
  // Entero suelto de 4+ cifras ("tinto 2500"). Un año tras "modelo/año/del/versión/edición" NO es plata ("moto modelo 2024").
  const pelado = () => {
    const re = /(?:^|\s)(\d{4,})(?=[\s.,!?]|$)/g; let x;
    while((x = re.exec(t))){
      if(/^(?:19|20)\d\d$/.test(x[1]) && /(?:^|\s)(?:modelo|mod\.?|a[nñ]o|del|versi[oó]n|edici[oó]n)\s*:?\s*$/.test(t.slice(0, x.index))) continue;
      return x;
    }
    return null;
  };
  let m, monto = 0;
  if((m = t.match(new RegExp(D + '(\\d+(?:[.,]\\d+)?)\\s*(?:m|mill[oó]n(?:es)?|palos?|mel[oó]n(?:es)?)' + B + '(?:\\s*(?:y\\s*)?(\\d+)\\s*(?:k|mil|lucas?)' + B + ')?')))){
    monto = parseFloat(m[1].replace(',', '.')) * 1e6 + (m[2] ? +m[2] * 1e3 : 0);
  } else if((m = t.match(new RegExp(D + '(\\d+(?:[.,]\\d+)?)\\s*(?:k|mil|lucas?|barras?)' + B)))){
    monto = parseFloat(m[1].replace(',', '.')) * 1e3;
  } else if((m = t.match(/\$?\s?(\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?(?!\d)/))){
    monto = +m[1].replace(/\./g, '');
  } else if((m = t.match(/\$\s?(\d+)/)) || (m = pelado())){
    monto = +m[1];
  }
  // quitar EXACTAMENTE la ocurrencia que dio el monto (por posición, no la primera que se parezca)
  const rest = (m ? t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length) : t).replace(/\s+/g, ' ');
  return {monto: Math.round(monto) || 0, rest};
}

function parseMoney(s){
  s = String(s == null ? '' : s).trim();
  if(!s) return 0;
  if(/^\d+$/.test(s)) return +s;
  const r = extractMonto(s).monto;
  if(r) return r;
  return Math.round(parseFloat(s.replace(/\./g, '').replace(',', '.'))) || 0;
}

/* ── Notificaciones bancarias (Nequi, Bancolombia, etc.) ── */
// Reemplazada por la propuesta de DOCS (docs/parseNoti-propuesta.js, SPEC §10.6): sin OTP/códigos como monto, promos → monto 0,
// solicitudes/pagos pendientes → dir "?", y "quien" con remitente antes del verbo, llaves Bre-B, celulares y bancos. Ver tests/CAMBIOS-core.md.
function parseNoti(text){
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const low = t.toLowerCase();

  /* ── Verbos ── */
  const IN_STRONG  = /(recibiste|recibid[oa]|acredit|\bte (?:envi|mand|transfiri|consign|pag|devolvi)\w*|te lleg\w*|lleg[oó] plata|consignaron|recarga exitosa|recargaste|devoluci|reembols|ingres)/;
  const OUT_STRONG = /(enviaste|env[ií]o exitoso|pagaste|pago exitoso|compraste|compra exitosa|retiraste|retiro exitoso|sacaste|transferiste|se descont|descont|d[eé]bito)/;
  const OUT_WEAK   = /(compra |retir|pago |pagos? en|cobro)/;
  const PENDING    = /(pendiente|ac[eé]ptalo|rech[aá]zalo|\bacepta\b|\brechaza\b|te pidi[oó]|te solicit|solicitud|por aprobar)/;
  const PROMO      = /(\bgana(?:r|s)?\b|\bhasta \$|premio|sorteo|participa|descuento|oferta|promo|regalo|gratis|cashback|aprovecha|invita|sugerido|campa[nñ]a|beneficio|te prestamos|pr[eé]stamo)/;

  /* ── Monto: solo con "$"; sin "$" únicamente si dice COP/pesos o miles con punto/k/mil ── */
  let monto = 0;
  const m = t.match(/\$\s?([\d.,]+)/);
  if(m){
    monto = +m[1].replace(/[.,]$/, '').replace(/[.,]\d{1,2}$/, '').replace(/[.,]/g, '') || 0;
  } else if(/\bcop\b|pesos|\d{1,3}(?:\.\d{3})+|\d\s*(?:k|mil|millones?|m)\b/i.test(t)){
    monto = extractMonto(t).monto;
  }

  /* ── Dirección ── */
  let dir = '?';
  if(PENDING.test(low)) dir = '?';
  else if(IN_STRONG.test(low)) dir = 'in';
  else if(OUT_STRONG.test(low)) dir = 'out';
  else if(OUT_WEAK.test(low) && !PROMO.test(low)) dir = 'out';

  // Reverso / anulación de una compra con tarjeta ("NEQUI: Reversamos 35.500,00 de tu compra en RAPPI… a tu Tarjeta"): la plata VUELVE
  const REVERSO = /(reversamos|reversaron|reverso|reversi[oó]n|anulamos|anularon|anulaci[oó]n)/.test(low);
  if(REVERSO) dir = 'in';
  // Retención temporal ("*TEMPORARY HOLD"): todavía no es un movimiento
  if(/temporary hold|retenci[oó]n temporal/.test(low)) return {monto: 0, dir: '?', quien: '', retencion: true};
  // Promo sin verbo fuerte de movimiento → no es un movimiento
  if(!IN_STRONG.test(low) && !OUT_STRONG.test(low) && !PENDING.test(low) && PROMO.test(low)) monto = 0;
  // Aviso de SALDO ("Tu saldo en Nequi es $1.234.567"): no es un movimiento (agregado por QA; si trae verbo de movimiento se respeta)
  if(/\bsaldo\b/.test(low) && !IN_STRONG.test(low) && !OUT_STRONG.test(low) && !OUT_WEAK.test(low) && !PENDING.test(low)) monto = 0;
  if(!monto) return {monto: 0, dir, quien: ''};

  /* ── Quién ── */
  let quien = '';
  if(REVERSO){
    const rq = t.match(/compra\s+en\s+(.+?)(?:\s+a\s+tu\s+(?:tarjeta|cuenta|nequi)\b.*)?$/i);
    if(rq) return {monto, dir, quien: rq[1].trim(), reverso: true};
  }
  const BL = /^(nequi|tu |su |el |la |los |las |un |una |bancolombia|daviplata|cuenta|colombia|forma|manera)/i;
  const NOT_NAME = /^(nequi|alguien|tu|te|la|el)$/i;
  let q;

  // (a) "JUAN PEREZ te envió/mandó/pidió …"  (nombre ANTES del verbo)
  if((q = t.match(/(?:^|[!¡?.:]\s*)(?:nequi\s+)?([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ' ]{1,40}?)\s+te\s+(?:envi|mand|transfiri|consign|pag|pidi|solicit|devolvi)\w*/i)) && !NOT_NAME.test(q[1].trim())){
    quien = q[1].trim();
  }
  // (b) llave Bre-B: "a la llave @luisgomez"
  if(!quien && (q = t.match(/\b(?:a|de|desde|para)\s+la\s+llave\s+(\S+?)(?=[\s.,;!?]|$)/i))) quien = q[1];
  // (c) celular de 10 dígitos: "a 3001234567"
  if(!quien && (q = t.match(/\b(?:a|de|desde|para)\s+(3\d{2}[ -]?\d{3}[ -]?\d{4})\b/i))) quien = q[1].replace(/[ -]/g, '');
  // (d) regla original: (a|de|en|desde|para) + nombre
  if(!quien){
    const re = /(?:^|\s)(?:a|de|en|desde|para)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][^$\n.,:;!?]{1,40})/g;
    while((q = re.exec(t))){
      const c = q[1].trim();
      if(!BL.test(c)){ quien = c; break; }
      re.lastIndex = q.index + q[0].indexOf(q[1]) + 1; // seguir buscando dentro del texto descartado
    }
  }
  // (e) bancos como origen/destino: "desde Bancolombia", "a Davivienda"
  if(!quien && (q = t.match(/\b(?:desde|de|a)\s+(Bancolombia|Davivienda|Daviplata|Bogot[aá]|Nu|Lulo(?: Bank)?|Dale!?|Movii|Banco [A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]+)(?=[\s.,;!?]|$)/))) quien = q[1];

  // recortar lo que sigue al nombre: "por/con/hoy/desde…", "el día 5", "el 05/10/2026", "a las 10:30"
  quien = quien.replace(/\s+(?:(?:por|con|hoy|exitosamente|desde)(?=\s|$)|el\s+d[ií]a(?=\s|$)|el\s+\d|a\s+las?\s+\d).*$/i, '').trim();
  return {monto, dir, quien};
}

/* ── Saldos: se CALCULAN desde los movimientos (nunca se descuadran) ── */
function balances(db){
  const b = {};
  L(db, 'bolsillos').forEach(p => b[p.id] = +p.ini || 0);
  const add = (id, v) => { if(id == null || id === '') return; if(!(id in b)) b[id] = 0; b[id] += +v || 0; };
  L(db, 'items').forEach(i => {
    add(i.buyPocket, -i.buyPrice);
    if(i.status === 'sold') add(i.sellPocket, i.sellPaid != null ? i.sellPaid : i.sellPrice);
  });
  L(db, 'gastos').forEach(g => add(g.bolsillo, -g.valor));
  L(db, 'ingresos').forEach(g => add(g.bolsillo, g.valor));
  L(db, 'abonos').forEach(a => add(a.bolsillo, a.monto));
  L(db, 'cobros').forEach(c => { if(c.bolsillo) add(c.bolsillo, -((+c.total || 0) - (+c.pagado || 0))); });
  L(db, 'transfers').forEach(t => { add(t.from, -t.monto); add(t.to, t.monto); });
  L(db, 'ajustes').forEach(a => add(a.bolsillo, a.delta));
  return b;
}

/* ── Apartados (fondos): PARA QUÉ es la plata ──
   fondoDe(col, rec, db) → id del apartado al que pertenece la plata de un registro.
   Orden: rec.fondo (si ese apartado existe y no está borrado; si no existe → 'personal')
   → items: 'negocio' → gastos: tipo 'negocio' ? 'negocio' : 'personal' → ingresos: 'personal'
   → cobros: con itemId 'negocio', si no 'personal' → abonos: el del cobro → ajustes: 'personal'.
   Si el apartado por defecto está borrado → 'personal'. transfers y repartos no tienen apartado → null. */
function fondoResolver(db){
  const vivos = new Set(L(db, 'fondos').map(f => f.id));
  const cobros = new Map();
  ((db && db.cobros) || []).forEach(c => { if(c && c.id != null && (!cobros.has(c.id) || !c.del)) cobros.set(c.id, c); });
  const valido = id => (id === 'personal' || vivos.has(id)) ? id : 'personal';
  const resolver = (col, rec) => {
    rec = rec || {};
    if(col === 'transfers' || col === 'repartos') return null;
    if(rec.fondo != null && rec.fondo !== '') return valido(rec.fondo);
    switch(col){
      case 'items': return valido('negocio');
      case 'gastos': return valido(rec.tipo === 'negocio' ? 'negocio' : 'personal');
      case 'cobros': return valido(rec.itemId ? 'negocio' : 'personal');
      case 'abonos': { const c = cobros.get(rec.cobroId); return c ? resolver('cobros', c) : 'personal'; }
      default: return 'personal'; // ingresos, ajustes y cualquier otro
    }
  };
  resolver.valido = valido;
  return resolver;
}
function fondoDe(col, rec, db){ return fondoResolver(db)(col, rec); }

/* Saldo por apartado: los MISMOS movimientos que balances() (mismas condiciones y montos), agrupados
   por apartado, más los repartos. Invariante: suma(balancesFondos) === suma(balances).
   El saldo inicial de cada bolsillo se reparte con iniFondos {fondoId: monto}; lo no repartido → 'personal'.
   Un apartado puede quedar negativo (p. ej. el negocio usó plata personal). */
function balancesFondos(db){
  const fdo = fondoResolver(db);
  const f = {};
  const has = k => Object.prototype.hasOwnProperty.call(f, k);
  const put = (k, v) => { if(!has(k)) f[k] = 0; f[k] += +v || 0; };
  L(db, 'fondos').forEach(x => { if(!has(x.id)) f[x.id] = 0; });
  if(!has('personal')) f.personal = 0;
  // como balances(): mismo bolsillo vivo repetido → cuenta el ini del último
  const ini = new Map();
  L(db, 'bolsillos').forEach(p => ini.set(String(p.id), p));
  ini.forEach(p => {
    let resto = +p.ini || 0;
    const parts = (p.iniFondos && typeof p.iniFondos === 'object' && !Array.isArray(p.iniFondos)) ? p.iniFondos : {};
    Object.keys(parts).forEach(k => {
      const v = +parts[k] || 0;
      if(!v) return;
      put(fdo.valido(k), v);
      resto -= v;
    });
    put('personal', resto);
  });
  // un movimiento solo cuenta si toca un bolsillo (igual que add() en balances)
  const add = (pocket, fondo, v) => { if(pocket == null || pocket === '') return; put(fondo, v); };
  L(db, 'items').forEach(i => {
    const k = fdo('items', i);
    add(i.buyPocket, k, -i.buyPrice);
    if(i.status === 'sold') add(i.sellPocket, k, i.sellPaid != null ? i.sellPaid : i.sellPrice);
  });
  L(db, 'gastos').forEach(g => add(g.bolsillo, fdo('gastos', g), -g.valor));
  L(db, 'ingresos').forEach(g => add(g.bolsillo, fdo('ingresos', g), g.valor));
  L(db, 'abonos').forEach(a => add(a.bolsillo, fdo('abonos', a), a.monto));
  L(db, 'cobros').forEach(c => { if(c.bolsillo) add(c.bolsillo, fdo('cobros', c), -((+c.total || 0) - (+c.pagado || 0))); });
  // transfers: cambian DÓNDE está la plata, no PARA QUÉ es → su neto en apartados es 0. Se recorren igual que
  // en balances() para que un transfer cojo (sin "desde" o sin "hacia") cuadre también: esa plata va a 'personal'.
  L(db, 'transfers').forEach(t => { add(t.from, 'personal', -t.monto); add(t.to, 'personal', t.monto); });
  L(db, 'ajustes').forEach(a => add(a.bolsillo, fdo('ajustes', a), a.delta));
  L(db, 'repartos').forEach(r => {
    const m = +r.monto || 0;
    if(!m) return;
    put(fdo.valido(r.from), -m);
    put(fdo.valido(r.to), m);
  });
  return f;
}

function cobroPagado(db, c){
  return (+c.pagado || 0) + sum(L(db, 'abonos').filter(a => a.cobroId === c.id), 'monto');
}
function cobrosPend(db){
  return L(db, 'cobros').map(c => {
    const pag = cobroPagado(db, c);
    return Object.assign({}, c, {pag, pend: Math.max(0, (+c.total || 0) - pag)});
  }).filter(c => c.pend > 0);
}

/* Utilidad del mes: se reconoce cuando VENDES (precio venta − costo − gastos de negocio) */
function monthStats(db, ym){
  const inM = d => !ym || String(d || '').slice(0, 7) === ym;
  const sold = L(db, 'items').filter(i => i.status === 'sold' && inM(i.sellDate));
  const ventas = sum(sold, 'sellPrice'), costo = sum(sold, 'buyPrice'), bruta = ventas - costo;
  const g = L(db, 'gastos').filter(x => inM(x.fecha));
  const gN = sum(g.filter(x => x.tipo === 'negocio'), 'valor');
  const gP = sum(g.filter(x => x.tipo !== 'negocio'), 'valor');
  const neta = bruta - gN;
  const compras = sum(L(db, 'items').filter(i => inM(i.buyDate)), 'buyPrice');
  const ing = sum(L(db, 'ingresos').filter(x => inM(x.fecha)), 'valor');
  const diasProm = sold.length ? Math.round(sold.reduce((a, i) => a + daysBetween(i.buyDate, i.sellDate), 0) / sold.length) : null;
  const cats = {};
  g.forEach(x => { const k = (x.tipo === 'negocio' ? '🏢 ' : '👤 ') + (x.cat || 'Otro'); cats[k] = (cats[k] || 0) + (+x.valor || 0); });
  return {sold, nVentas: sold.length, ventas, costo, bruta, gN, gP, neta, margen: ventas ? neta / ventas * 100 : 0, compras, ing, diasProm, cats};
}


/* ── Rendimiento (ronda 8): ¿estoy creciendo o me estoy comiendo el capital? ──
   Patrimonio = plata en bolsillos + stock (a lo que costó) + lo que te deben, a una fecha. */
function dbAlCorte(db, fecha){
  const ok = d => !d || String(d) <= fecha;
  const out = {};
  COLS.forEach(c => { out[c] = (db[c] || []).slice(); });
  out.items = L(db, 'items').filter(i => ok(i.buyDate)).map(i => i.status === 'sold' && i.sellDate && String(i.sellDate) > fecha
    ? Object.assign({}, i, {status: 'stock', sellPrice: undefined, sellPaid: undefined, sellPocket: undefined, sellDate: undefined}) : i);
  ['gastos', 'ingresos', 'abonos', 'transfers', 'ajustes', 'repartos', 'cobros'].forEach(c => { out[c] = L(db, c).filter(x => ok(x.fecha)); });
  return out;
}
function patrimonio(db, fecha){
  const d = fecha ? dbAlCorte(db, fecha) : db;
  const b = balances(d), caja = Object.keys(b).reduce((a, k) => a + (b[k] || 0), 0);
  const stock = sum(L(d, 'items').filter(i => i.status !== 'sold'), 'buyPrice');
  const deben = sum(cobrosPend(d), 'pend');
  return {caja, stock, deben, total: caja + stock + deben};
}
const finDeMes = ym => { const [y, m] = ym.split('-').map(Number); return ymd(new Date(y, m, 0)); };
const mesAnterior = ym => { const [y, m] = ym.split('-').map(Number); return ymd(new Date(y, m - 2, 1)).slice(0, 7); };
function rendimiento(db, ym){
  const hoy = today();
  ym = ym || hoy.slice(0, 7);
  const actual = ym === hoy.slice(0, 7);
  const fin = actual ? hoy : finDeMes(ym), ini = finDeMes(mesAnterior(ym));
  const pIni = patrimonio(db, ini), pFin = patrimonio(db, fin);
  const s = monthStats(db, ym);
  const disponible = s.neta + s.ing;                       // lo que entró de verdad para gastar: ganancia + ingresos personales
  const pctGasto = s.neta > 0 ? s.gP / s.neta : null;
  const comido = Math.max(0, s.gP - Math.max(0, disponible));
  const roi = pIni.total > 0 ? s.neta / pIni.total : null; // cuánto rindió el capital en el mes
  const vueltas = s.diasProm ? Math.round(30 / Math.max(1, s.diasProm) * 10) / 10 : null;
  const quietos = L(dbAlCorte(db, fin), 'items').filter(i => i.status !== 'sold' && daysBetween(i.buyDate, fin) >= 30);
  const serie = [];
  let m = ym;
  for(let k = 0; k < 6; k++){ serie.unshift({ym: m, total: patrimonio(db, m === hoy.slice(0, 7) ? hoy : finDeMes(m)).total}); m = mesAnterior(m); }
  let estado = 'sin-datos';
  if(s.nVentas || s.gP){
    if(comido > 0) estado = 'comiendo';
    else if(pctGasto != null && pctGasto > 0.8) estado = 'justo';
    else estado = 'creciendo';
  }
  return {ym, actual, pIni, pFin, cambio: pFin.total - pIni.total, neta: s.neta, gP: s.gP, ing: s.ing, pctGasto, comido, roi,
    diasProm: s.diasProm, vueltas, margen: s.margen, quietos: {n: quietos.length, total: sum(quietos, 'buyPrice')}, serie, estado};
}

/* ── Textos para notificaciones (MacroDroid) ── */
function summaryText(db){
  const t = today(), from = shiftDate(t, -6), inR = d => d && d >= from && d <= t;
  const sold = L(db, 'items').filter(i => i.status === 'sold' && inR(i.sellDate));
  const ventas = sum(sold, 'sellPrice'), bruta = ventas - sum(sold, 'buyPrice');
  const g = L(db, 'gastos').filter(x => inR(x.fecha));
  const gN = sum(g.filter(x => x.tipo === 'negocio'), 'valor'), gP = sum(g.filter(x => x.tipo !== 'negocio'), 'valor');
  const b = balances(db), caja = Object.keys(b).reduce((a, k) => a + b[k], 0);
  const st = L(db, 'items').filter(i => i.status === 'stock');
  const quietos = st.filter(i => daysBetween(i.buyDate, t) >= 30);
  const cp = cobrosPend(db), np = L(db, 'pend').length;
  const lines = [];
  lines.push(sold.length ? `📊 ${sold.length} venta${sold.length > 1 ? 's' : ''} por ${fmt(ventas)} · utilidad ${fmt(bruta - gN)}` : '📊 Sin ventas esta semana');
  lines.push(`💸 Gastos ${fmt(gN + gP)} (negocio ${fmt(gN)} · personal ${fmt(gP)})`);
  lines.push(`💵 Caja ${fmt(caja)} · 📦 Stock ${fmt(sum(st, 'buyPrice'))} (${st.length})`);
  const lf = fondosLinea(db);
  if(lf) lines.push(lf);
  if(cp.length) lines.push(`🤝 Te deben ${fmt(sum(cp, 'pend'))}: ` + cp.slice(0, 3).map(c => String(c.nombre).split(' ')[0] + ' ' + fmt(c.pend)).join(', '));
  if(quietos.length) lines.push(`⚠️ ${quietos.length} producto${quietos.length > 1 ? 's' : ''} con +30 días: ` + quietos.slice(0, 2).map(i => i.desc).join(', '));
  if(np) lines.push(`📲 ${np} movimiento${np > 1 ? 's' : ''} por clasificar`);
  const ins = monthInsight(db);
  if(ins) lines.push(ins);
  return lines.join('\n');
}

function remindersText(db){
  const t = today(), lines = [];
  cobrosPend(db).filter(c => c.compromiso && c.compromiso <= t).forEach(c =>
    lines.push(`🤝 ${c.nombre} ${c.compromiso === t ? 'prometió pagarte hoy' : 'debía pagarte el ' + fd(c.compromiso)}: ${fmt(c.pend)}`));
  const np = L(db, 'pend').length;
  if(np) lines.push(`📲 Tienes ${np} movimiento${np > 1 ? 's' : ''} por clasificar`);
  // Empujón de hábito: si lleva 3+ días sin registrar nada, recordárselo
  const lastU = ['items','gastos','ingresos','abonos','transfers','cobros']
    .reduce((mx, c) => L(db, c).reduce((m, x) => Math.max(m, +x.u || 0), mx), 0);
  if(lastU > 1){
    const dias = Math.floor((Date.now() - lastU) / 864e5);
    if(dias >= 3) lines.push(`📝 Llevas ${dias} días sin registrar nada. ¿Compraste, vendiste o gastaste algo?`);
  }
  // Topes de gasto del mes (SPEC §14)
  topesEstado(db, t.slice(0, 7)).forEach(x => {
    if(x.estado === 'pasado') lines.push(`🚨 Te pasaste del ${nombreTope(x.tope)} por ${fmt(x.gastado - (+x.tope.limite || 0))}`);
    else if(x.estado === 'cerca') lines.push(`⚠️ Ya gastaste el ${x.pct}% de tu ${nombreTope(x.tope)}`);
  });
  // Cuadre: si hace 15+ días no registra un ajuste (o, si nunca lo ha hecho, desde su primer movimiento)
  const fechasMov = [];
  L(db, 'items').forEach(i => { fechasMov.push(i.buyDate); if(i.status === 'sold') fechasMov.push(i.sellDate); });
  ['gastos','ingresos','abonos','transfers','cobros','repartos'].forEach(c => L(db, c).forEach(x => fechasMov.push(x.fecha)));
  const validas = fechasMov.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))).sort();
  if(validas.length){
    const ultAjuste = L(db, 'ajustes').map(a => String(a.fecha || '')).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop();
    const desde = ultAjuste || validas[0];
    if(desde <= t && daysBetween(desde, t) >= 15) lines.push('🧮 Hace rato no cuadras: compara tus saldos con Nequi y el efectivo real');
  }
  return lines.join('\n');
}

/* Apartados vivos en orden (orden, luego nombre). */
function fondosOrdenados(db){
  return L(db, 'fondos').slice().sort((a, b) => ((+a.orden || 0) - (+b.orden || 0)) || String(a.nombre || '').localeCompare(String(b.nombre || '')));
}
/* "💼 Negocio $1.2M · 👤 Personal $300K · 🏠 Arriendo $0" ('' si no hay apartados) */
function fondosLinea(db){
  const bf = balancesFondos(db), lista = fondosOrdenados(db);
  const ids = lista.map(f => f.id);
  Object.keys(bf).forEach(k => { if(ids.indexOf(k) < 0 && bf[k]) ids.push(k); });
  const nombre = id => { const f = lista.find(x => x.id === id); return f ? ((f.emoji ? f.emoji + ' ' : '') + (f.nombre || id)) : (id === 'personal' ? '👤 Personal' : id); };
  return ids.map(id => nombre(id) + ' ' + fmt(bf[id] || 0)).join(' · ');
}

/* ═══════════════ Ronda 5 (SPEC §14): historial, referencia de precios, comentario del mes, topes y contactos ═══════════════ */

/* Texto comparable: minúsculas, sin tildes, solo letras/números separados por un espacio. */
function normNombre(s){
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/* Clave de MODELO para comparar productos entre sí ("iphone 15 pro 256gb azul" → "iphone 15 pro").
   Quita capacidad, RAM, colores, estado, tallas y relleno; une alias de marcas (iPhone, Samsung, PlayStation,
   Xbox, Switch, MacBook, tenis). Si no reconoce nada, devuelve el texto limpio. */
function normModelo(desc){
  let s = ' ' + normNombre(desc)
    .replace(/(\d)\s*(gb|tb|g|t)\b/g, '$1$2') + ' ';
  const R = (re, to) => { s = s.replace(re, to); };
  // capacidad / RAM / batería / talla
  R(/\s\d+\s?(?:gb|g|tb|t)(?=\s)/g, ' ');
  R(/\s\d+\s\d+(?=\s)/g, m => /^\s(?:4|6|8|12|16)\s(?:64|128|256|512|1024)$/.test(m) ? ' ' : m); // "8/256" (normNombre lo deja "8 256")
  R(/\s(?:de\s)?(?:32|64|128|256|512|1024)(?=\s)/g, ' ');
  R(/\s(?:con\s)?(?:la\s)?bateria(?:\sal)?(?:\s(?:de|en))?\s\d{1,3}(?:\s?%|\sporciento|\spor\sciento)?(?=\s)/g, ' ');
  R(/\s\d{1,3}\s(?:de\s)?bateria(?=\s)/g, ' ');
  R(/\stalla\s\d+(?:\s\d)?(?=\s)/g, ' ');
  R(/\st\d{2}(?=\s)/g, ' ');
  // marcas / alias multi-palabra
  R(/\s(?:i\s?phone|iph|ip)(?=\s)/g, ' iphone ');
  R(/\spro\s?max\s/g, ' pro max '); R(/\spromax\s/g, ' pro max '); R(/\spm(?=\s)/g, ' pro max ');
  R(/\s(?:play\s?station|play|psx?)\s?(\d)(?=\s)/g, ' ps$1 ');
  R(/\sps\s(\d)(?=\s)/g, ' ps$1 ');
  R(/\sseries?\s([sx])(?=\s)/g, ' series $1 ');
  R(/\smac\sbook(?=\s)/g, ' macbook ');
  R(/\sz\s?(flip|fold)\s?(\d)(?=\s)/g, ' z $1 $2 ');
  R(/\sair\sjordan(?=\s)/g, ' jordan ');
  R(/\saf\s?1(?=\s)/g, ' air force 1 ');
  // palabras que no cambian el modelo: estado, colores, relleno, marcas implícitas
  const FUERA = new Set(('de del el la los las un una en con sin y color caja cargador original originales usado usada nuevo nueva nuevecito ' +
    'sellado sellada generico generica replica bueno buena regular perfecto perfecta impecable estado condicion como detalle detalles ' +
    'liberado desbloqueado libre esim fisico dual sim version edicion estandar digital fat slim disco lector retro low high mid ' +
    'negro negra blanco blanca azul rojo roja verde morado morada lila rosado rosada rosa dorado dorada plateado plateada gris amarillo ' +
    'naranja coral grafito medianoche estelar titanio natural desierto ultramar black white blue red green purple pink gold silver gray grey ' +
    'graphite midnight starlight space espacial sierra alpine tenis zapatillas zapatos apple galaxy nintendo consola celular telefono ' +
    'portatil nike').split(' '));
  const fuera = w => FUERA.has(w) || (/s$/.test(w) && FUERA.has(w.slice(0, -1))) || (/es$/.test(w) && FUERA.has(w.slice(0, -2))); // plurales: blancos, azules
  let t = s.trim().split(/\s+/).filter(w => w && !fuera(w));
  // reglas por marca
  if(t.length && /^(?:\d{1,2}|x|xr|xs|se)$/.test(t[0]) && (t.length === 1 || /^(?:pro|max|plus|mini|e)$/.test(t[1]))){
    const n = +t[0];
    if(isNaN(n) || (n >= 6 && n <= 17)) t = ['iphone'].concat(t);       // "15 pro" → iphone 15 pro
  }
  if(t[0] !== 'samsung' && /^(?:s|a|m|note)\d{1,2}$/.test(t[0] || '') ) t = ['samsung'].concat(t);
  if(t[0] === 'z' && /^(?:flip|fold)$/.test(t[1] || '')) t = ['samsung'].concat(t);
  if(t[0] === 'series' && /^[sx]$/.test(t[1] || '')) t = ['xbox'].concat(t);
  if(t[0] === 'xbox' && t[1] === 'serie') t[1] = 'series';
  if(t[0] === 'oled' || t[0] === 'lite') t = ['switch'].concat(t);
  return t.join(' ');
}

/* Costo real de un producto = lo que pagaste (buyPrice) + sus gastos ligados (gastos vivos con itemId).
   Si el producto vino como PARTE DE PAGO (fromTradeOf), su buyPrice es el valor en que lo recibiste (estimado):
   ese es su costo, porque así se contó en la venta del otro producto. */
function costoItem(db, item, extras){
  extras = extras || L(db, 'gastos').filter(g => g.itemId != null && g.itemId === item.id);
  return (+item.buyPrice || 0) + sum(extras, 'valor');
}

function nombreContacto(db, id, texto){
  if(id){ const c = ((db && db.contactos) || []).find(x => x && x.id === id); if(c && c.nombre) return c.nombre; }
  return texto || '';
}

/* Historia completa de un producto (para la ficha). null si no existe. */
function itemHistory(db, itemId){
  const todos = (db && db.items) || [];
  const item = todos.find(i => i && i.id === itemId && !i.del) || todos.find(i => i && i.id === itemId);
  if(!item) return null;
  const costosExtra = L(db, 'gastos').filter(g => g.itemId != null && g.itemId === item.id)
    .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));
  const costoTotal = costoItem(db, item, costosExtra);
  const vendido = item.status === 'sold';
  const venta = vendido ? {
    precio: +item.sellPrice || 0,
    pagado: item.sellPaid != null ? (+item.sellPaid || 0) : (+item.sellPrice || 0),
    fecha: item.sellDate || '', bolsillo: item.sellPocket || '',
    cliente: nombreContacto(db, item.clienteId, item.cliente)
  } : null;
  const ganancia = vendido ? venta.precio - costoTotal : null;
  const margen = vendido && venta.precio ? ganancia / venta.precio * 100 : null;
  const dias = daysBetween(item.buyDate, vendido ? item.sellDate : today());
  const buscar = id => (id ? todos.find(i => i && i.id === id && !i.del) || null : null);
  const origen = buscar(item.fromTradeOf);
  const recibido = buscar(item.tradeInId) || L(db, 'items').find(i => i.fromTradeOf === item.id) || null;
  const c = L(db, 'cobros').find(x => x.itemId === item.id);
  const cobro = c ? (() => { const pag = cobroPagado(db, c); return Object.assign({}, c, {pag, pend: Math.max(0, (+c.total || 0) - pag)}); })() : null;
  return {item, costosExtra, costoTotal, venta, ganancia, margen, dias, origen, recibido, cobro,
    proveedor: nombreContacto(db, item.proveedorId, item.proveedor)};
}

const redondear10k = n => Math.round(n / 1e4) * 1e4;

/* Referencia de precios de un modelo: query = texto ("iphone 13 128") o un item. null si no hay datos. */
function priceRef(db, query){
  const modelo = normModelo(query && typeof query === 'object' ? query.desc : query);
  if(!modelo) return null;
  const items = L(db, 'items').filter(i => normModelo(i.desc) === modelo);
  if(!items.length) return null;
  const extrasDe = new Map();
  L(db, 'gastos').forEach(g => { if(g.itemId != null) extrasDe.set(g.itemId, (extrasDe.get(g.itemId) || 0) + (+g.valor || 0)); });
  const costo = i => (+i.buyPrice || 0) + (extrasDe.get(i.id) || 0);
  const resumen = (arr, precio, fecha) => {
    if(!arr.length) return {n: 0, prom: null, min: null, max: null, ultima: null};
    const v = arr.map(precio), u = arr.slice().sort((a, b) => String(fecha(b)).localeCompare(String(fecha(a))))[0];
    return {n: arr.length, prom: Math.round(sum(v) / v.length), min: Math.min.apply(null, v), max: Math.max.apply(null, v),
      ultima: {precio: precio(u), fecha: fecha(u) || ''}};
  };
  const comprados = items.filter(i => (+i.buyPrice || 0) > 0);
  const vendidos = items.filter(i => i.status === 'sold' && (+i.sellPrice || 0) > 0);
  const compras = resumen(comprados, i => +i.buyPrice || 0, i => i.buyDate);
  const ventas = resumen(vendidos, i => +i.sellPrice || 0, i => i.sellDate);
  const gananciaProm = vendidos.length ? Math.round(sum(vendidos.map(i => (+i.sellPrice || 0) - costo(i))) / vendidos.length) : null;
  const diasProm = vendidos.length ? Math.round(sum(vendidos.map(i => daysBetween(i.buyDate, i.sellDate))) / vendidos.length) : null;
  let sugeridoVenta = null;
  if(vendidos.length){
    const rec = vendidos.slice().sort((a, b) => String(b.sellDate || '').localeCompare(String(a.sellDate || ''))).slice(0, 3);
    sugeridoVenta = redondear10k(sum(rec, 'sellPrice') / rec.length);
  } else if(compras.n){
    // margen de ganancia sobre el costo de TODO lo que has vendido (si no hay o es ≤ 0: 15 %)
    const todo = L(db, 'items').filter(i => i.status === 'sold');
    const c = sum(todo.map(costo)), v = sum(todo, 'sellPrice');
    const m = c > 0 && v > c ? (v - c) / c : 0.15;
    sugeridoVenta = redondear10k(compras.prom * (1 + m));
  }
  const orden = items.slice().sort((a, b) => String(b.sellDate || b.buyDate || '').localeCompare(String(a.sellDate || a.buyDate || '')));
  return {modelo, compras, ventas, gananciaProm, diasProm, sugeridoVenta, items: orden};
}

/* Estado de los topes de gasto del mes. cat '__personal' = todo lo personal (tipo ≠ negocio). */
function topesEstado(db, ym){
  ym = ym || today().slice(0, 7);
  const g = L(db, 'gastos').filter(x => String(x.fecha || '').slice(0, 7) === ym);
  return L(db, 'topes').map(tope => {
    const gastado = sum(g.filter(x => tope.cat === '__personal' ? x.tipo !== 'negocio' : x.cat === tope.cat), 'valor');
    const lim = +tope.limite || 0;
    const pct = lim > 0 ? Math.round(gastado / lim * 100) : 0;
    const estado = lim > 0 && gastado > lim ? 'pasado' : (lim > 0 && pct >= 80 ? 'cerca' : 'ok');
    return {tope, gastado, pct, estado};
  });
}
const nombreTope = t => (t.cat === '__personal' ? 'tope personal' : 'tope de ' + t.cat);

/* Base "como iba" al cierre de `hasta` (YYYY-MM-DD): sin ventas ni gastos posteriores. */
function statsHasta(db, ym, hasta){
  const d = Object.assign({}, db, {
    items: L(db, 'items').filter(i => !(i.status === 'sold' && String(i.sellDate || '') > hasta)),
    gastos: L(db, 'gastos').filter(x => String(x.fecha || '') <= hasta)
  });
  return monthStats(d, ym);
}

/* Comentario del mes (≤ 90 caracteres, tono amable). '' si no hay datos suficientes. */
function monthInsight(db, ym){
  const hoy = today(), ymHoy = hoy.slice(0, 7);
  ym = ym || ymHoy;
  if(L(db, 'items').filter(i => i.status === 'sold').length < 2) return '';
  const [y, m] = ym.split('-').map(Number);
  const prevYm = m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0');
  const enCurso = ym === ymHoy;
  let cur, prev;
  if(enCurso){
    const dia = +hoy.slice(8, 10);
    const [py, pm] = prevYm.split('-').map(Number);
    const finPrev = new Date(py, pm, 0).getDate();
    cur = statsHasta(db, ym, hoy);
    prev = statsHasta(db, prevYm, prevYm + '-' + String(Math.min(dia, finPrev)).padStart(2, '0'));
  } else {
    cur = monthStats(db, ym); prev = monthStats(db, prevYm);
  }
  const hayCur = cur.nVentas > 0 || cur.gN + cur.gP > 0;
  if(!hayCur) return '';
  const C = []; // {s: frase, p: peso}
  // 1) utilidad
  if(prev.nVentas > 0 || cur.nVentas > 0){
    const d = cur.neta - prev.neta;
    const rel = Math.min(1.5 * Math.abs(d) / Math.max(Math.abs(prev.neta), 1), 2); // la utilidad pesa más que lo demás
    if(prev.nVentas > 0 && Math.abs(d) < Math.max(1000, Math.abs(prev.neta) * 0.05)){ /* casi igual: nada que contar */ }
    else if(prev.nVentas === 0) C.push({s: `💰 ${enCurso ? 'Llevas' : 'Hiciste'} ${fmt(cur.neta)} de utilidad este mes`, p: 0.4});
    else if(enCurso) C.push({s: d >= 0
      ? `📈 Llevas ${fmt(cur.neta)} de utilidad, ${fmt(d)} más que a esta altura del mes pasado`
      : (cur.nVentas === 0
        ? `🌱 Mes arrancando: a esta altura del mes pasado llevabas ${fmt(prev.neta)} de utilidad`
        : `📉 Llevas ${fmt(cur.neta)}; a esta altura del mes pasado llevabas ${fmt(prev.neta)}`), p: rel});
    else C.push({s: d >= 0
      ? `📈 Utilidad de ${fmt(cur.neta)}, ${fmt(d)} más que el mes anterior`
      : `📉 Utilidad de ${fmt(cur.neta)}, ${fmt(-d)} menos que el mes anterior`, p: rel});
  }
  // 2) margen
  if(cur.ventas > 0 && prev.ventas > 0){
    const a = Math.round(cur.margen), b = Math.round(prev.margen);
    if(Math.abs(a - b) >= 5) C.push({s: a > b ? `💹 Tu margen subió a ${a}% (antes ${b}%)` : `🔎 Tu margen bajó a ${a}% (antes ${b}%)`, p: Math.abs(a - b) / 20});
  }
  // 3) producto más rentable
  if(cur.sold.length){
    const best = cur.sold.map(i => ({i, g: (+i.sellPrice || 0) - costoItem(db, i)})).sort((a, b) => b.g - a.g)[0];
    if(best.g > 0){
      const n = String(best.i.desc || 'un producto');
      C.push({s: `🏆 Lo más rentable: ${n.length > 28 ? n.slice(0, 27) + '…' : n} (+${fmt(best.g)})`, p: 0.5});
    }
  }
  // 4) gasto personal que más subió (misma altura del mes si va en curso)
  const per = st => { const o = {}; Object.keys(st.cats).forEach(k => { if(k.indexOf('👤 ') === 0) o[k.slice(3)] = st.cats[k]; }); return o; };
  const pc = per(cur), pp = per(prev);
  let peor = null;
  Object.keys(pc).forEach(k => {
    const d = pc[k] - (pp[k] || 0);
    if(k !== 'Otro' && d >= 20000 && (!pp[k] || d / pp[k] >= 0.5) && (!peor || d > peor.d)) peor = {k, d, v: pc[k]};
  });
  if(peor) C.push({s: `👀 ${peor.k} va en ${fmt(peor.v)}, ${fmt(peor.d)} más que el mes pasado`, p: Math.min(peor.d / Math.max(pp[peor.k] || 0, peor.d), 1) * 0.6});
  // 5) días promedio para vender
  if(cur.diasProm != null && prev.diasProm != null && Math.abs(cur.diasProm - prev.diasProm) >= 3){
    C.push({s: cur.diasProm < prev.diasProm
      ? `⚡ Vendes más rápido: ${cur.diasProm} días en promedio (antes ${prev.diasProm})`
      : `⏳ Estás tardando un poco más en vender: ${cur.diasProm} días (antes ${prev.diasProm})`,
      p: Math.abs(cur.diasProm - prev.diasProm) / Math.max(prev.diasProm, 1)});
  }
  if(!C.length) return '';
  C.sort((a, b) => b.p - a.p);
  const uno = C[0].s.length <= 90 ? C[0].s : C[0].s.slice(0, 89) + '…';
  if(C[1] && C[1].p >= 0.5 && (uno + ' · ' + C[1].s).length <= 90) return uno + ' · ' + C[1].s;
  return uno;
}

/* Resumen de un contacto: por proveedorId/clienteId o, si el registro no tiene id, por nombre normalizado. */
function contactoStats(db, contactoId){
  const c = L(db, 'contactos').find(x => x.id === contactoId);
  if(!c) return null;
  const n = normNombre(c.nombre);
  const es = (id, texto) => (id ? id === c.id : (!!n && normNombre(texto) === n));
  const compras = L(db, 'items').filter(i => es(i.proveedorId, i.proveedor));
  const ventas = L(db, 'items').filter(i => i.status === 'sold' && es(i.clienteId, i.cliente));
  const cobros = cobrosPend(db).filter(x => es(x.contactoId, x.nombre));
  const ev = [];
  compras.forEach(i => ev.push({fecha: i.buyDate || '', tipo: 'compra', desc: i.desc, itemId: i.id}));
  ventas.forEach(i => ev.push({fecha: i.sellDate || '', tipo: 'venta', desc: i.desc, itemId: i.id}));
  L(db, 'cobros').filter(x => es(x.contactoId, x.nombre)).forEach(x => ev.push({fecha: x.fecha || '', tipo: 'cobro', desc: x.notas || '', cobroId: x.id}));
  ev.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  return {
    contacto: c,
    compras: {n: compras.length, total: sum(compras, 'buyPrice')},
    ventas: {n: ventas.length, total: sum(ventas, 'sellPrice'), ganancia: sum(ventas.map(i => (+i.sellPrice || 0) - costoItem(db, i)))},
    debe: sum(cobros, 'pend'),
    ultimo: ev[0] || null
  };
}

if(typeof module !== 'undefined') module.exports = {dbAlCorte, patrimonio, rendimiento, COLS, emptyDB, mergeDB, L, sum, ymd, today, shiftDate, daysBetween, MESES, fmt, full, fd, monthLabel, extractMonto, parseMoney, parseNoti, balances, cobroPagado, cobrosPend, monthStats, summaryText, remindersText,
  SEED_BOLSILLOS, SEED_FONDOS, ensureSeeds, fondoDe, balancesFondos, fondosOrdenados, fondosLinea,
  normModelo, normNombre, costoItem, itemHistory, priceRef, topesEstado, monthInsight, contactoStats};
