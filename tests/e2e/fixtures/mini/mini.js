/* Mini app SOLO para probar el harness (no es la app real): usa core.js + quick, localStorage, fetch, Chart, voz, SW, portapapeles. */
const KEY_DB = 'miapp_db_v2', KEY_CFG = 'miapp_cfg';
let DB = JSON.parse(localStorage.getItem(KEY_DB) || 'null') || emptyDB();
const CFG = JSON.parse(localStorage.getItem(KEY_CFG) || '{}');
const $m = id => document.getElementById(id);
function save() { localStorage.setItem(KEY_DB, JSON.stringify(DB)); }
function render() { $m('count').textContent = 'gastos: ' + L(DB, 'gastos').length + ' | hoy: ' + today(); }
async function sync() {
  if (!CFG.url || !CFG.key || !navigator.onLine) { $m('status').textContent = CFG.url ? 'sin señal' : 'sin nube'; return; }
  $m('status').textContent = 'sincronizando';
  try {
    const r = await fetch(CFG.url, { method: 'POST', body: JSON.stringify({ action: 'sync', key: CFG.key, db: DB }) });   // sin Content-Type JSON (SPEC §5)
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    DB = mergeDB(DB, j.db); save(); render(); $m('status').textContent = 'al día';
  } catch (e) { $m('status').textContent = 'error'; }
}
let deb; const later = () => { clearTimeout(deb); deb = setTimeout(sync, 1500); };
$m('go').onclick = () => {
  const r = parseQuick($m('q').value, { bolsillos: L(DB, 'bolsillos'), stock: [], cobros: [] });
  $m('out').textContent = JSON.stringify(r);
  if (r.kind === 'gasto') { DB.gastos.push({ id: 'g' + Date.now().toString(36), desc: r.d.desc, valor: r.d.valor, cat: r.d.cat, tipo: r.d.tipo, bolsillo: r.d.bolsillo || 'nequi', fecha: today(), u: Date.now() }); save(); render(); later(); }
};
$m('mic').onclick = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $m('out').textContent = 'sin voz'; return; }
  const sr = new SR(); sr.lang = 'es-CO';
  sr.onresult = e => { $m('q').value = e.results[0][0].transcript; $m('go').click(); };
  sr.onerror = e => { $m('out').textContent = 'error voz: ' + e.error; };
  sr.start();
};
$m('copy').onclick = () => navigator.clipboard.writeText('https://script.google.com/macros/s/X/exec?action=summary&key=' + CFG.key);
$m('wa').onclick = () => window.open('https://wa.me/573001234567?text=' + encodeURIComponent('Hola Juan'), '_blank');
$m('export').onclick = () => { const b = new Blob([JSON.stringify(DB)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'miapp_' + today().replace(/-/g, '') + '.json'; document.body.appendChild(a); a.click(); a.remove(); };
$m('del').onclick = () => { if (confirm('¿Eliminar el último gasto?')) { const g = L(DB, 'gastos').pop(); if (g) { g.del = 1; g.u = Date.now(); save(); render(); later(); } } };
if (typeof Chart !== 'undefined') new Chart($m('chart'), { type: 'bar', data: { labels: ['a'], datasets: [{ data: [1] }] } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
addEventListener('online', sync); addEventListener('offline', () => { $m('status').textContent = 'sin señal'; });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 60000);
render(); sync();
