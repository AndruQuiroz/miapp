#!/usr/bin/env node
/* ═══════════════════════════════════════════════
   score.js — mide app/quick.js (parseQuickMulti) contra un corpus de frases (SPEC §12.1)
   Uso:  node tests/corpus/score.js <archivo.json> [--fallos] [--grupo=venta] [--quick=ruta/quick.js]
   Es una MEDICIÓN, no un test: siempre sale con código 0.
   Como módulo: const {scoreFile} = require('./score.js'); scoreFile(ruta) → {total, ok, pct, campos, grupos, fallos}
═══════════════════════════════════════════════ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const HOY_ISO = '2026-10-06T12:00:00-05:00';      // "hoy" del corpus (mediodía en Bogotá)
const VACIO = '__vacio';

/* ── reloj congelado: subclase de Date (los métodos estáticos se heredan) y SIEMPRE se restaura ── */
function conReloj(fn){
  const RealDate = globalThis.Date, prevTZ = process.env.TZ;
  const now = new RealDate(HOY_ISO).getTime();
  class FrozenDate extends RealDate {
    constructor(...a){ if(a.length === 0) super(now); else super(...a); }
    static now(){ return now; }
  }
  process.env.TZ = 'America/Bogota';
  globalThis.Date = FrozenDate;
  try { return fn(); }
  finally {
    globalThis.Date = RealDate;
    if(prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ;
  }
}

/* minúsculas, sin tildes, solo letras/números separados por un espacio (igual que normKey) */
const nk = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const vacio = v => v === undefined || v === null || v === '' || v === 0;
const contiene = (got, exp) => !!nk(exp) && (' ' + nk(got) + ' ').includes(' ' + nk(exp) + ' ');

/* nombres reales de campo por tipo */
const F = {
  compra:   {monto: 'buyPrice',  bolsillo: 'buyPocket',  fecha: 'buyDate'},
  venta:    {monto: 'sellPrice', bolsillo: 'sellPocket', fecha: 'sellDate'},
  gasto:    {monto: 'valor',     bolsillo: 'bolsillo',   fecha: 'fecha'},
  ingreso:  {monto: 'valor',     bolsillo: 'bolsillo',   fecha: 'fecha'},
  cobro:    {monto: 'total',     bolsillo: 'bolsillo',   fecha: 'fecha'},
  abono:    {monto: 'monto',     bolsillo: 'bolsillo',   fecha: 'fecha'},
  transfer: {monto: 'monto',     bolsillo: 'to',         fecha: 'fecha'},
  reparto:  {monto: 'monto',     bolsillo: undefined,    fecha: 'fecha'}   // §13.3: entre apartados, from/to = ids de fondos
};
const CAMPOS = ['kind', 'monto', 'bolsillo', 'cat', 'tipo', 'desc', 'tradeIn', 'fecha', 'ref', 'from', 'to', 'pagado', 'fondo'];

/* valor "obtenido" de un campo, ya traducido al vocabulario del corpus */
function obtener(campo, op, ctx){
  const d = (op && op.d) || {}, f = F[op && op.kind] || {};
  switch(campo){
    case 'kind': return op ? op.kind : undefined;
    case 'monto': case 'bolsillo': case 'fecha': return f[campo] ? d[f[campo]] : undefined;
    case 'cat': return d.cat;
    case 'tipo': return d.tipo;
    case 'fondo': return d.fondo;
    case 'from': return d.from;
    case 'to': return d.to;
    case 'tradeIn': return d.tradeIn;
    case 'ref': return op.kind === 'venta' ? d.itemId : op.kind === 'abono' ? d.cobroId : undefined;
    case 'pagado':
      if(op.kind === 'cobro') return d.pagado;
      if(d.sellPaid !== undefined) return d.sellPaid;
      return d.completo === 'no' ? undefined : d.sellPrice;   // venta normal = pagada completa
    case 'desc': {
      if(op.kind === 'cobro') return d.nombre;
      if(op.kind === 'abono'){
        const c = (ctx.cobros || []).find(x => x.id === d.cobroId);
        return c ? c.nombre : (d._nombre || d.nombre);
      }
      if(op.kind === 'venta' && !d.desc){
        const it = (ctx.stock || []).find(x => x.id === d.itemId);
        return it ? it.desc : undefined;
      }
      return d.desc;
    }
  }
  return undefined;
}

/* ¿coincide? (exp nunca es null aquí) */
function coincide(campo, exp, got){
  if(exp === VACIO) return campo === 'cat' ? (vacio(got) || got === 'Otro') : vacio(got);
  switch(campo){
    case 'desc': return contiene(got, exp);
    case 'cat': return nk(got) === nk(exp);
    case 'monto': case 'pagado': return +got === +exp && got !== undefined && got !== null && got !== '';
    case 'tradeIn': {
      if(!got) return false;
      if(exp.desc != null && !(exp.desc === VACIO ? vacio(got.desc) : contiene(got.desc, exp.desc))) return false;
      if(exp.valor != null && !(exp.valor === VACIO ? vacio(got.valor) : +got.valor === +exp.valor)) return false;
      return true;
    }
    default: return got === exp;
  }
}

const muestra = v => v === undefined ? '∅' : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);

function cargarQuick(rutaQuick){
  const p = path.resolve(rutaQuick || path.join(__dirname, '..', '..', 'app', 'quick.js'));
  require(path.join(path.dirname(p), 'core.js'));
  return require(p);
}

function cargarCorpus(file){
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const casos = Array.isArray(raw) ? raw : raw.casos;
  const contextos = (!Array.isArray(raw) && raw.contextos) || {};
  const dir = path.dirname(path.resolve(file));
  const cache = {};
  const ctxDe = c => {
    if(c && typeof c === 'object') return c;
    const name = c || 'base';
    if(cache[name]) return cache[name];
    if(contextos[name]) return (cache[name] = contextos[name]);
    for(const f of [path.join(dir, `ctx-${name}.json`), path.join(__dirname, `ctx-${name}.json`)])
      if(fs.existsSync(f)) return (cache[name] = JSON.parse(fs.readFileSync(f, 'utf8')));
    throw new Error('No encuentro el contexto "' + name + '"');
  };
  return {casos, ctxDe};
}

function scoreFile(file, opts = {}){
  const Q = cargarQuick(opts.quick);
  const {casos, ctxDe} = cargarCorpus(file);
  const campos = {}, grupos = {}, fallos = [];
  CAMPOS.concat(['ops']).forEach(c => campos[c] = {ok: 0, n: 0});
  let ok = 0, total = 0;
  casos.forEach(caso => {
    if(opts.grupo && caso.grupo !== opts.grupo) return;
    total++;
    const ctx = ctxDe(caso.ctx);
    let out, err = null;
    try { out = conReloj(() => Q.parseQuickMulti(caso.texto, JSON.parse(JSON.stringify(ctx)))); }
    catch(e){ err = e; out = []; }
    if(!Array.isArray(out)) out = out ? [out] : [];
    const difs = [];
    const opsOk = out.length === caso.esperado.length;
    campos.ops.n++; if(opsOk) campos.ops.ok++; else difs.push(`nº de operaciones: esperado ${caso.esperado.length}, obtenido ${out.length}`);
    caso.esperado.forEach((exp, i) => {
      const op = out[i];
      const kindOk = !!op && op.kind === exp.kind;
      CAMPOS.forEach(campo => {
        const e = exp[campo];
        if(e === null || e === undefined) return;
        campos[campo].n++;
        let bien = false, got;
        if(campo === 'kind'){ got = op && op.kind; bien = kindOk; }
        else if(kindOk){ got = obtener(campo, op, ctx); bien = coincide(campo, e, got); }
        if(bien) campos[campo].ok++;
        else difs.push(`[${i + 1}] ${campo}: esperado ${muestra(e)} · obtenido ${kindOk || campo === 'kind' ? muestra(got) : '(otro tipo: ' + muestra(op && op.kind) + ')'}`);
      });
    });
    if(err) difs.unshift('EXCEPCIÓN: ' + err.message);
    const g = grupos[caso.grupo] || (grupos[caso.grupo] = {ok: 0, n: 0});
    g.n++;
    if(!difs.length){ ok++; g.ok++; }
    else fallos.push({id: caso.id, grupo: caso.grupo, texto: caso.texto, difs, obtenido: out});
  });
  const pct = total ? Math.round(1000 * ok / total) / 10 : 0;
  return {total, ok, pct, campos, grupos, fallos};
}

const P = (a, b) => b ? (100 * a / b).toFixed(1).padStart(5) + '%' : '    —';

function imprimir(r, file, conFallos){
  const L = [];
  L.push(`Corpus: ${file}`);
  L.push(`Frases totalmente correctas: ${r.ok}/${r.total} = ${r.pct}%`);
  L.push('', 'Por campo (solo donde el corpus lo exige):');
  Object.entries(r.campos).filter(([, v]) => v.n).forEach(([k, v]) => L.push(`  ${k.padEnd(9)} ${P(v.ok, v.n)}  (${v.ok}/${v.n})`));
  L.push('', 'Por grupo:');
  Object.entries(r.grupos).forEach(([k, v]) => L.push(`  ${k.padEnd(15)} ${P(v.ok, v.n)}  (${v.ok}/${v.n})`));
  if(conFallos){
    L.push('', `Fallos (${r.fallos.length}):`);
    r.fallos.forEach(f => {
      L.push(`- ${f.id} [${f.grupo}] "${f.texto}"`);
      f.difs.forEach(d => L.push('    ' + d));
      L.push('    obtenido: ' + JSON.stringify(f.obtenido.map(o => ({kind: o.kind, ...o.d}))));
    });
  }
  console.log(L.join('\n'));
}

if(require.main === module){
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  if(!file){ console.log('Uso: node tests/corpus/score.js <archivo.json> [--fallos] [--grupo=X] [--quick=ruta]'); process.exit(0); }
  const opt = k => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : undefined; };
  try { imprimir(scoreFile(file, {grupo: opt('grupo'), quick: opt('quick')}), file, args.includes('--fallos')); }
  catch(e){ console.log('No se pudo medir: ' + (e && e.stack || e)); }
  process.exitCode = 0;
}

module.exports = {scoreFile, conReloj, HOY_ISO};
