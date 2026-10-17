/* ═══════════════════════════════════════════════
   ia.js — IA opcional (Google Gemini, capa gratis) para entender frases difíciles / dictadas.
   · El parser local (quick.js) SIEMPRE corre primero; la IA recibe su interpretación como pista,
     más el contexto del negocio (bolsillos, stock, quién te debe, cómo hablas) y la corrige.
   · Si no hay clave, no hay señal, se acaba la cuota o tarda más de 8 s → se usa lo local, sin drama.
   · La respuesta se pasa al MISMO formato de parseQuickMulti, así que la hoja "Esto entendí",
     los formularios y el aprendizaje funcionan igual. Nada se guarda sin que confirmes.
   Puro y testeable en Node, salvo iaLlamar (fetch).
═══════════════════════════════════════════════ */

const IA_MODELOS = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-2.5-flash-lite'];
const IA_URL = m => 'https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent';
const IA_KINDS = ['compra', 'venta', 'gasto', 'ingreso', 'cobro', 'abono', 'transfer'];
const IA_MAX_EJ = 25;

/* contexto compacto: solo lo que ayuda a entender (sin saldos ni historial completo) */
function iaContexto(ctx){
  ctx = ctx || {};
  const bol = (ctx.bolsillos || []).filter(b => !b.del).map(b => ({id: b.id, nombre: b.nombre, alias: Array.isArray(b.alias) && b.alias.length ? b.alias : undefined}));
  const stock = (ctx.stock || []).slice(0, 60).map(i => ({id: i.id, desc: i.desc, costo: i.buyPrice || undefined}));
  const deben = (ctx.cobros || []).slice(0, 40).map(c => ({id: c.id, nombre: c.nombre, debe: c.pend != null ? c.pend : undefined}));
  const fondos = (ctx.fondos || []).filter(f => !f.del && !/^(negocio|personal)$/.test(f.id)).map(f => ({id: f.id, nombre: f.nombre}));
  const contactos = (ctx.contactos || []).slice(0, 40).map(c => c.nombre).filter(Boolean);
  return {bolsillos: bol, stock, te_deben: deben, apartados: fondos.length ? fondos : undefined, contactos: contactos.length ? contactos : undefined};
}

/* parseQuickMulti → formato simple (el mismo vocabulario que le pedimos a la IA) */
function iaSimple(op){
  const d = (op && op.d) || {}, k = op && op.kind, o = {kind: k};
  const set = (a, v) => { if(v !== undefined && v !== null && v !== '') o[a] = v; };
  switch(k){
    case 'compra': set('monto', d.buyPrice); set('bolsillo', d.buyPocket); set('fecha', d.buyDate); set('nombre', d.proveedor); break;
    case 'venta': set('monto', d.sellPrice); set('bolsillo', d.sellPocket); set('fecha', d.sellDate); set('ref', d.itemId); set('nombre', d.cliente); if(d.completo === 'no') set('pagado', d.sellPaid == null ? 0 : d.sellPaid); break;
    case 'gasto': case 'ingreso': set('monto', d.valor); set('bolsillo', d.bolsillo); set('fecha', d.fecha); set('ref', d.itemId); break;
    case 'cobro': set('monto', d.total); set('bolsillo', d.bolsillo); set('fecha', d.fecha); set('nombre', d.nombre); set('pagado', d.pagado); break;
    case 'abono': set('monto', d.monto); set('bolsillo', d.bolsillo); set('fecha', d.fecha); set('ref', d.cobroId); set('nombre', d._nombre); break;
    case 'transfer': set('monto', d.monto); set('from', d.from); set('to', d.to); set('fecha', d.fecha); break;
  }
  set('desc', d.desc); set('cat', d.cat); set('tipo', d.tipo); set('fondo', d.fondo);
  if(d.tradeIn) o.tradeIn = {desc: d.tradeIn.desc || '', valor: d.tradeIn.valor || 0};
  ['bateria', 'almac', 'color'].forEach(x => set(x, d[x]));
  return o;
}

function iaPrompt(texto, ctx, ejemplos, pista, hoy){
  const c = iaContexto(ctx);
  const sys = `Eres el asistente contable de Andru, que compra y vende iPhones (y a veces otros equipos) en Medellín, Colombia. Él te dice (muchas veces dictado por voz, con errores de dictado) lo que hizo con su plata y tú lo conviertes en operaciones para su app. Habla paisa.

Responde SOLO un JSON: {"ops":[...], "duda": null o una pregunta muy corta si algo esencial no se puede saber}.
Cada op: {"kind", "monto", "bolsillo", "desc", "cat", "tipo", "fecha", "ref", "nombre", "pagado", "tradeIn", "from", "to", "fondo", "bateria", "almac", "color"} — omite lo que no aplique.

kind:
- "compra": compró un producto para revender (entra al stock). monto = lo que pagó. nombre = a quién se lo compró.
- "venta": vendió algo. ref = id del producto del STOCK que vendió (búscalo por modelo; "el 13" = el iPhone 13 del stock). Si lo compró en la misma frase, ref = "__prev". monto = precio total. Si le quedaron debiendo, pagado = lo que sí le dieron. nombre = cliente. tradeIn = {"desc","valor"} si recibió un equipo como parte de pago ("me dio un 12 de parte de pago valorado en 900").
- "gasto": plata que salió que no es compra para revender (comida, transporte, envíos, arreglo de un equipo…). Si es un arreglo/repuesto/envío de un producto del stock, ref = su id y tipo = "negocio".
- "ingreso": plata que entró que NO es venta ni abono (sueldo, regalo, intereses).
- "cobro": le prestó plata a alguien o le fió (nombre = quién debe, monto = total, pagado = lo que ya le dio si aplica).
- "abono": alguien que le debía le pagó (ref = id en te_deben; si no está, nombre = quién).
- "transfer": movió plata entre sus bolsillos (retiró de Nequi = from nequi to efectivo). from/to = ids de bolsillos.

Plata (pesos colombianos, monto siempre entero):
- "palo"/"palos"/"melón" = 1.000.000; "luca"/"lucas"/"barra" = 1.000; "k"/"mil" = 1.000; "2 palos y medio" = 2.500.000; "medio palo" = 500.000.
- Para celulares y equipos caros los precios cortos son millones: "en 1.6", "1,6", "uno seis", "uno punto seis" = 1.600.000; "en 3" = 3.000.000; "en 850" = 850.000.
- Para gastos/préstamos chicos sin unidad: "almuerzo 18" = 18.000; "le presté 200" = 200.000.
- Corrige errores típicos del dictado: "trece pro" = 13 Pro, "pro más"/"promax" = Pro Max, "nequi" puede llegar como "neki"/"en equis", "efectivo" como "en efectivo"/"cash".

bolsillo / from / to: usa SOLO ids de la lista de bolsillos (por nombre o alias: "el nequi de mi novia" = el de la pareja si existe). Si no lo dijo, null.
desc: corto y claro ("17 Pro Max", "Almuerzo", "Domicilio"). En compra/venta de celulares, el modelo con capacidad/color si lo dijo.
cat de gasto: una de ${JSON.stringify(typeof GCATS !== 'undefined' ? GCATS : [])}. cat de producto: una de ${JSON.stringify(typeof CATS !== 'undefined' ? CATS : [])}.
tipo de gasto: "negocio" (envíos, empaques, comisiones, publicidad, arreglos de equipos) o "personal".
fecha: "YYYY-MM-DD" solo si dijo cuándo ("ayer", "el lunes"); hoy es ${hoy}. Si no, null.
bateria (número 0-100), almac ("128GB", "1TB"), color: solo si los dijo al comprar.
Si en una frase hay varias cosas, devuelve varias ops en orden. No inventes montos: si no dijo cuánto, monto null y explícalo en duda.

CONTEXTO DE SU APP:
${JSON.stringify(c)}`;
  let usr = '';
  if(ejemplos && ejemplos.length){
    usr += 'Así habla él (frases que ya confirmó, con lo que de verdad eran):\n' + ejemplos.slice(-IA_MAX_EJ).map(e => `"${e.t}" → ${JSON.stringify(e.ops)}`).join('\n') + '\n\n';
  }
  if(pista && pista.length) usr += 'Lo que entendió el programa sencillo de la app (puede estar mal, úsalo solo como pista): ' + JSON.stringify(pista.map(iaSimple)) + '\n\n';
  usr += 'FRASE: "' + texto + '"';
  return {sys, usr};
}

/* JSON de la IA → ops con los campos reales de la app; descarta lo que no cuadre con el contexto */
function iaToOps(resp, ctx){
  let j = resp;
  if(typeof j === 'string'){
    const s = j.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { j = JSON.parse(s); } catch(e){ const m = s.match(/\{[\s\S]*\}/); if(!m) return null; try { j = JSON.parse(m[0]); } catch(e2){ return null; } }
  }
  const lista = Array.isArray(j) ? j : j && Array.isArray(j.ops) ? j.ops : null;
  if(!lista) return null;
  ctx = ctx || {};
  const bols = new Set((ctx.bolsillos || []).filter(b => !b.del).map(b => b.id));
  const stock = new Set((ctx.stock || []).map(i => i.id));
  const cobros = new Set((ctx.cobros || []).map(c => c.id));
  const fondos = new Set((ctx.fondos || []).filter(f => !f.del).map(f => f.id));
  const n = v => { const x = Math.round(+String(v == null ? '' : v).replace(/[^\d.-]/g, '')); return x > 0 ? x : undefined; };
  const b = v => v && bols.has(String(v)) ? String(v) : undefined;
  const f = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : undefined;
  const s = v => v == null ? undefined : String(v).trim().slice(0, 80) || undefined;
  const gc = (typeof GCATS !== 'undefined' ? GCATS : []), pc = (typeof CATS !== 'undefined' ? CATS : []);
  const cat = (v, list, guess, desc) => list.includes(v) ? v : (typeof guess === 'function' && desc ? guess(desc) : undefined);
  const ops = [];
  lista.forEach((o, idx) => {
    if(!o || !IA_KINDS.includes(o.kind)) return;
    const d = {}, put = (k, v) => { if(v !== undefined) d[k] = v; };
    const desc = s(o.desc);
    switch(o.kind){
      case 'compra':
        put('desc', desc); put('cat', cat(o.cat, pc, typeof guessCat === 'function' ? guessCat : null, desc));
        put('buyPrice', n(o.monto)); put('buyPocket', b(o.bolsillo)); put('buyDate', f(o.fecha)); put('proveedor', s(o.nombre));
        if(o.bateria != null && +o.bateria >= 0 && +o.bateria <= 100) d.bateria = Math.round(+o.bateria);
        put('almac', s(o.almac)); put('color', s(o.color));
        break;
      case 'venta': {
        const ref = String(o.ref || '');
        if(ref === '__prev' && ops.some(p => p.kind === 'compra')) d.itemId = '__prev';
        else if(stock.has(ref)) d.itemId = ref;
        else { put('desc', desc); put('cat', cat(o.cat, pc, typeof guessCat === 'function' ? guessCat : null, desc)); }
        if(d.itemId === '__prev'){ const pv = ops.filter(p => p.kind === 'compra').pop(); if(pv){ put('desc', pv.d.desc); put('cat', pv.d.cat); } }
        put('sellPrice', n(o.monto)); put('sellPocket', b(o.bolsillo)); put('sellDate', f(o.fecha)); put('cliente', s(o.nombre));
        if(o.pagado != null && n(o.monto) && +o.pagado < n(o.monto)){ d.completo = 'no'; d.sellPaid = Math.max(0, Math.round(+o.pagado) || 0); }
        if(o.tradeIn && (o.tradeIn.desc || o.tradeIn.valor)){
          const td = s(o.tradeIn.desc) || 'Equipo';
          d.tradeIn = {desc: td, cat: typeof guessCat === 'function' ? guessCat(td) : 'Celulares', valor: n(o.tradeIn.valor) || 0};
        }
        break;
      }
      case 'gasto':
        put('desc', desc); put('cat', cat(o.cat, gc, typeof guessGCat === 'function' ? guessGCat : null, desc) || 'Otro');
        put('valor', n(o.monto)); put('bolsillo', b(o.bolsillo)); put('fecha', f(o.fecha));
        if(stock.has(String(o.ref || ''))){ d.itemId = String(o.ref); d.tipo = 'negocio'; }
        else put('tipo', o.tipo === 'negocio' || o.tipo === 'personal' ? o.tipo : undefined);
        break;
      case 'ingreso':
        put('desc', desc); put('valor', n(o.monto)); put('bolsillo', b(o.bolsillo)); put('fecha', f(o.fecha));
        break;
      case 'cobro':
        put('nombre', s(o.nombre) || desc); put('total', n(o.monto)); put('bolsillo', b(o.bolsillo)); put('fecha', f(o.fecha));
        if(o.pagado != null && +o.pagado > 0) d.pagado = Math.round(+o.pagado);
        break;
      case 'abono':
        if(cobros.has(String(o.ref || ''))) d.cobroId = String(o.ref); else put('_nombre', s(o.nombre) || desc);
        put('monto', n(o.monto)); put('bolsillo', b(o.bolsillo)); put('fecha', f(o.fecha));
        break;
      case 'transfer':
        put('from', b(o.from)); put('to', b(o.to)); put('monto', n(o.monto)); put('fecha', f(o.fecha));
        if(d.from && d.from === d.to) delete d.to;
        break;
    }
    if(o.fondo && fondos.has(String(o.fondo))) d.fondo = String(o.fondo);
    ops.push({kind: o.kind, d});
  });
  if(!ops.length) return null;
  ops.duda = j && typeof j.duda === 'string' && j.duda.trim() ? j.duda.trim().slice(0, 160) : '';
  return ops;
}

/* fetch a Gemini con respaldo de modelo (los nombres cambian seguido) y límite de tiempo */
async function iaLlamar(texto, ctx, o){
  o = o || {};
  if(!o.key) throw new Error('sin-clave');
  const {sys, usr} = iaPrompt(texto, ctx, o.ejemplos, o.pista, o.hoy);
  const body = JSON.stringify({
    systemInstruction: {parts: [{text: sys}]},
    contents: [{role: 'user', parts: [{text: usr}]}],
    generationConfig: {temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 1200}
  });
  const modelos = o.modelo ? [o.modelo].concat(IA_MODELOS.filter(m => m !== o.modelo)) : IA_MODELOS;
  let ultimo = null;
  for(const m of modelos){
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => ac && ac.abort(), o.timeout || 8000);
    let r;
    try { r = await fetch(IA_URL(m), {method: 'POST', headers: {'Content-Type': 'application/json', 'x-goog-api-key': o.key}, body, signal: ac ? ac.signal : undefined}); }
    catch(e){ clearTimeout(t); throw new Error(e && e.name === 'AbortError' ? 'lento' : 'red'); }
    clearTimeout(t);
    if(r.status === 400){   // Google responde 400 tanto a "clave inválida" como a "ese modelo no acepta esto"
      let msg = ''; try { const e = await r.json(); msg = JSON.stringify(e); } catch(e){}
      if(/api[ _-]?key/i.test(msg)) throw new Error('clave');
      ultimo = 'modelo'; continue;
    }
    if(r.status === 404){ ultimo = 'modelo'; continue; }   // ese modelo ya no existe → el siguiente
    if(r.status === 429) throw new Error('cuota');
    if(r.status === 401 || r.status === 403) throw new Error('clave');
    if(!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    const txt = (((j.candidates || [])[0] || {}).content || {parts: []}).parts.map(p => p.text || '').join('');
    return {modelo: m, texto: txt, ops: iaToOps(txt, ctx)};
  }
  throw new Error(ultimo || 'modelo');
}

if(typeof module !== 'undefined') module.exports = {iaContexto, iaSimple, iaPrompt, iaToOps, iaLlamar, IA_MODELOS};
