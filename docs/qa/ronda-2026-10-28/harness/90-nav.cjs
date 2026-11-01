const { launch, instrument, uiLogin, shot, go, panel, panelText, netSince, toasts } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch(); const page = await context.newPage(); const log = instrument(page);
  await uiLogin(page, { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' });
  const p = panel(page);
  const T = async (l = 400) => (await panelText(page)).replace(/\s+/g, ' ').slice(0, l);
  const tabs = async () => page.locator('.dv-tab').evaluateAll((ts) => ts.map((t) => (t.innerText.trim() + (getComputedStyle(t.querySelector('*') || t).fontStyle === 'italic' ? '(i)' : ''))));
  // Mapa de relaciones por número interno
  await go(page, 'reports/relationship-map'); const inp = p.locator('input[type=text], input[type=search]').first(); await inp.fill('FAC-00000001'); await inp.press('Enter'); await page.waitForTimeout(2500);
  console.log('[mapa FAC]', (await T(500)).split('Activo fijo')[1]);
  // Riel: clic simple vs doble (preview)
  await page.getByRole('link', { name: 'Ventas' }).or(page.locator('nav').getByText('Ventas', { exact: true })).first().click(); await page.waitForTimeout(1000);
  console.log('[riel ventas] panel', (await page.locator('nav, aside').nth(1).innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200));
  const before = (await tabs()).length;
  await page.getByText('Cotizaciones', { exact: true }).first().click(); await page.waitForTimeout(1500);
  await page.getByText('Cobranza', { exact: true }).first().click(); await page.waitForTimeout(1500);
  console.log('[preview] tabs', before, '→', JSON.stringify(await tabs()));
  await page.getByText('Cobranza', { exact: true }).first().dblclick(); await page.waitForTimeout(1500);
  console.log('[dblclick fija] tabs', JSON.stringify(await tabs()));
  // Menú contextual en un ítem del menú y en una fila
  await page.getByText('Clientes', { exact: true }).first().click({ button: 'right' }); await page.waitForTimeout(800);
  const cm = page.locator('[role=menu]').last(); console.log('[ctx menú lateral]', (await cm.innerText().catch(() => 'sin menú')).replace(/\s+/g, ' | '));
  await shot(page, 'nav-ctx-menu');
  const fav = cm.getByRole('menuitem', { name: /favorit/i }).first(); let n = log.requests.length; if (await fav.count()) { await fav.click(); await page.waitForTimeout(1500); console.log('   fav red', JSON.stringify(netSince(log, n))); }
  await page.keyboard.press('Escape');
  await go(page, 'invoices'); await page.waitForTimeout(1500);
  await p.locator('tbody tr').first().click({ button: 'right' }); await page.waitForTimeout(800);
  console.log('[ctx fila factura]', (await page.locator('[role=menu]').last().innerText().catch(() => 'sin menú')).replace(/\s+/g, ' | ')); await shot(page, 'nav-ctx-fila');
  await page.keyboard.press('Escape');
  // Favoritos visibles en Mi trabajo
  await page.locator('nav').getByText('Mi trabajo', { exact: true }).first().click(); await page.waitForTimeout(1000);
  console.log('[mi trabajo panel]', (await page.locator('nav, aside').nth(1).innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300));
  // Crear nuevo (+)
  await page.getByRole('button', { name: 'Crear nuevo' }).click(); await page.waitForTimeout(800);
  console.log('[crear nuevo]', (await page.locator('[role=menu], [role=dialog], .cdk-overlay-pane').last().innerText().catch(() => '')).replace(/\s+/g, ' | ').slice(0, 400)); await shot(page, 'nav-crear'); await page.keyboard.press('Escape');
  // Búsqueda global
  const s = page.getByPlaceholder(/Buscar facturas/); await s.fill('QA3-8812'); await page.waitForTimeout(2000);
  console.log('[busqueda]', (await page.locator('[role=listbox], .cdk-overlay-pane, [class*=search-results]').last().innerText().catch(() => '')).replace(/\s+/g, ' | ').slice(0, 500)); await shot(page, 'nav-busqueda');
  await s.fill("' OR 1=1 -- <script>alert(1)</script>"); await page.waitForTimeout(2000); console.log('[busqueda-inyeccion]', (await page.locator('[role=listbox], .cdk-overlay-pane').last().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200));
  await s.press('Escape');
  // Notificaciones
  await page.getByRole('button', { name: 'Notificaciones' }).click(); await page.waitForTimeout(1500);
  console.log('[notif]', (await page.locator('[role=dialog], [role=menu], .cdk-overlay-pane').last().innerText().catch(() => '')).replace(/\s+/g, ' | ').slice(0, 600)); await shot(page, 'nav-notif');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400); console.log('   esc cierra', await page.locator('.cdk-overlay-pane').count());
  // Tema oscuro
  await page.getByRole('button', { name: /tema oscuro/ }).click(); await page.waitForTimeout(800); await shot(page, 'nav-oscuro');
  console.log('[oscuro] bg', await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  await go(page, 'contacts/customers/new'); await page.waitForTimeout(1200); await shot(page, 'nav-oscuro-form');
  await page.getByRole('button', { name: /tema claro|tema/ }).first().click();
  // Volver/Avanzar
  const u1 = page.url(); await page.getByRole('button', { name: 'Volver' }).click(); await page.waitForTimeout(1000); const u2 = page.url(); await page.getByRole('button', { name: 'Avanzar' }).click(); await page.waitForTimeout(1000);
  console.log('[volver/avanzar]', u1.split('/e/')[1], '→', u2.split('/e/')[1], '→', page.url().split('/e/')[1]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
