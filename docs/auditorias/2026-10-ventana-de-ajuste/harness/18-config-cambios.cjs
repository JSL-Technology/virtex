const { launch, instrument, uiLogin, snap, go } = require('./lib.cjs');
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v)}`);
const CREDS = process.env.RESTRINGIDO ? { email: 'qa7734.consulta@example.test', password: 'QA-7734-Consulta-2026!' } : undefined;
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page, CREDS); await go(page, 'overview');
  const open = async (s) => { await page.evaluate((s) => { location.hash = 'settings/' + s; }, s); await page.locator('.sm-panel').waitFor(); await page.waitForTimeout(2000); };
  await open('profile');
  if (CREDS) { await snap(page, 'C-restringido'); out('secciones visibles restringido', await page.locator('.sm-panel .nav-link').allInnerTexts()); out('contenido', (await page.locator('.sm-panel').innerText()).slice(0, 600)); await browser.close(); return; }
  const modal = page.locator('.sm-panel');
  out('title en navs truncados', await modal.locator('.nav-link').evaluateAll((els) => els.filter((e) => { const s = e.querySelector('span'); return s && s.scrollWidth > s.clientWidth; }).map((e) => [e.innerText.trim(), e.getAttribute('title') || e.querySelector('span').getAttribute('title')])));
  const web = modal.getByLabel('Sitio web');
  const orig = await web.inputValue();
  // 1) cambiar y navegar a otra sección
  await web.fill('https://qa-7734.example.test');
  out('boton guardar habilitado', await modal.getByRole('button', { name: 'Guardar cambios' }).isEnabled());
  await modal.locator('.nav-link').filter({ hasText: 'Sucursales' }).click(); await page.waitForTimeout(1500);
  out('dialogo al cambiar de sección', await page.locator('.cdk-overlay-container [role=dialog], [role=alertdialog]').allInnerTexts());
  await open('profile');
  out('valor tras cambiar de sección y volver', await modal.getByLabel('Sitio web').inputValue());
  // 2) cambiar y clic en el fondo
  await modal.getByLabel('Sitio web').fill('https://qa-7734-b.example.test');
  await page.mouse.click(60, 880); await page.waitForTimeout(1200);
  out('modal abierto tras clic en fondo', await page.locator('.sm-panel').count());
  out('dialogo tras clic en fondo', await page.locator('[role=alertdialog]').allInnerTexts());
  await open('profile');
  out('valor tras clic en fondo', await modal.getByLabel('Sitio web').inputValue());
  // 3) guardar, comprobar persistencia tras recarga y restaurar
  await modal.getByLabel('Sitio web').fill('https://qa-7734.example.test');
  await modal.getByRole('button', { name: 'Guardar cambios' }).click(); await page.waitForTimeout(2500);
  out('alertas guardar', [...new Set(await page.locator('[role=alert]').allInnerTexts())].filter(Boolean));
  out('red guardar', log.requests.filter((r) => r.method !== 'GET').slice(-3).map((r) => `${r.method} ${r.url} ${r.status} ${r.body}`));
  await snap(page, 'C-perfil-guardado');
  await page.reload(); await page.waitForTimeout(4000);
  await page.locator('.sm-panel').waitFor().catch(() => {});
  out('url tras recarga', page.url());
  out('valor tras recarga', await page.locator('.sm-panel').getByLabel('Sitio web').inputValue().catch(() => 'modal no abierto'));
  await page.locator('.sm-panel').getByLabel('Sitio web').fill(orig);
  await page.locator('.sm-panel').getByRole('button', { name: 'Guardar cambios' }).click(); await page.waitForTimeout(2500);
  out('restaurado a', JSON.stringify(orig));
  out('alertas restaurar', [...new Set(await page.locator('[role=alert]').allInnerTexts())].filter(Boolean));
  // tamaños
  for (const [w, h, nm] of [[1366, 768, '1366'], [768, 1024, 'tableta'], [375, 812, 'movil']]) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(900); await snap(page, `C-cfg-${nm}`); out('scroll horizontal ' + nm, await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)); }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
