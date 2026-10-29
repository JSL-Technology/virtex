const { launch, instrument, uiLogin, go, snap } = require('./lib.cjs');
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v)}`);
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page); await go(page, 'inventory/adjustments');
  const open = async (s) => { await page.evaluate((s) => { location.hash = 'settings/' + s; }, s); await page.locator('.sm-panel').waitFor(); await page.waitForTimeout(2200); };
  const m = page.locator('.sm-panel');
  // 1) Mi perfil: contraseñas
  await open('my-profile');
  out('campos contraseña', await m.locator('input[type=password]').evaluateAll((els) => els.map((e) => ({ value: e.value.length, placeholder: e.placeholder, autocomplete: e.autocomplete }))));
  out('sesiones (texto)', (await m.innerText()).match(/Cerrar las demás sesiones[^\n]*/)?.[0]);
  out('titulo pestaña navegador', await page.title());
  // 2) Personalización: segmento seleccionado
  await open('branding');
  out('segmentos idioma', await m.locator('button').filter({ hasText: /English|Português|Español/ }).evaluateAll((els) => els.map((e) => ({ t: e.innerText, color: getComputedStyle(e).color, bg: getComputedStyle(e).backgroundColor }))));
  out('botones sin texto visible', await m.locator('button').evaluateAll((els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().width > 40 && !e.innerText.trim()).map((e) => ({ html: e.outerHTML.slice(0, 160), color: getComputedStyle(e).color, bg: getComputedStyle(e).backgroundColor }))));
  out('ambito personalizacion: idioma/tema guardan al clic?', 'ver red');
  let n = log.requests.length;
  await m.getByRole('button', { name: 'Compacta' }).click().catch(() => {}); await page.waitForTimeout(1200);
  out('red tras clic Compacta', log.requests.slice(n).filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.url} ${r.status}`));
  out('densidad aplicada al shell?', await page.evaluate(() => [document.documentElement.className, document.documentElement.getAttribute('data-density'), document.body.className].join(' | ')));
  out('guardar habilitado tras clic', await m.getByRole('button', { name: /Guardar cambios/ }).isEnabled());
  await m.getByRole('button', { name: 'Cómoda' }).click().catch(() => {}); await page.waitForTimeout(800);
  // 3) IA: ¿un interruptor guarda solo?
  await open('ai');
  const chk = m.getByLabel('Escribir el informe del gerente automáticamente el día 1');
  out('interruptor IA existe', await chk.count());
  if (await chk.count()) {
    const before = await chk.isChecked();
    n = log.requests.length;
    await chk.click(); await page.waitForTimeout(1800);
    out('red tras cambiar interruptor IA', log.requests.slice(n).filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.url} ${r.status}`));
    out('alertas', [...new Set(await page.locator('[role=alert],[role=status]').allInnerTexts())].filter((t) => t && !/Periodo/.test(t)));
    out('botones de guardar en IA', await m.locator('button:visible').evaluateAll((els) => els.map((e) => e.innerText.trim()).filter((t) => /Guardar|Aplicar/.test(t))));
    if ((await chk.isChecked()) !== before) { await chk.click(); await page.waitForTimeout(1500); }
    out('restaurado', (await chk.isChecked()) === before);
  }
  // 4) Secuencias: próximo número 0
  await open('sequences');
  const nextInputs = m.locator('table input[type=number]');
  out('inputs secuencia', await nextInputs.count());
  await nextInputs.first().fill('0'); await page.waitForTimeout(400);
  const rowSave = m.locator('table tr').nth(1).getByRole('button', { name: 'Guardar' });
  out('guardar fila habilitado con 0', await rowSave.isEnabled());
  out('mensaje', (await m.locator('table tr').nth(1).innerText()).replace(/\s+/g, ' '));
  await snap(page, 'config/X-secuencia-cero');
  await nextInputs.first().fill('1'); await page.waitForTimeout(300);
  // 5) Roles: líneas de la tabla
  await open('roles');
  out('celdas de acciones (bordes)', await m.locator('table tbody tr').first().locator('td').evaluateAll((tds) => tds.map((t) => `${Math.round(t.getBoundingClientRect().width)}px ${getComputedStyle(t).borderBottomWidth} ${getComputedStyle(t).display}`)));
  out('iconos deshabilitados con title', await m.locator('table button[disabled]').evaluateAll((b) => b.slice(0, 3).map((x) => [x.getAttribute('title'), x.getAttribute('aria-label')])));
  // 6) Usuarios: rol mostrado
  await open('users');
  out('roles en tabla de usuarios', await m.locator('table tbody tr td:nth-child(4)').allInnerTexts());
  // 7) Seguridad: 2FA checkbox
  await open('security');
  out('checkbox 2FA', await m.getByLabel('Exigir segundo factor a todos los miembros').evaluate((e) => ({ disabled: e.disabled, checked: e.checked })).catch((e) => e.message.slice(0, 60)));
  // 8) Extensiones: texto «a la derecha»
  await open('extensions');
  out('posicion panel registrar vs vacio', await m.evaluate((root) => { const t = [...root.querySelectorAll('*')].find((e) => /Registra una a la derecha/.test(e.textContent) && e.children.length === 0); const r = [...root.querySelectorAll('*')].find((e) => /^Registrar extensión$/.test(e.textContent.trim())); return { vacio: t?.getBoundingClientRect().toJSON?.() && [Math.round(t.getBoundingClientRect().x), Math.round(t.getBoundingClientRect().y)], registrar: r && [Math.round(r.getBoundingClientRect().x), Math.round(r.getBoundingClientRect().y)] }; }));
  // 9) Botón Atrás del navegador
  await open('accounting'); await open('taxes'); await open('sequences');
  await page.goBack(); await page.waitForTimeout(1500);
  out('tras Atrás 1', [page.url(), await m.locator('h1').first().innerText().catch(() => 'modal cerrado')]);
  await page.goBack(); await page.waitForTimeout(1500);
  out('tras Atrás 2', [page.url(), await m.locator('h1').first().innerText().catch(() => 'modal cerrado')]);
  // 10) Recarga con modal abierto
  await page.reload(); await page.waitForTimeout(4000);
  out('tras recarga', [page.url(), await page.locator('.sm-panel h1').first().innerText().catch(() => 'modal cerrado')]);
  // 11) Correo saliente: dominio del remitente
  await open('smtp');
  out('remitente', (await m.innerText()).match(/<[^>]+>/)?.[0]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
