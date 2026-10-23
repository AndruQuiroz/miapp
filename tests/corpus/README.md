# Corpus de frases del registro rápido (SPEC §12.1)

Frases reales de cómo escribe o dicta Andru (Medellín, compra-venta de celulares, consolas, tenis, motos; plata en Nequi y efectivo).
Sirven para medir `parseQuickMulti` de `app/quick.js`.

```bash
node tests/corpus/score.js tests/corpus/frases.json            # % de frases, % por campo y % por grupo
node tests/corpus/score.js tests/corpus/frases.json --fallos   # + cada fallo: esperado vs obtenido
node tests/corpus/score.js tests/corpus/frases.json --grupo=venta
node --test tests/corpus/corpus.test.js                        # falla si el % baja del umbral
```

`score.js` es una medición (siempre sale con código 0). Congela "hoy" en **2026-10-06 (martes), America/Bogota**.
`corpus.test.js` exige `% de frases.json ≥ umbral.json → global` `% de frases2.json ≥ → frases2` y `% de frases3.json ≥ → frases3`. **Frontend: cuando mejores el parser, sube el umbral** (nunca lo bajes).

## Archivos
| archivo | qué es |
|---|---|
| `frases.json` | casos de entrenamiento (array). Un caso por línea |
| `frases2.json` | 2º lote de entrenamiento (226 casos, ids `d…`) para los grupos más débiles: fondo, multi, ingreso, gastos, compra, ruido. Mismos criterios |
| `frases3.json` | 3er lote (294 casos, ids `e…`): validación ciega de TODOS los grupos con formas nuevas (otros verbos y jerga, monto o bolsillo al inicio, fecha al final, notas de voz, errores de dictado, abreviaturas). Mismos criterios |
| `ctx-base.json` | contexto `"base"`: bolsillos con `alias` (efectivo, nequi, nequi_pareja — §13.2), `fondos` (negocio, personal, arriendo, ahorro), 14 productos en stock (`id`, `desc`, `cat`), 6 cobros pendientes |
| `score.js` | medidor; como módulo exporta `scoreFile(ruta)` |
| `umbral.json` | % mínimos para `corpus.test.js` (`global` = frases.json, `frases2`, `frases3`) |

Un archivo de casos también puede ser `{"contextos": {"nombre": {...}}, "casos": [...]}`; `ctx:"nombre"` se busca ahí, luego en `ctx-nombre.json` junto al archivo y en esta carpeta.

## Formato de un caso
```json
{"id":"c0001","texto":"vendí el 15 pro en 3.2 nequi","grupo":"venta","ctx":"base",
 "esperado":[{"kind":"venta","monto":3200000,"bolsillo":"nequi","cat":null,"tipo":null,"desc":null,"tradeIn":null,"fecha":null,"ref":"i15p"}]}
```
- `null` = no se evalúa. Solo cuentan los campos no-null. `"__vacio"` = el parser DEBE dejar ese campo vacío (`undefined`, `''`, `0`; en `cat` también vale `'Otro'`).
- `esperado` se compara por posición con el array devuelto; el nº de operaciones debe coincidir.
- `monto` → `buyPrice` / `sellPrice` / `valor` / `total` / `monto` según el tipo. `bolsillo` → `buyPocket` / `sellPocket` / `bolsillo`. `fecha` → `buyDate` / `sellDate` / `fecha`.
- `desc` = palabra(s) que deben aparecer como palabra completa (sin tildes ni mayúsculas) en: `desc` (compra, gasto, ingreso, venta nueva), la `desc` del producto de stock elegido (venta), `nombre` (cobro), o el nombre del cobro elegido (abono).
- `tradeIn` = `{desc, valor}`: `desc` contenida, `valor` exacto (`"__vacio"` = no adivinar el valor).
- `fondo` = id del apartado en `d.fondo` (§13.3). Si la frase no nombra apartado, `fondo` es `null` (no se evalúa: lo resuelve `fondoDe`).
- Campos extra (opcionales): `ref` = `itemId` en venta (id de stock, `"__nuevo"`, `"__prev"`) o `cobroId` en abono; `from`/`to` = ids de bolsillo en `transfer` e ids de apartado en `reparto` (kind nuevo: `{from, to, monto, fecha}`; `bolsillo` no aplica); `pagado` = `sellPaid` en venta (si no hay `sellPaid` y no es a crédito, cuenta como `sellPrice`).

## Criterios de negocio usados en los valores esperados
1. **Números sueltos sin unidad**: < 100 en Celulares/Consolas/Computadores/Moto (o con producto de stock caro) = millones (§11.2); 100–999 = **miles** en cualquier producto o gasto ("en 850", "almuerzo 18", "pauta 50", "le presté 100"); ≥ 1000 = pesos ("tinto 2500").
2. Jerga: luca/barra = mil · palo/melón/melo = millón · "medio palo" = 500 mil · "un palo doscientos" = 1.200.000 · "1'600.000" = 1.600.000 · "1 punto 8 / 1 coma 5 millones" = 1,8M / 1,5M · "mil cien" en celular = 1.100.000.
3. **Venta de algo del stock**: "el 15", "la play", "el portátil" (único computador), "el reloj" (único reloj), "los jordan" → ese id. Si hay varios candidatos ("el iphone", "los tenis") → `ref:"__vacio"` (que lo elija el usuario).
4. **Crédito**: `monto` = precio total; `pagado` = lo que entró ("me dio la mitad" = 50%; "fiado", "a crédito", "me lo paga el viernes" = 0; "me quedó debiendo 400" = total − 400).
5. **Parte de pago** (§11.5): `monto` = solo la PLATA ("vendí el 16 en 4.2, recibí un 13 de 1.4 y 2.8 en plata" → 2.8M); si no dicen cuánto vale lo recibido, `tradeIn.valor` vacío.
6. "compré mercado/almuerzo/gasolina/cajas" = **gasto**, no compra de inventario. "unos tenis pa mí / a mi novia" = gasto personal.
7. Bolsillo: "transferencia", "me consignó", "me transfirió", "me hizo un nequi" → nequi (único digital). "me pasó" sin medio → vacío. Préstamo sin medio → no se evalúa. "me debe" / fiado → `''` (no salió plata).
8. "me prestaron" = **ingreso** (no cobro). "le pasé 200 prestados" = cobro. "consigné/metí/cargué la nequi" = transfer efectivo→nequi; "saqué/retiré" = nequi→efectivo.
9. Gasto de negocio también: arreglo/mantenimiento de un producto para venderlo, "domicilio pa entregar…", "picap pa llevar un pedido". "domicilio de hamburguesa" = Comida personal.
10. Fechas: "el lunes" = el más reciente ya pasado (hoy martes 6 → lunes 5); "el 28" (mayor que hoy) = mes anterior; "el sábado pasado" = sábado 3; "anoche" = ayer. "el 15" tras "vendí" es un iPhone 15, no una fecha.
11. Bolsillo por alias (§13.2), gana el más largo: "nequi" a secas / "mi nequi" / "el nequi mío" = `nequi`; "el nequi de mi novia/esposa/pareja", "de su nequi" (dicho de la pareja), "lo pagó mi novia por nequi" = `nequi_pareja`. Pero "con mi novia", "a mi novia", "la pareja de Santiago" son personas, no bolsillos → bolsillo vacío.
12. Reparto (§13.3): sin origen dicho sale de `personal` ("aparté 300 pal arriendo", "metí 2M al negocio"); "ganancia", "me pagué … del negocio", "a lo personal" = `negocio→personal`; "saqué/tomé X del ahorro" = `ahorro→personal`. Sin destino ("aparté 300") → `to` vacío. "saqué/retiré/moví/metí" con un APARTADO es reparto; con un bolsillo o el cajero sigue siendo transfer. Los transfers no llevan fondo.
13. Fondo explícito: "con la plata del arriendo", "del chanchito", "de mi plata", "con capital del negocio", "eso va pal negocio". "pagué la renta" es el gasto (Servicios), no un apartado.
