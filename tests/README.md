# Pruebas de Mi App v2

Todo es `node:test` + `node:assert/strict`, **sin dependencias** (excepto el e2e con jsdom, que se salta solo si no está instalado).
Node ≥ 22. La suite fija `TZ=America/Bogota` y "hoy = 2026-10-05 10:00 a. m." (ver `helpers/clock.js`), así que da lo mismo en tu PC, en CI o en UTC.

## Cómo correr

```bash
node --test 'tests/**/*.test.js'              # TODO (con comillas; es el comando recomendado)
node --test tests/                            # lo mismo, por el shim tests/index.js (Node 22 no acepta carpetas sin index.js)
node --test tests/core.test.js                # un archivo
node --test --test-reporter=spec tests/quick.test.js   # salida legible, caso por caso
```

Estado al cerrar la FASE 1: en verde core, props, demo-db, nequi-samples y el harness e2e. Fallan a propósito, como señal para otros:
11 casos de `quick.test.js` (SPEC §10.2 aún sin implementar en `app/quick.js`: "pesos", relleno solo en bordes del nombre, "pagué préstamo" = gasto)
y 1 de `static.test.js` (`dist/apps-script/Code.gs` quedó viejo tras integrar `parseNoti`: hay que volver a correr `node server/build.js`).
Las 8 pruebas `todo` se imprimen con ✖ y `# TODO` pero **no hacen fallar la corrida**; solo importa la línea `# fail`.

Variables de entorno útiles:

| variable | para qué |
|---|---|
| `CORE_PATH=/ruta/core.orig.js` | corre la MISMA suite contra otro `core.js` (así se demostró que cada prueba detecta su bug: 49 fallos contra el core original, 0 contra el actual) |
| `QUICK_PATH=tests/fixtures/quick.reference.js` | corre `quick.test.js` contra otro `quick.js`. La referencia (escrita por QA, NO es el producto) pasa las 194 pruebas: prueba que son cumplibles |
| `APP_DIR_E2E=/otra/app` | apunta `e2e/smoke.test.js` a otra copia de la app |
| `JSDOM_DIR=/ruta/node_modules` | dónde está jsdom (ver "FASE 2") |

## Qué hay

| archivo | qué prueba |
|---|---|
| `core.test.js` | `app/core.js` (SPEC §4): API, mergeDB, balances con todos los tipos, cobros, monthStats, fechas, fmt, extractMonto/parseMoney, parseNoti, summaryText/remindersText |
| `core.props.test.js` | propiedades con semilla fija: leyes del merge (conmutativo/idempotente/asociativo), 3 dispositivos + servidor, balances vs un libro mayor independiente (`helpers/oracle.js`), fechas |
| `demo-db.test.js` | `fixtures/demo-db.json` (3 meses, 20 productos…): coherencia, ningún saldo negativo en ningún día, textos de resumen/recordatorios exactos |
| `nequi-samples.test.js` | `parseNoti` contra `docs/nequi-samples.json` (35 muestras INFERIDAS; cuando haya textos reales, agrégalos con `"fuente":"real"`) |
| `quick.test.js` | `app/quick.js` (SPEC §6.3 + §10.2): 8 casos obligatorios, gramática, relleno, bolsillos, montos, tildes/mayúsculas, palabras completas, robustez, propiedades. Se salta solo si `app/quick.js` no existe |
| `static.test.js` | `node --check` de todo el JS, nada de `toISOString()` para fechas, `manifest.json`, `sw.js`, `index.html`, `server.gs`/`dist`. Cada bloque se salta si su archivo no existe |
| `e2e/` | harness jsdom para la FASE 2 (abajo) |

Un caso que falla en `quick.test.js` es **señal para el Frontend**, no se salta ni se marca `todo` (decisión del lead).
Un `todo` es "decisión pendiente" y está listado, con recomendación, en `REPORTE-QA.md`.

Documentos: `REPORTE-QA.md` (qué se probó, bugs, riesgos, decisiones pendientes) y `CAMBIOS-core.md` (cada arreglo a `core.js`: antes / después / por qué / qué prueba lo detecta).

## Datos de ejemplo

```bash
node tests/fixtures/make-demo.js            # regenera fixtures/demo-db.json (determinista: dos corridas dan el mismo archivo)
node tests/fixtures/make-demo.js --check    # falla si el JSON del repo no coincide con lo que genera el script
node tests/fixtures/make-demo.js --stdout   # lo imprime
```

`demo-db.json` sirve para sembrar la app en pruebas e2e o para cargarla a mano (Ajustes → Importar JSON). Saldos finales: efectivo $904.000, nequi $1.794.900; te deben $950.000.

## Ayudas (`helpers/`)

`clock.js` (TZ fija, `withNow(iso, fn)` reloj congelado síncrono, `withTZ`), `core.js` (carga core.js, respeta `CORE_PATH`),
`builders.js` (`item, sold, gasto, ingreso, cobro, abono, transfer, ajuste, pend, bolsillo, regla, makeDB`), `oracle.js` (saldos por un
método independiente), `rng.js` (PRNG con semilla), `spec.js` (constantes del SPEC copiadas a propósito para detectar desvíos).

---

## FASE 2: e2e con jsdom (`tests/e2e/`)

No hay Chromium en la máquina; jsdom corre la app real en Node. Está listo y probado con una mini app (`e2e/fixtures/mini`);
las pruebas sobre la app real **se saltan solas** hasta que existan `app/index.html`, `core.js`, `quick.js` y `app.js` (y jsdom).

### Instalar jsdom (nunca global, SPEC §9)

```bash
mkdir -p <carpeta> && cd <carpeta> && npm init -y && npm install jsdom@24
export JSDOM_DIR=<carpeta>/node_modules       # o instálalo en miapp/ (miapp/node_modules se busca solo)
```
En la FASE 1 quedó instalado en `/tmp/claude-0/-home-claude/06e1c601-47b9-59d5-b935-12c557c2f42b/scratchpad/qa/e2e-deps/node_modules` (último lugar donde `e2e/jsdom-loader.js` busca). Si no encuentra jsdom, las pruebas e2e se saltan con el motivo.

### Piezas

| archivo | qué hace |
|---|---|
| `e2e/harness.js` | `bootApp(opts)`: carga `index.html` y ejecuta sus `<script>` **en orden** (core → quick → app) en una ventana jsdom con origen `https://usuario.github.io/miapp/`; los scripts remotos (Chart.js del CDN) no se descargan; un script que lanza se registra en `app.errors` y se sigue, como un navegador |
| `e2e/fake-clock.js` | reloj falso: `setTimeout/setInterval/Date/requestAnimationFrame`. `await app.advance(1500)` ejecuta el debounce de sync al instante |
| `e2e/fake-server.js` | Apps Script falso (ping, sync, capture, summary, reminders) sobre el MISMO `core.js`; CORS realista (un POST con `Content-Type: application/json` o cabeceras propias se rechaza como haría Chrome), sin conexión, fallos programados (`failNext(n, modo)` con modo = network / http500 / busy / badjson), `server.capture(texto)` simula a MacroDroid |
| `e2e/stubs.js` | Chart, `webkitSpeechRecognition` (`speech.say(...)`, `speech.fail('not-allowed')`), `navigator.serviceWorker`, portapapeles, `alert/confirm/prompt` (se contestan desde la prueba), `window.open` (WhatsApp), descargas `<a download>` (`downloads.lastText()`), `online/offline`, `visibilitychange`, errores y `console.error` |
| `e2e/harness.selftest.test.js`, `e2e/fake-server.test.js` | prueban el propio harness y el servidor falso (17 + 8 pruebas) |
| `e2e/smoke.test.js` | esqueleto sobre la app real: orden y rutas de los scripts, Inicio muestra Caja/Te deben de la base demo, offline-first, sync al abrir con POST `text/plain` sin preflight, SW con ruta relativa, arranque sin Chart.js ni dictado, onboarding §10.3 |

### Ejemplo de prueba e2e

```js
const { bootApp, e2eSkipReason } = require('./harness');
const { createFakeServer } = require('./fake-server');
const demo = require('../fixtures/demo-db.json');

describe('registrar un gasto', { skip: e2eSkipReason() }, () => {
  test('queda en localStorage y sincroniza 1,5 s después', async () => {
    const server = createFakeServer({ key: 'K' });
    const app = await bootApp({ db: demo, cfg: { url: 'https://script.google.com/macros/s/X/exec', key: 'K', onboarded: true }, server });
    server.reset();
    app.type('input[type=text]', 'almuerzo 18 mil nequi');          // selectores: ids estables o data-testid (ver abajo)
    app.click(app.byText('➤'));                                       // byText ignora tildes y mayúsculas
    app.click(app.byText('Guardar'));
    await app.advance(1500);
    assert.equal(server.callsTo('sync').length, 1);
    assert.ok(app.db.gastos.some(g => g.desc === 'Almuerzo' && g.valor === 18000));
    app.assertNoErrors();
    app.close();
  });
});
```

API de `app`: `$, $$, text(el?), byText(texto), click, type, select, check, key, submit, isHidden, fire`, `advance(ms)`, `idle(ms)`, `settle()`,
`db` / `cfg` (localStorage como objetos), `evalInPage(código)` (accede a los `const/let` globales de `app.js`), `server`, `clock`,
`speech`, `chart`, `sw`, `clipboard`, `dialogs`, `opened`, `downloads`, `navigations`, `net.setOnline(bool)`, `page.setVisible(bool)`,
`errors`, `assertNoErrors()`, `close()`. Opciones de `bootApp`: `db, cfg, storage, server, now, search ('?voz=1'), chart ('absent'), speech (false), serviceWorker (false), online (false), appDir, extraDirs`.

### Flujos que se escribirán en la FASE 2 (sobre este harness)

1. Registro rápido: texto y voz (`speech.say`) → formulario prellenado → guardar → saldos de Inicio cambian; los 8 casos del SPEC §6.3 de punta a punta.
2. Por clasificar: un `capture` del servidor falso aparece tras sincronizar; clasificar en cada uno de los botones; "Igual que antes" con regla aprendida; **no** se aprende regla con `quien` vacío (§10.4); Ignorar.
3. Venta a crédito crea el cobro; abonos hasta "¡Saldado!"; WhatsApp (`opened`/`navigations` con `wa.me/57…`); cobros vencidos/de hoy.
4. Borrado lógico (`del:1`, `u` actualizado) y sync: nunca se borra físicamente; abonos en cascada al borrar un cobro; no se elimina un bolsillo con movimientos.
5. Sync: debounce 1,5 s, cada 60 s visible, `visibilitychange`, `online`; sin solapamiento; indicador en el header; errores/clave mala/servidor ocupado.
6. Onboarding (§10.3) y respaldo (Exportar `miapp_AAAAMMDD.json`, Importar = `mergeDB`).
7. Seguridad: texto de usuario con `<img src=x onerror=…>` en descripción/nombre no ejecuta ni inyecta HTML.
8. Fechas locales a las 10:30 p. m. (`now:'2026-10-05T22:30:00-05:00'`), móvil 360 px (sin desbordes horizontales en lo que jsdom puede medir), Chart ausente.

**Pedido al Frontend** para poder escribirlas: `id` estables o `data-testid` en barra de registro, botones de tabs, tarjetas de Por clasificar, formulario modal (campos y Guardar) y toasts; scripts clásicos (sin módulos ni `await` de nivel superior); proteger `Chart`, `webkitSpeechRecognition` y `navigator.serviceWorker` con `typeof`/`in`.

---

## Navegador real: Chromium + Apps Script simulado (`tests/e2e/browser.test.js`)

La app real (HTTPS, subruta `/miapp/`, service worker, Chart.js) hablando con `dist/apps-script/Code.gs` ejecutado de verdad (vm + mocks de `server/test/env.js`).
Dos celulares = dos contextos de navegador (390x844, móvil, es-CO, hora de Bogotá). ~50 s.

```bash
# una sola vez, nunca global (el Chromium ya está en /opt/pw-browsers: NO correr `playwright install`)
mkdir -p <carpeta> && cd <carpeta> && npm init -y && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright@1.56.1 chart.js@4.4.0
export PLAYWRIGHT_DIR=<carpeta>/node_modules          # (en la FASE 2 quedó en el scratchpad de QA, que se busca solo)

node --test --test-reporter=spec tests/e2e/browser.test.js
HEADED=1 SLOWMO=250 node --test tests/e2e/browser.test.js    # verlo en pantalla (si hay display)
node tests/e2e/server-mock.js                                # solo el servidor: imprime URL de la app, /exec y clave para probar a mano
```

| archivo | qué es |
|---|---|
| `e2e/server-mock.js` | `startMock()`: "script.google.com" (`/exec` con 302 a otro origen "googleusercontent", CORS solo en la respuesta, OPTIONS rechazado como Apps Script), "GitHub Pages" (`/miapp/`, 404 fuera), "CDN" (Chart.js real si está instalado) y certificado propio. `failNext(n,'network'|'http500'|'html'|'busy'|'badjson')`, `capture()` (MacroDroid), `callExec()`, `stats` (preflights, maxConcurrentSync…), `calls('sync')`, `db()` |
| `e2e/pw-harness.js` | `Phone`: un celular (errores de consola/pageerror/requestfailed, diálogos, `form()`, `quick()`, `syncNow()`, `shot()`…) |
| `e2e/browser.test.js` | UNA historia en pasos A1…G4 (cada paso depende de otros; si uno falla los dependientes se saltan con el motivo) |
| `e2e/shots/` | capturas de cada pantalla (se reescriben en cada corrida) |

Cubre: bienvenida/saldos, conectar nube (ping, sync text/plain sin preflight, enlaces MacroDroid + Copiar), registro rápido, Por clasificar + regla "Igual que antes", venta, segundo celular que "ya la usa" (sin pedir saldos), cambios y borrados entre celulares (tombstones), capture POST de Nequi con varios Content-Type, summary/reminders, sin señal (service worker, cola, evento `online`), errores del servidor, clave mala, HTML/emojis/fórmulas, respaldo, atajos, dictado (reconocedor simulado), 22:30 p. m. local, fiado + WhatsApp + abonos + borrado en cascada, bolsillos, edición simultánea, Atrás de Android, base de ~200 KB, CDN caído, recorrido de pantallas (sin desborde, objetivos >= 44 px) y convergencia final. Validado con mutaciones de la app (9 de 9 detectadas).
Se salta solo si falta playwright, Chromium, openssl, la app o `dist/apps-script/Code.gs`.
