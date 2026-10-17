/* ═══════════════════════════════════════════════
   asistente.js — "💬 Háblale a tu app": corrige, borra, cuadra y responde preguntas de tus cuentas.
   Regla de oro (anti-alucinación):
   · La IA NO ve ni toca la base. Solo pide HERRAMIENTAS de lectura que la app ejecuta (buscar, totales,
     saldos, repetidos, mes) y PROPONE cambios de una lista cerrada (borrar, editar, cuadrar, crear).
   · Los números los calcula la app; la IA solo los redacta.
   · Solo puede tocar ids que la app le mostró en esta conversación; campos y valores se validan.
   · Nada se aplica sin que el usuario vea la lista exacta y toque "Aplicar" (y queda Deshacer).
   Puro y testeable: la llamada a la IA se inyecta (o.llamar).
═══════════════════════════════════════════════ */

const AS_COLS = {
  gastos: {nombre: 'gasto', campos: {desc: 'txt', valor: 'monto', cat: 'gcat', tipo: 'tipo', bolsillo: 'bol', fecha: 'fecha'}},
  ingresos: {nombre: 'ingreso', campos: {desc: 'txt', valor: 'monto', bolsillo: 'bol', fecha: 'fecha'}},
  items: {nombre: 'producto', campos: {desc: 'txt', cat: 'pcat', buyPrice: 'monto', buyDate: 'fecha', buyPocket: 'bol0', sellPrice: 'monto', sellDate: 'fecha', sellPocket: 'bol', targetPrice: 'monto', notes: 'txt', cliente: 'txt', proveedor: 'txt'}},
  cobros: {nombre: 'cobro', campos: {nombre: 'txt', total: 'monto', fecha: 'fecha', compromiso: 'fecha', notas: 'txt'}},
  abonos: {nombre: 'abono', campos: {monto: 'monto', fecha: 'fecha', bolsillo: 'bol'}},
  transfers: {nombre: 'movimiento entre bolsillos', campos: {from: 'bol', to: 'bol', monto: 'monto', fecha: 'fecha'}},
  ajustes: {nombre: 'ajuste de saldo', campos: {nota: 'txt'}},
  pend: {nombre: 'por clasificar', campos: {}}
};
const AS_MAX_RONDAS = 4, AS_MAX_RES = 40;
const asNorm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const asL = (db, c) => (db[c] || []).filter(x => x && !x.del);
const asFecha = r => r.fecha || r.buyDate || '';
const asPlata = n => (typeof full === 'function' ? full(n) : '$' + Math.round(+n || 0).toLocaleString('es-CO'));
const asBolNom = (ctx, id) => { const b = (ctx.bolsillos || []).find(x => x.id === id); return b ? b.nombre : (id || '—'); };

/* registro → forma compacta que ve la IA (con su id) */
function asCompacto(db, col, r){
  const o = {id: r.id};
  switch(col){
    case 'gastos': Object.assign(o, {fecha: r.fecha, desc: r.desc, valor: r.valor, cat: r.cat, tipo: r.tipo, bolsillo: r.bolsillo}); break;
    case 'ingresos': Object.assign(o, {fecha: r.fecha, desc: r.desc, valor: r.valor, bolsillo: r.bolsillo}); break;
    case 'items': Object.assign(o, {desc: r.desc, cat: r.cat, estado: r.status === 'sold' ? 'vendido' : 'en stock', buyPrice: r.buyPrice, buyDate: r.buyDate, buyPocket: r.buyPocket,
      sellPrice: r.sellPrice, sellDate: r.sellDate, sellPocket: r.sellPocket, cliente: r.cliente, proveedor: r.proveedor}); break;
    case 'cobros': { const p = typeof cobrosPend === 'function' ? (cobrosPend(db).find(c => c.id === r.id) || {}) : {}; Object.assign(o, {nombre: r.nombre, total: r.total, debe: p.pend != null ? p.pend : undefined, fecha: r.fecha, compromiso: r.compromiso}); break; }
    case 'abonos': { const c = asL(db, 'cobros').find(x => x.id === r.cobroId); Object.assign(o, {fecha: r.fecha, de: c ? c.nombre : '?', monto: r.monto, bolsillo: r.bolsillo}); break; }
    case 'transfers': Object.assign(o, {fecha: r.fecha, from: r.from, to: r.to, monto: r.monto}); break;
    case 'ajustes': Object.assign(o, {fecha: r.fecha, bolsillo: r.bolsillo, delta: r.delta, nota: r.nota}); break;
    case 'pend': Object.assign(o, {fecha: r.fecha, quien: r.quien, monto: r.monto, dir: r.dir, bolsillo: r.bolsillo}); break;
  }
  Object.keys(o).forEach(k => { if(o[k] === undefined || o[k] === '' || o[k] === null) delete o[k]; });
  return o;
}
const asMonto = (col, r) => +(col === 'gastos' || col === 'ingresos' ? r.valor : col === 'items' ? (r.status === 'sold' ? r.sellPrice : r.buyPrice) : col === 'cobros' ? r.total : col === 'ajustes' ? r.delta : r.monto) || 0;
const asTexto = (col, r) => [r.desc, r.nombre, r.quien, r.cat, r.cliente, r.proveedor, r.nota, r.notes, r.raw].filter(Boolean).join(' ');

function asFiltrar(db, col, a){
  a = a || {};
  let rs = asL(db, col);
  const fechaDe = r => col === 'items' ? (a.vendidos || r.status === 'sold' && a.campoFecha === 'venta' ? r.sellDate : r.buyDate) : r.fecha;
  if(col === 'items' && a.estado) rs = rs.filter(r => a.estado === 'vendido' ? r.status === 'sold' : r.status !== 'sold');
  if(a.desde) rs = rs.filter(r => String(fechaDe(r) || '') >= a.desde);
  if(a.hasta) rs = rs.filter(r => String(fechaDe(r) || '') <= a.hasta);
  if(a.texto){ const ws = asNorm(a.texto).split(' ').filter(Boolean); rs = rs.filter(r => { const t = ' ' + asNorm(asTexto(col, r)) + ' '; return ws.every(w => t.includes(w)); }); }
  if(a.monto != null) rs = rs.filter(r => Math.abs(asMonto(col, r)) === Math.round(+a.monto));
  if(a.montoMin != null) rs = rs.filter(r => Math.abs(asMonto(col, r)) >= +a.montoMin);
  if(a.montoMax != null) rs = rs.filter(r => Math.abs(asMonto(col, r)) <= +a.montoMax);
  if(a.bolsillo) rs = rs.filter(r => [r.bolsillo, r.buyPocket, r.sellPocket, r.from, r.to].includes(a.bolsillo));
  if(a.cat) rs = rs.filter(r => asNorm(r.cat) === asNorm(a.cat));
  if(a.tipo) rs = rs.filter(r => r.tipo === a.tipo);
  return rs.sort((x, y) => String(fechaDe(y) || '').localeCompare(String(fechaDe(x) || '')));
}

/* ── herramientas de LECTURA (las ejecuta la app; devuelven datos reales) ── */
function asHerramienta(db, call, ctx, vistos){
  const fn = call && call.fn, a = (call && call.args) || {};
  const ver = (col, rs) => rs.map(r => { vistos.add(col + ':' + r.id); return asCompacto(db, col, r); });
  try {
    switch(fn){
      case 'buscar': {
        if(!AS_COLS[a.col]) return {error: 'col debe ser una de ' + Object.keys(AS_COLS).join(', ')};
        const rs = asFiltrar(db, a.col, a), lim = Math.min(+a.limite || 25, AS_MAX_RES);
        return {col: a.col, total_encontrados: rs.length, mostrando: Math.min(rs.length, lim), registros: ver(a.col, rs.slice(0, lim))};
      }
      case 'totales': {
        const col = a.col === 'ventas' || a.col === 'compras' ? 'items' : a.col;
        if(!['gastos', 'ingresos', 'items', 'abonos', 'transfers'].includes(col)) return {error: 'col: gastos, ingresos, ventas, compras, abonos o transfers'};
        const args = Object.assign({}, a, a.col === 'ventas' ? {estado: 'vendido', vendidos: true} : {});
        const rs = asFiltrar(db, col, args);
        const valor = r => a.col === 'ventas' ? +r.sellPrice || 0 : a.col === 'compras' ? +r.buyPrice || 0 : asMonto(col, r);
        const out = {col: a.col, cantidad: rs.length, total: rs.reduce((s, r) => s + valor(r), 0)};
        if(a.col === 'ventas'){
          const costo = rs.reduce((s, r) => s + (typeof costoItem === 'function' ? costoItem(db, r) : +r.buyPrice || 0), 0);
          Object.assign(out, {costo, ganancia: out.total - costo});
        }
        if(a.agrupar){
          const g = {};
          rs.forEach(r => { const k = a.agrupar === 'dia' ? asFecha(r) : a.agrupar === 'mes' ? String(asFecha(r)).slice(0, 7) : a.agrupar === 'bolsillo' ? asBolNom(ctx, r.bolsillo) : (r[a.agrupar] || 'Otro'); g[k] = (g[k] || 0) + valor(r); });
          out.por = g;
        }
        return out;
      }
      case 'saldos': {
        const b = typeof balances === 'function' ? balances(db) : {};
        const out = {bolsillos: {}};
        (ctx.bolsillos || []).forEach(p => { out.bolsillos[p.nombre + ' (' + p.id + ')'] = b[p.id] || 0; });
        out.total_en_bolsillos = Object.values(b).reduce((s, x) => s + (+x || 0), 0);
        if(typeof cobrosPend === 'function') out.te_deben = cobrosPend(db).reduce((s, c) => s + (+c.pend || 0), 0);
        out.stock_al_costo = asL(db, 'items').filter(i => i.status !== 'sold').reduce((s, i) => s + (+i.buyPrice || 0), 0);
        return out;
      }
      case 'mes': {
        const ym = /^\d{4}-\d{2}$/.test(a.mes || '') ? a.mes : String(ctx.hoy || '').slice(0, 7);
        const m = typeof monthStats === 'function' ? monthStats(db, ym) : null;
        if(!m) return {error: 'no disponible'};
        return {mes: ym, ventas: m.nVentas, vendido: m.ventas, costo_de_lo_vendido: m.costo, ganancia_bruta: m.bruta, gastos_negocio: m.gN, ganancia_neta: m.neta,
          gastos_personales: m.gP, compras: m.compras, otros_ingresos: m.ing, dias_promedio_en_vender: m.diasProm, gastos_por_categoria: m.cats};
      }
      case 'repetidos': {
        const col = AS_COLS[a.col] ? a.col : 'gastos';
        const rs = asFiltrar(db, col, a).slice().reverse(), grupos = [];
        rs.forEach(r => {
          const g = grupos.find(x => asMonto(col, x[0]) === asMonto(col, r) && Math.abs((new Date(asFecha(x[0]) + 'T12:00') - new Date(asFecha(r) + 'T12:00')) / 864e5) <= (+a.dias || 1)
            && (col !== 'gastos' && col !== 'ingresos' || asNorm(x[0].desc).split(' ')[0] === asNorm(r.desc).split(' ')[0]));
          if(g) g.push(r); else grupos.push([r]);
        });
        const dup = grupos.filter(g => g.length > 1).slice(0, 15);
        return {col, grupos: dup.map(g => ({registros: ver(col, g), nota: 'mismo monto y fecha cercana; normalmente se deja el primero'}))};
      }
      default: return {error: 'herramienta desconocida: ' + fn};
    }
  } catch(e){ return {error: String(e && e.message || e)}; }
}

/* ── valida un cambio propuesto; devuelve {ok, cambio con texto hecho por la APP} o {error} ── */
function asValidar(db, c, ctx, vistos){
  if(!c || typeof c !== 'object') return {error: 'cambio vacío'};
  const acc = c.accion, col = c.col;
  if(acc === 'cuadrar'){
    const b = (ctx.bolsillos || []).find(x => x.id === c.bolsillo);
    const real = Math.round(+String(c.real).replace(/[^\d-]/g, ''));
    if(!b || !isFinite(real) || String(c.real).trim() === '') return {error: 'cuadrar necesita bolsillo válido y real'};
    const actual = (typeof balances === 'function' ? balances(db)[b.id] : 0) || 0;
    if(real === actual) return {error: b.nombre + ' ya está en ' + asPlata(real)};
    return {ok: {accion: 'cuadrar', bolsillo: b.id, real, delta: real - actual, texto: `⚖️ Cuadrar ${b.nombre}: ${asPlata(actual)} → ${asPlata(real)} (${real - actual > 0 ? '+' : '−'}${asPlata(Math.abs(real - actual))})`}};
  }
  if(!AS_COLS[col]) return {error: 'colección inválida'};
  const r = asL(db, col).find(x => x.id === c.id);
  if(!r) return {error: 'no existe ' + col + ' ' + c.id};
  if(!vistos.has(col + ':' + r.id)) return {error: 'la IA no había buscado ' + c.id + ' (no lo toco sin verlo)'};
  const nom = AS_COLS[col].nombre, cuando = asFecha(r) || r.sellDate || '';
  const quien = r.desc || r.nombre || r.quien || r.nota || (col === 'transfers' ? asBolNom(ctx, r.from) + ' → ' + asBolNom(ctx, r.to) : '');
  const fd = f => /^\d{4}-\d{2}-\d{2}$/.test(f) ? f.slice(8, 10) + '/' + f.slice(5, 7) + '/' + f.slice(2, 4) : f;
  const etiqueta = `${nom} · ${quien} ${asPlata(Math.abs(asMonto(col, r)))}${cuando ? ' · ' + fd(cuando) : ''}`;
  if(acc === 'borrar') return {ok: {accion: 'borrar', col, id: r.id, texto: '🗑️ Borrar ' + etiqueta}};
  if(acc !== 'editar') return {error: 'accion debe ser borrar, editar o cuadrar'};
  const campos = c.campos || {}, permitidos = AS_COLS[col].campos, limpio = {}, partes = [];
  const bols = new Set((ctx.bolsillos || []).map(b => b.id));
  const gc = typeof GCATS !== 'undefined' ? GCATS : [], pc = typeof CATS !== 'undefined' ? CATS : [];
  for(const k of Object.keys(campos)){
    const t = permitidos[k]; let v = campos[k];
    if(!t) return {error: 'no se puede editar ' + k + ' en ' + nom};
    if(t === 'monto'){ v = Math.round(+String(v).replace(/[^\d.]/g, '')); if(!(v > 0)) return {error: k + ' debe ser un monto > 0'}; }
    else if(t === 'fecha'){ if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return {error: k + ' debe ser YYYY-MM-DD'}; }
    else if(t === 'bol' || t === 'bol0'){ if(!(bols.has(String(v)) || t === 'bol0' && v === '')) return {error: k + ': bolsillo inválido'}; v = String(v); }
    else if(t === 'gcat'){ const x = gc.find(z => asNorm(z) === asNorm(v)); if(!x) return {error: 'categoría de gasto inválida'}; v = x; }
    else if(t === 'pcat'){ const x = pc.find(z => asNorm(z) === asNorm(v)); if(!x) return {error: 'categoría de producto inválida'}; v = x; }
    else if(t === 'tipo'){ if(v !== 'negocio' && v !== 'personal') return {error: 'tipo: negocio o personal'}; }
    else { v = String(v == null ? '' : v).trim().slice(0, 80); if(!v && k !== 'notes' && k !== 'notas') return {error: k + ' vacío'}; }
    if(k === 'sellPrice' && r.status !== 'sold') return {error: 'ese producto no está vendido'};
    if(String(r[k] == null ? '' : r[k]) === String(v)) continue;
    limpio[k] = v;
    const fmtV = x => t === 'monto' ? asPlata(x) : t === 'bol' || t === 'bol0' ? asBolNom(ctx, x) : (x == null || x === '' ? '—' : String(x));
    partes.push(`${k}: ${fmtV(r[k])} → ${fmtV(v)}`);
  }
  if(!partes.length) return {error: 'no cambia nada'};
  return {ok: {accion: 'editar', col, id: r.id, campos: limpio, texto: '✏️ ' + etiqueta[0].toUpperCase() + etiqueta.slice(1) + ' — ' + partes.join(' · ')}};
}

function asPrompt(ctx){
  return `Eres el asistente de "Mi App", la app de cuentas de Andru (compra y venta de iPhones en Medellín; mezcla plata del negocio y personal). Él te habla en español paisa, a veces dictado por voz. Hoy es ${ctx.hoy}.

NO tienes los datos. Para saber algo, PIDE herramientas; la app las ejecuta y te devuelve datos reales con su "id". NUNCA inventes ids, montos ni registros: usa solo lo que te devuelvan. NUNCA hagas sumas tú: pide "totales", "saldos" o "mes".

Responde SIEMPRE un JSON con UNA de estas formas:
1) Pedir datos: {"llamar":[{"fn":"...","args":{...}}]}   (máx 4 por vez)
2) Terminar: {"responder":"texto corto para él", "cambios":[...], "crear":[...], "preguntar":"pregunta si te falta algo esencial"}  (cambios/crear/preguntar opcionales)

HERRAMIENTAS:
- buscar {col, texto?, desde?, hasta?, monto?, montoMin?, montoMax?, bolsillo?, cat?, tipo?, estado? ("vendido"|"stock", solo items), limite?}
  col: gastos | ingresos | items (productos: compra y venta) | cobros (quién le debe) | abonos | transfers (entre bolsillos) | ajustes | pend (por clasificar)
- totales {col: gastos|ingresos|ventas|compras|abonos|transfers, desde?, hasta?, texto?, cat?, bolsillo?, tipo?, agrupar?: cat|bolsillo|dia|mes}  → la app suma (ventas trae costo y ganancia)
- saldos {}  → plata en cada bolsillo, lo que le deben y el stock
- mes {mes:"YYYY-MM"}  → ventas, ganancia neta, gastos del mes
- repetidos {col, desde?, hasta?, dias?}  → grupos de posibles duplicados (mismo monto, fecha cercana)

CAMBIOS que puedes PROPONER (él los revisa y decide; nada se aplica sin su OK):
- {"accion":"borrar","col":"...","id":"..."}
- {"accion":"editar","col":"...","id":"...","campos":{...}}  campos permitidos:
  gastos: desc, valor, cat, tipo(negocio|personal), bolsillo, fecha · ingresos: desc, valor, bolsillo, fecha
  items: desc, cat, buyPrice, buyDate, buyPocket, sellPrice, sellDate, sellPocket, targetPrice, notes, cliente, proveedor
  cobros: nombre, total, fecha, compromiso · abonos: monto, fecha, bolsillo · transfers: from, to, monto, fecha
- {"accion":"cuadrar","bolsillo":"id","real":monto}  → cuando él dice cuánto tiene DE VERDAD en un bolsillo
CREAR algo nuevo (venta, gasto…): "crear":[{"frase":"vendí el 13 en 1.6 nequi"}] — la app lo abre en su pantalla de confirmar.

Reglas:
- Busca SIEMPRE antes de proponer cambios sobre registros; solo usa ids que te mostró la app.
- Si hay varios candidatos y no es obvio cuál, PREGUNTA (muéstrale las opciones en "preguntar").
- Para duplicados usa "repetidos" y propone borrar todos menos el primero de cada grupo.
- Montos en pesos enteros: "palo" = 1.000.000, "luca" = 1.000, "1.6" de un celular = 1.600.000.
- "responder": máx 3 frases, con los números que te dio la app, formato $1.600.000.
- bolsillos: ${JSON.stringify((ctx.bolsillos || []).map(b => ({id: b.id, nombre: b.nombre})))}
- categorías de gasto: ${JSON.stringify(typeof GCATS !== 'undefined' ? GCATS : [])}`;
}

function asParse(t){
  if(t && typeof t === 'object') return t;
  const s = String(t || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(s); } catch(e){ const m = s.match(/\{[\s\S]*\}/); if(m){ try { return JSON.parse(m[0]); } catch(e2){} } }
  return null;
}

/* conversación: o = {llamar(sys, usr) → texto, historial:[{yo, app}], vistos:Set} */
async function asistente(pedido, db, ctx, o){
  o = o || {};
  const vistos = o.vistos || new Set(), sys = asPrompt(ctx), pasos = [];
  const hist = (o.historial || []).slice(-6).map(h => `Él: ${h.yo}\nTú: ${h.app}`).join('\n');
  for(let ronda = 0; ronda < AS_MAX_RONDAS; ronda++){
    const usr = (hist ? 'CONVERSACIÓN ANTERIOR:\n' + hist + '\n\n' : '') + 'PEDIDO: ' + pedido +
      (pasos.length ? '\n\nRESULTADOS DE LA APP:\n' + pasos.map(p => JSON.stringify({fn: p.fn, args: p.args, resultado: p.res})).join('\n') : '') +
      (ronda === AS_MAX_RONDAS - 1 ? '\n\n(Última vuelta: responde ya con lo que tienes.)' : '');
    const j = asParse(await o.llamar(sys, usr));
    if(!j) return {respuesta: 'No te entendí bien, ¿me lo dices de otra forma?', cambios: [], rechazados: [], pasos, vistos};
    if(Array.isArray(j.llamar) && j.llamar.length && ronda < AS_MAX_RONDAS - 1){
      j.llamar.slice(0, 4).forEach(c => pasos.push({fn: c && c.fn, args: (c && c.args) || {}, res: asHerramienta(db, c, ctx, vistos)}));
      continue;
    }
    const cambios = [], rechazados = [];
    (Array.isArray(j.cambios) ? j.cambios : []).slice(0, 60).forEach(c => {
      const v = asValidar(db, c, ctx, vistos);
      if(v.ok){ if(!cambios.some(x => x.col === v.ok.col && x.id === v.ok.id && x.accion === v.ok.accion && x.accion !== 'cuadrar')) cambios.push(v.ok); }
      else rechazados.push(v.error);
    });
    const crear = (Array.isArray(j.crear) ? j.crear : []).map(x => x && String(x.frase || '').trim()).filter(Boolean).slice(0, 5);
    return {respuesta: String(j.responder || '').trim(), pregunta: String(j.preguntar || '').trim(), cambios, crear, rechazados, pasos, vistos};
  }
  return {respuesta: 'Me enredé buscando. Dímelo más concreto (qué, cuándo y cuánto).', cambios: [], rechazados: [], pasos, vistos};
}

if(typeof module !== 'undefined') module.exports = {asistente, asHerramienta, asValidar, asPrompt, asFiltrar, asCompacto, AS_COLS};
