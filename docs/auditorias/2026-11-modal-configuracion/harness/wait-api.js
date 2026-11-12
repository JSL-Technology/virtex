// Espera a que la API responda (tras un reinicio del servidor de desarrollo).
const http = require('http');
const deadline = Date.now() + 300000;
(function poll() {
  http.get('http://localhost:3000/api/v1/auth/session', (r) => { r.resume(); console.log('api up', r.statusCode); process.exit(0); })
    .on('error', () => { if (Date.now() > deadline) { console.log('timeout'); process.exit(1); } setTimeout(poll, 3000); });
})();
