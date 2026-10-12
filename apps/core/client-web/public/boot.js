/* Pantalla de arranque (QA C-02): traduce el aviso y, si la aplicación no ha pintado en 12 s,
   ofrece reintentar en lugar de dejar la página en blanco. Archivo aparte para cumplir la CSP
   `script-src 'self'`. Angular sustituye todo el contenido de <app-root> al arrancar. */
(function () {
  var lang = ((location.pathname.split('/')[1] || navigator.language || 'es') + '').slice(0, 2);
  var t = {
    en: ['Loading…', "We couldn't reach the server", 'Check your connection. If the problem continues, the service may be under maintenance.', 'Try again'],
    pt: ['Carregando…', 'Não foi possível conectar ao servidor', 'Verifique sua conexão. Se o problema continuar, o serviço pode estar em manutenção.', 'Tentar novamente']
  }[lang];
  if (t) {
    document.getElementById('vx-boot-loading').textContent = t[0];
    document.getElementById('vx-boot-title').textContent = t[1];
    document.getElementById('vx-boot-text').textContent = t[2];
    document.getElementById('vx-boot-retry').textContent = t[3];
  }
  document.getElementById('vx-boot-retry').addEventListener('click', function () { location.reload(); });
  setTimeout(function () {
    var el = document.getElementById('vx-boot');
    if (el) { el.className += ' vx-boot--failed'; var l = document.getElementById('vx-boot-loading'); if (l) l.style.display = 'none'; }
  }, 12000);
})();
