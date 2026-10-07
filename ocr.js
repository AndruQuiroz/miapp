/* ═══════════════════════════════════════════════
   ocr.js — leer IMEI, batería y almacenamiento desde pantallazos o fotos
   · extraerDatosTelefono(texto) es PURO (testeable en Node).
   · leerImagenes(files, onProgreso) usa Tesseract.js (se carga del CDN la primera vez, luego queda en caché).
═══════════════════════════════════════════════ */

/* IMEI válido = 15 dígitos con dígito de control Luhn */
function luhnOk(d){
  if(!/^\d{15}$/.test(d)) return false;
  let s = 0;
  for(let i = 0; i < 15; i++){
    let n = +d[i];
    if(i % 2 === 1){ n *= 2; if(n > 9) n -= 9; }
    s += n;
  }
  return s % 10 === 0;
}

/* Arreglos típicos de OCR dentro de números: O→0, I/l/|→1, S→5, B→8, Z→2 */
const OCR_DIG = {O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', '|': '1', i: '1', S: '5', s: '5', B: '8', Z: '2', z: '2', g: '9', q: '9'};
const fixDigits = s => s.replace(/[OoDQIl|iSsBZzgq]/g, c => OCR_DIG[c]);

function extraerDatosTelefono(texto){
  const t = String(texto || '').replace(/\r/g, '');
  const lineas = t.split('\n').map(x => x.trim()).filter(Boolean);
  const plano = lineas.join('\n');
  const out = {imeis: []};

  // ── IMEI: 15 dígitos (con espacios/guiones/barras) que pasen Luhn; se prefiere el que está junto a la palabra IMEI
  const cand = [];
  const reBloque = /[0-9OoDQIl|SBZ][0-9OoDQIl|SBZ \-/.?*#_]{13,24}[0-9OoDQIl|SBZ]/g;
  lineas.forEach((ln0, idx) => {
    // lo que va DESPUÉS de la etiqueta ("IMEI2 35 …" no debe meter el 2 de la etiqueta)
    const ln = ln0.replace(/^.*?\b(?:imei|meid)(?:\s*\(?\s*(?:ranura|slot|sim)\s*\d\s*\)?|\d)?\s*[:.\-]?\s*/i, '');
    const cerca = /imei|meid/i.test(ln0) || (idx > 0 && /imei|meid/i.test(lineas[idx - 1]));
    const segunda = /imei\s*2|imei\s*\(?ranura\s*2|sim\s*2/i.test(ln0) || (idx > 0 && /imei\s*2/i.test(lineas[idx - 1]) && !/imei/i.test(ln0));
    let m;
    while((m = reBloque.exec(ln))){
      const dig = fixDigits(m[0]).replace(/\D/g, '');
      // un carácter ilegible ("48691? 9"): el dígito de control Luhn permite recuperarlo
      if(dig.length === 14 && cerca){
        const raw = fixDigits(m[0]).replace(/[\s\-/.]/g, '');
        const pos = raw.search(/\D/);
        if(pos >= 0 && raw.replace(/\D/g, '').length === 14 && raw.length === 15){
          for(let x = 0; x < 10; x++){ const d = raw.slice(0, pos) + x + raw.slice(pos + 1); if(luhnOk(d)){ cand.push({d, cerca, segunda, idx, exacto: 1}); break; } }
          continue;
        }
      }
      if(dig.length === 15){ if(luhnOk(dig)) cand.push({d: dig, cerca, segunda, idx, exacto: 1}); continue; }
      // bloque más largo (ruido del OCR): solo ventanas que empiezan como un IMEI real (35, 86, 01, 99, 49, 45)
      for(let k = 0; k + 15 <= dig.length; k++){
        const d = dig.slice(k, k + 15);
        if(luhnOk(d) && /^(35|86|01|99|49|45|30|33|51|52|53)/.test(d)) cand.push({d, cerca, segunda, idx, exacto: 0});
      }
    }
  });
  const vistos = new Set();
  cand.sort((a, b) => (b.cerca - a.cerca) || (b.exacto - a.exacto) || (a.segunda - b.segunda) || (a.idx - b.idx)).forEach(c => {
    if(!vistos.has(c.d)){ vistos.add(c.d); out.imeis.push(c.d); }
  });
  if(out.imeis.length) out.imei = out.imeis[0];
  if(out.imeis.length > 1) out.imei2 = out.imeis[1];

  // ── Batería: "Capacidad máxima 87 %", "Salud de la batería 89%", "Battery health 91%", "Estado de la batería: Bueno (85%)"
  const rb = /(?:capacidad\s+m[aá]xima|maximum\s+capacity|salud(?:\s+de\s+la\s+bater[ií]a)?|battery\s+health|estado\s+de\s+(?:la\s+)?bater[ií]a|bater[ií]a|battery|capacidad\s+de\s+la\s+bater[ií]a)[^\d\n]{0,25}\n?[^\d\n]{0,10}(\d{2,3})\s*[%°o]?/i;
  const mb = plano.match(rb);
  if(mb){ const v = +mb[1]; if(v >= 40 && v <= 100) out.bateria = v; }
  if(out.bateria == null){
    // pantallazo solo de batería: un porcentaje suelto 40–100 en una pantalla que menciona batería
    if(/bater[ií]a|battery/i.test(plano)){ const p = plano.match(/(?:^|\s)(\d{2,3})\s?%/m); if(p && +p[1] >= 40 && +p[1] <= 100) out.bateria = +p[1]; }
  }

  // ── Almacenamiento: "Capacidad 128 GB", "Almacenamiento 256 GB", "Storage 512GB", "Capacity 1 TB"; ignora "Disponible"/"usado"
  const ra = /(?:capacidad|almacenamiento(?:\s+interno)?|capacity|storage|memoria\s+interna|rom)(?!\s+m[aá]xima)[^\n\d]{0,20}\n?[^\n\d]{0,5}(\d{1,4}(?:[.,]\d+)?)\s*(gb|tb|g\b|t\b)/i;
  const ma = plano.match(ra);
  const std = [16, 32, 64, 128, 256, 512, 1024];
  const norm = (n, u) => {
    let v = parseFloat(String(n).replace(',', '.'));
    if(/^t/i.test(u)) return v >= 1 && v <= 2 ? v + 'TB' : null;
    const s = std.find(x => x >= v * 0.85 && x <= v * 1.25) || null;   // "119 GB" reportado por Android → 128GB
    return s ? (s === 1024 ? '1TB' : s + 'GB') : null;
  };
  if(ma){ out.almac = norm(ma[1], ma[2]); }
  if(!out.almac){
    // sin etiqueta: el valor estándar más grande que aparezca como "128 GB" sin "disponible/usado" en la línea
    let best = 0, bu = '';
    lineas.forEach(ln => {
      if(/disponible|usad|libre|available|used|ram/i.test(ln)) return;
      const m = ln.match(/(\d{2,4})\s*(GB|TB)\b/i);
      if(m){ const s = norm(m[1], m[2]); const v = s ? parseFloat(s) * (/TB/.test(s) ? 1024 : 1) : 0; if(v > best){ best = v; bu = s; } }
    });
    if(bu) out.almac = bu;
  }

  // ── Extras útiles si aparecen: modelo y número de serie
  const mm = plano.match(/(?:nombre\s+del\s+modelo|model\s+name|nombre\s+del\s+dispositivo|modelo)\s*[:\n]?\s*([^\n]{3,40})/i);
  if(mm && !/^n[uú]mero/i.test(mm[1])) out.modelo = mm[1].trim().replace(/\b(galaxy\s+)5(\d{2})\b/i, '$1S$2').replace(/\bi[Pp]hone\b/, 'iPhone');
  const ms = plano.match(/(?:n[uú]mero\s+de\s+serie|serial\s+number|serie)\s*[:\n]?\s*([A-Z0-9]{8,14})/i);
  if(ms) out.serie = ms[1];
  return out;
}

/* ── Navegador: OCR con Tesseract.js (español + inglés) ── */
const OCR_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
let ocrWorkerP = null;
function cargarTesseract(){
  if(typeof Tesseract !== 'undefined') return Promise.resolve();
  return new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = OCR_CDN; s.onload = () => ok(); s.onerror = () => mal(new Error('No se pudo descargar el lector (¿sin internet?)'));
    document.head.appendChild(s);
  });
}
async function ocrWorker(onProgreso){
  if(!ocrWorkerP){
    ocrWorkerP = (async () => {
      await cargarTesseract();
      return Tesseract.createWorker(['spa', 'eng'], 1, {logger: m => { if(ocrWorker._cb && m.progress != null) ocrWorker._cb(m); }});
    })().catch(e => { ocrWorkerP = null; throw e; });
  }
  ocrWorker._cb = onProgreso;
  return ocrWorkerP;
}
/* Reduce y pasa a escala de grises para que el OCR sea rápido y preciso en el celular */
function prepararImagen(file){
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const max = 1800, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height);
      const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
      let suma = 0; for(let i = 0; i < p.length; i += 4){ const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; p[i] = p[i + 1] = p[i + 2] = g; suma += g; }
      if(suma / (p.length / 4) < 110) for(let i = 0; i < p.length; i += 4){ p[i] = p[i + 1] = p[i + 2] = 255 - p[i]; }   // modo oscuro → invertir
      // texto gris claro (como los valores de Ajustes) → negro; el fondo queda blanco
      for(let i = 0; i < p.length; i += 4){ const v = p[i] < 200 ? Math.max(0, p[i] - 90) : 255; p[i] = p[i + 1] = p[i + 2] = v; }
      x.putImageData(d, 0, 0); URL.revokeObjectURL(url); ok(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo abrir la imagen')); };
    img.src = url;
  });
}
/* files: FileList/Array de imágenes → {imei, imei2, bateria, almac, modelo, serie, texto} (une lo de todas las fotos) */
async function leerImagenes(files, onProgreso){
  const w = await ocrWorker(onProgreso);
  const res = {imeis: []}, textos = [];
  for(const f of Array.from(files || [])){
    const c = await prepararImagen(f);
    const {data} = await w.recognize(c);
    textos.push(data.text);
    const r = extraerDatosTelefono(data.text);
    r.imeis.forEach(x => { if(!res.imeis.includes(x)) res.imeis.push(x); });
    ['bateria', 'almac', 'modelo', 'serie'].forEach(k => { if(res[k] == null && r[k] != null) res[k] = r[k]; });
  }
  if(res.imeis.length) res.imei = res.imeis[0];
  if(res.imeis.length > 1) res.imei2 = res.imeis[1];
  res.texto = textos.join('\n---\n');
  return res;
}

if(typeof module !== 'undefined') module.exports = {luhnOk, extraerDatosTelefono, fixDigits};
