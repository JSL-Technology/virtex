// Igual que 14-configuracion.cjs, sobre la sección que sustituye a «Políticas de inventario».
process.env.CAP_DIR = process.env.CAP_DIR || 'capturas-despues';
const { launch, instrument, uiLogin, snap, go, netSince, api } = require('./lib.cjs');
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v).slice(0, 1500)}`);
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page);
  await go(page, 'inventory/adjustments');
  // Entrada: menú de usuario › Configuración
  await page.locator('header').getByText('Dev User').click(); await page.waitForTimeout(800);
  await snap(page, '80-menu-usuario');
  await page.locator(':is(a,button,[role=menuitem]):visible').filter({ hasText: /^\s*Configuración\s*$/ }).first().click(); await page.waitForTimeout(2500);
  out('url modal', page.url());
  const modal = page.locator('.sm-panel');
  await snap(page, '81-config-abierta');
  out('grupos y secciones', await modal.locator('.sm-nav').innerText());
  out('buscador', await modal.locator('input[type=search], input[placeholder*=usca]').count());
  out('foco inicial', await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
  out('aria-current', await modal.locator('.nav-link[aria-current]').count());
  // Políticas de inventario
  // El enlace de siempre sigue funcionando: lleva a Cuentas predeterminadas › Inventario.
  await page.evaluate(() => { location.hash = 'settings/inventory-policies'; });
  await page.waitForTimeout(2500);
  out('url seccion', page.url());
  await snap(page, '82-config-politicas-inventario');
  out('seccion', (await modal.locator('.sm-content, .sm-main, main').first().innerText().catch(() => modal.innerText())).slice(0, 1500));
  const adjBox = modal.locator('#settings-block-inventory [role=combobox]').filter({ hasText: '' }).nth(1);
  out('combobox ajuste', await adjBox.count());
  const before = await adjBox.inputValue().catch(() => null);
  out('valor actual', before);
  // Cambiar y salir con Escape sin guardar
  await adjBox.click(); await adjBox.fill('otros'); await page.waitForTimeout(1300);
  out('opciones', await page.locator('[role=option]').allInnerTexts());
  await page.locator('[role=option]').first().click().catch(() => {}); await page.waitForTimeout(500);
  await snap(page, '83-config-cambio-sin-guardar');
  out('botones', await modal.locator('button:visible').allInnerTexts().then((a) => a.filter(Boolean).slice(-6)));
  await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
  out('tras Escape url', page.url());
  out('dialogo descartar', await page.locator('[role=alertdialog], [role=dialog]').allInnerTexts());
  await snap(page, '84-config-tras-escape');
  // Descartar: nada se guarda.
  await page.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: /Descartar/ }).last().click().catch(() => {});
  await page.waitForTimeout(800);
  // Reabrir: ¿se conservó el cambio?
  await page.evaluate(() => { location.hash = 'settings/inventory-policies'; }); await page.waitForTimeout(2500);
  out('valor al reabrir', await page.locator('.sm-panel').getByRole('combobox', { name: /Ajustes de inventario/ }).inputValue().catch(() => null));
  // Tamaño 1366 y móvil
  await page.setViewportSize({ width: 1366, height: 768 }); await page.waitForTimeout(800); await snap(page, '85-config-1366');
  await page.setViewportSize({ width: 375, height: 812 }); await page.waitForTimeout(800); await snap(page, '86-config-movil');
  await page.setViewportSize({ width: 1440, height: 900 });
  // axe en el modal
  await page.addScriptTag({ path: '/tmp/claude-0/-home-user-virtex/16a56624-fcd2-58a5-a86d-b5fc046524c4/scratchpad/axe/node_modules/axe-core/axe.min.js' });
  out('axe modal', await page.evaluate(async () => { const r = await axe.run(document.querySelector('.sm-panel'), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, ej: v.nodes.slice(0, 3).map((x) => x.target.join(' ')) })); }));
  // Trampa de foco: 60 tabs, ¿sale del modal?
  let escaped = 0; for (let i = 0; i < 60; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement?.closest('.sm-panel')))) escaped++; }
  out('tabs fuera del modal (de 60)', escaped);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
