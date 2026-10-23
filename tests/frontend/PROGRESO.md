# Progreso FRONTEND (ronda 2) — TERMINADO
- [x] quick.js: §10.2 (pesos/pesitos relleno, relleno solo en bordes del nombre, "pagué (el) préstamo" = gasto, `__proto__`) → tests/quick.test.js 194/194
- [x] manifest.json + sw.js + iconos (192, 512, maskable 512), todo con rutas relativas
- [x] index.html (CSS + esqueleto, ids estables y data-testid)
- [x] app.js: estado/almacenamiento/sync · 5 pantallas · motor de formularios · registro rápido/voz · ajustes/respaldo · bienvenida §10.3
- [x] pruebas: tests/frontend/quick.test.js (15) + tests/frontend/smoke.test.js (jsdom, 12 flujos) + tests/e2e/smoke.test.js de QA en verde
- [x] revisión visual en Chromium headless (Playwright de /opt/pw-browsers) a 380 px: sin desborde horizontal, sin errores de JS

Único rojo de la suite: `static.test.js` → dist/apps-script/Code.gs desactualizado (BACKEND/LEAD: `node server/build.js`).

# Ronda 3 (SPEC §11) — TERMINADO
- [x] quick.js: guessCat celulares (§11.3), parseQuickMulti (§11.1), montos cortos (§11.2), parte de pago
- [x] app.js: venta con parte de pago (§11.5) + movimientos/editar/borrar coherentes
- [x] app.js: hoja "Esto entendí" (§11.4) + Guardar todo + Deshacer del lote
- [x] pruebas: multi.test.js (40) + smoke del lote (3 flujos) · captura tests/e2e/shots/32-lote.png revisada · sw miapp-v2.1.0
- Suite completa: 851 en verde (807 previas + 44 nuevas).

# Ronda 3b — variantes naturales — TERMINADO
- [x] Parte de pago con cualquier forma de "recibir" (me dio/dieron/dejó/dejaron/entregó/pasó, recibí, me lo pagaron con, más, +) y "de/en/por/valorado/avaluado (en)" N.
- [x] Se parte también cuando AMBOS lados tienen monto, el izquierdo es gasto/compra y el derecho NO empieza por número; el bolsillo del final vale para los que no dijeron el suyo.
- [x] "c/u" / "cada uno": total = cantidad × precio por unidad (nota "2 × $150.000 c/u").
- [x] guessCat: un número solo de 11 a 17 ("el 14", "un 12") = Celulares.
- [x] multi.test.js: 59 casos. Suite: 870 en verde.
- Captura: tests/e2e/shots/32-lote.png (browser.test.js borra esa carpeta en cada corrida → copia fija en tests/frontend/shots/32-lote.png).
- [x] Ronda 3c: bolsillo del final solo entre segmentos sin verbo y del mismo tipo; '11'..'17' solo = iPhone N. multi.test.js 62.
