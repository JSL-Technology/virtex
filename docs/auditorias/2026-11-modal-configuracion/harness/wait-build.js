// Espera a que el servidor de desarrollo termine una compilación nueva (cuenta las líneas de
// «Application bundle generation complete» del registro). Uso: node wait-build.js <cuenta-previa>
const fs = require('fs');
const LOG = process.env.WEB_LOG;
const before = Number(process.argv[2] || 0);
const started = Date.now();
const count = () => (fs.readFileSync(LOG, 'utf8').match(/Application bundle generation complete/g) || []).length;
(function poll() {
  const n = count();
  if (n > before) { console.log(`compilado (${n})`); setTimeout(() => process.exit(0), 3000); return; }
  if (Date.now() - started > 180000) { console.log('sin compilación nueva en 3 min'); process.exit(1); }
  setTimeout(poll, 1000);
})();
