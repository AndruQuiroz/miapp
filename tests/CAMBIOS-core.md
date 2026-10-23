# Cambios de QA en `app/core.js`

Regla: solo BUGS, sin cambiar nombres, firmas ni la semántica del modelo de datos (SPEC §9). Cada cambio dice
antes / después / por qué y qué prueba lo detecta. El respaldo del core original está en el scratchpad de QA
(`.../scratchpad/qa/core.orig.js`); el diff reproducible es `diff -u core.orig.js app/core.js`.

Comprobación "la prueba detecta el bug": `CORE_PATH=/ruta/core.orig.js node --test tests/core.test.js tests/core.props.test.js tests/nequi-samples.test.js tests/demo-db.test.js`
da **49 fallos** contra el core original y **0** contra el actual.

---

## 1. `module.exports` incompleto
- **Antes:** exportaba `COLS, emptyDB, mergeDB, L, sum, today, shiftDate, daysBetween, fmt, full, fd, extractMonto, parseMoney, parseNoti, balances, cobroPagado, cobrosPend, monthStats, summaryText, remindersText`.
- **Después:** además `ymd, MESES, monthLabel`.
- **Por qué:** SPEC §4 lista `MESES` y `monthLabel` como API de core.js y en Node (`require`) no existían (en el navegador sí, por ser globales). `ymd` lo usa `today()` y conviene para el servidor/tests. No cambia ningún nombre existente.
- **Prueba:** `core.test.js` › "API y carga de core.js" › "require() exporta todos los nombres que lista el SPEC §4".

## 2. `mergeDB`: el empate de `u` dependía del orden de los argumentos
- **Antes:** `if(!p || (r.u || 0) > (p.u || 0)) m.set(r.id, r)` → con el mismo `u` ganaba siempre el primero que se vio (`mergeDB(a,b) ≠ mergeDB(b,a)`), y un borrado (`del:1`) con el mismo `u` que una edición podía perder → según el dispositivo, el registro "resucitaba" o no y los dispositivos no convergían.
- **Después:** `gana(r,p)`: mayor `u`; si empatan, gana el borrado (tombstone); si siguen empatados, el JSON mayor (determinista). Sigue siendo "gana el más nuevo por `u`" en todos los demás casos.
- **Por qué:** la sincronización multi-dispositivo exige merge conmutativo, asociativo e idempotente (si no, A y B pueden quedar con bases distintas para siempre). Ocurre de verdad: dos teléfonos/el servidor pueden estampar el mismo `Date.now()` en el mismo ms (p. ej. un lote de registros creados en el mismo tick).
- **Pruebas:** `core.test.js` › mergeDB › "empates de u…"; `core.props.test.js` › "mergeDB: leyes del merge con 500 tríos aleatorios" (conmutativo, idempotente, asociativo, simulación de 3 dispositivos + servidor).

## 3. `fmt`: `$1000K` en vez de `$1M`
- **Antes:** `if(a >= 1e6)` para pasar a millones → de 999.500 a 999.999 salía `"$1000K"` (`Math.round(a/1e3)` = 1000).
- **Después:** `if(a >= 999500)` → `"$1M"`.
- **Por qué:** formato absurdo en las tarjetas de Inicio/resumen cuando la caja anda cerca del millón.
- **Prueba:** `core.test.js` › "formato: fmt / full / fd / monthLabel" (bordes 999.499 / 999.500 / 999.999); `core.props.test.js` › "formato y montos: ida y vuelta" (forma de `fmt` en todo el rango).

## 4. `extractMonto` (5 arreglos; mismos nombres y misma forma `{monto, rest}`)
| # | Antes | Después | Por qué |
|---|---|---|---|
| 4a | La unidad (`k`, `mil`, `M`…) solo se reconocía si la seguía espacio, `.`, `,`, `!`, `?` o el fin → `"(50k)"`, `"50k;"`, `"'50k'"`, `"50k:"` daban 0. | El lookahead también admite `) ] } ; : " ' » ” ’`. | Dictado/WhatsApp pegan puntuación a la unidad. |
| 4b | `"$50k"` / `"$ 50 mil"` dejaban el `$` suelto en `rest` (la descripción quedaba "$ ..."). | Se consume el `$` opcional junto con el monto. | `rest` alimenta la descripción del registro rápido. |
| 4c | `melones?` → `"1 melón"` (con tilde, como se dicta) no se reconocía. | `mel[oó]n(?:es)?`. | Jerga colombiana de "millón". |
| 4d | Un entero suelto de 4+ cifras era plata aunque fuera un año: `"moto modelo 2024 8 millones"` podía leerse como 2024. | `pelado()`: se salta un 19xx/20xx si lo precede `modelo / mod / año / del / versión / edición`. | Descripciones de producto con año (decisión documentada en los tests; sin la palabra de contexto, `"tinto 2024"` sigue dando 2024). |
| 4e | `rest = t.replace(m[0], ' ')` quitaba la PRIMERA ocurrencia parecida, no la que dio el monto (`"1500abc 1500"` borraba la equivocada). | Se quita por posición (`m.index`). | `rest` correcto. |
- **Pruebas:** `core.test.js` › "extractMonto…" (≈55 casos con monto, 26 sin monto, bloque "años y modelos", bloque "rest"); `core.props.test.js` › "formato y montos: ida y vuelta".

## 5. `parseNoti`
- **5a (primer arreglo de QA, ahora subsumido por 5b):** `"Pago recibido por $50.000 de Juan"` daba `out` (la regex de salida `pago ` ganaba) → se agregó `recibid[oa]|acredit` a las entradas; y `quien` arrastraba fechas/horas (`"JUAN PEREZ el 05/10/2026 a las 14:32"`) → recorte `el \d`, `a las? \d`.
- **5b (SPEC §10.6): integrada la propuesta de DOCS `docs/parseNoti-propuesta.js`.** Se reemplazó la función completa (misma firma y misma salida `{monto, dir, quien}`). Condición del lead: "solo si pasa TODAS las pruebas existentes de core" → cumplida: 0 pruebas rotas (core.test.js, core.props.test.js, demo-db.test.js) y las 35 muestras de `docs/nequi-samples.json` pasan (el core anterior pasaba 22/35).
  - **Antes:** cualquier número sin `$` se tomaba como monto vía `extractMonto` (códigos OTP `482913`, código de retiro `123456` → "movimientos" fantasma); promos con `$` (`"Gana $20.000 invitando…"`) creaban pend con dir `?`; `"te pidió $30.000"` o `"pago pendiente"` se marcaban `out`; `"JUAN PEREZ te envió $50.000"` daba `quien` vacío; llaves Bre-B, celulares y bancos no se reconocían como `quien`.
  - **Después:** sin `$` solo hay monto si el texto dice COP/pesos o miles con punto/`k`/`mil`/`M`; promos sin verbo fuerte → monto 0 (el backend ya ignora monto 0); solicitudes y pagos pendientes → dir `?`; `envío/pago/retiro exitoso` reconocidos; `quien` por (a) remitente antes del verbo, (b) llave Bre-B, (c) celular, (d) regla original, (e) bancos.
  - **Pruebas:** `core.test.js` › parseNoti (incluye "promos, saldos y remitente antes del verbo"); `nequi-samples.test.js` (35 muestras, todas pruebas normales).
- **5c (agregado por QA sobre la propuesta):** un aviso de SALDO (`"Tu saldo en Nequi es $1.234.567"`) crea un pend fantasma con dir `?`. Se agregó una línea: si dice `saldo` y NO hay ningún verbo de movimiento (fuerte, débil ni pendiente) → monto 0. Un movimiento que menciona el saldo se respeta y toma el monto del movimiento (`"Recibiste $50.000 de JUAN. Tu saldo ahora es $170.000"` → 50.000).
  - **Prueba:** `core.test.js` › "aviso de SALDO…" y "pero un movimiento que menciona el saldo SÍ cuenta…".
- **Decisión pendiente (no tocado):** `"Recargaste $5.000 a tu celular Claro"` sigue dando `in` (toda "recarga" es entrada). Ver REPORTE-QA.md.

## 6. `monthStats`: clave `"👤 undefined"` en `cats`
- **Antes:** `(x.tipo === 'negocio' ? '🏢 ' : '👤 ') + x.cat` → un gasto sin `cat` generaba la clave `"👤 undefined"`.
- **Después:** `+ (x.cat || 'Otro')`.
- **Por qué:** el gráfico "gastos por categoría" mostraría "undefined" (datos importados o capturas sin categoría).
- **Prueba:** `core.test.js` › monthStats › "un gasto sin cat no produce la clave "undefined" (usa "Otro")".

---

## Lo que NO se cambió a propósito (decisiones de producto: se reportan, ver REPORTE-QA.md)
`parseMoney('1.5')` = 15 y `parseMoney('1,200')` = 1 (el punto es separador de miles en Colombia); números en letras ("cincuenta mil"); `"2 mil 500"`; `"50 000"`; un año sin palabra de contexto antes del precio; una `m` suelta = millones (choca con tallas); abonos huérfanos cuentan en saldos; bolsillo borrado con movimientos reaparece sin su `ini`; `today()` en el celular es la hora del teléfono (no Bogotá); `daysBetween` recorta negativos a 0.

---

## Ronda 4b (BACKEND, SPEC §13) — solo AGREGA; balances/monthStats/mergeDB sin cambios
- `COLS` += `fondos`, `repartos`. `emptyDB()` trae `nequi_pareja` y alias en los bolsillos semilla, y los apartados `negocio`/`personal` (u:1).
- Nuevo: `SEED_BOLSILLOS`, `SEED_FONDOS`, `ensureSeeds(db)`, `fondoDe(col, rec, db)`, `balancesFondos(db)`, `fondosOrdenados(db)`, `fondosLinea(db)` (y el interno `fondoResolver(db)`).
- `summaryText`: línea de apartados tras la de caja. `remindersText`: aviso 🧮 al final si hace 15+ días no hay ajuste (sin ajustes: cuenta desde el primer movimiento, para no regañar a un usuario nuevo).
- Transfer "cojo" (sin from o sin to) mueve plata en `balances`; en `balancesFondos` esa plata va a `personal` para que el invariante se cumpla siempre.
- Pruebas: `tests/core.fondos.test.js` (invariante con 3.000 bases aleatorias + oráculo independiente). Tests viejos ajustados a las semillas nuevas: `core.test.js`, `demo-db.test.js`, `helpers/builders.js` (makeDB sigue con solo efectivo/nequi), `e2e/browser.test.js` (ignora la semilla Nequi pareja en $0 en comparaciones exactas).

## Ronda 5 (BACKEND, SPEC §14) — solo AGREGA
- `COLS` += `contactos`, `topes`. Nuevas: `normNombre`, `normModelo`, `costoItem`, `itemHistory`, `priceRef`, `topesEstado`, `monthInsight`, `contactoStats` (+ internos `nombreContacto`, `statsHasta`, `nombreTope`, `redondear10k`).
- `remindersText`: avisos de topes (⚠️ cerca ≥80 % / 🚨 pasado) antes del 🧮. `summaryText`: línea de `monthInsight` al final.
- Tests: `tests/core.r5.test.js`; ajustados `core.test.js` (COLS 14, línea del insight) y `demo-db.test.js` (insight del demo).
