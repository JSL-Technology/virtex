const { launch, login, shot, instrument } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page);
  const hdrBtns = await page.locator('header button').evaluateAll(bs => bs.map(b => `aria="${b.getAttribute('aria-label')||''}" title="${b.title||''}" text="${b.innerText.trim().slice(0,20)}"`));
  console.log('HEADER BUTTONS', hdrBtns);
  // búsqueda
  const s = page.getByPlaceholder('Buscar facturas, clientes, productos…'); await s.click(); await page.waitForTimeout(800);
  await shot(page, 'H-1-busqueda-vacia');
  await s.pressSequentially('martillo', { delay: 60 }); await page.waitForTimeout(2000);
  await shot(page, 'H-2-busqueda-martillo');
  console.log('RESULTADOS martillo:', (await page.locator('[role=listbox], [role=dialog], .search-results, .cdk-overlay-container').allInnerTexts()).join(' || ').slice(0, 800));
  await s.fill('B0200000001'); await page.waitForTimeout(2000);
  await shot(page, 'H-3-busqueda-ncf');
  console.log('RESULTADOS NCF:', (await page.locator('[role=listbox], [role=dialog], .search-results, .cdk-overlay-container').allInnerTexts()).join(' || ').slice(0, 600));
  await s.fill('xyzqwerty'); await page.waitForTimeout(2000);
  await shot(page, 'H-4-busqueda-sin-resultados');
  console.log('RESULTADOS nada:', (await page.locator('[role=listbox], [role=dialog], .search-results, .cdk-overlay-container').allInnerTexts()).join(' || ').slice(0, 300));
  await page.keyboard.press('Escape');
  // botón +
  await page.locator('header button').nth(2).click().catch(()=>{}); await page.waitForTimeout(1000);
  await shot(page, 'H-5-boton-mas');
  console.log('MAS:', (await page.locator('.cdk-overlay-container, [role=menu]').allInnerTexts()).join(' | ').slice(0, 500));
  await page.keyboard.press('Escape');
  // notificaciones
  await page.locator('header button').nth(3).click().catch(()=>{}); await page.waitForTimeout(1000);
  await shot(page, 'H-6-notificaciones');
  console.log('NOTIF:', (await page.locator('.cdk-overlay-container, [role=dialog], [role=menu]').allInnerTexts()).join(' | ').slice(0, 500));
  await page.keyboard.press('Escape');
  // tema: ciclo
  const t = page.locator('header button[aria-label*="tema"], header button[title*="tema"]').first();
  for (let i = 0; i < 3; i++) { const lbl = await t.getAttribute('aria-label'); await t.click(); await page.waitForTimeout(800); console.log('tema clic', i, 'antes:', lbl, '-> html attr:', await page.evaluate(() => document.documentElement.getAttribute('data-theme') + ' / ' + document.documentElement.className)); await shot(page, `H-7-tema-${i}`); }
  // offline
  await context.setOffline(true); await page.waitForTimeout(3000);
  await shot(page, 'H-8-offline');
  await page.locator('a').filter({ hasText: /^\s*Inicio\s*$/ }).first().click().catch(()=>{}); await page.waitForTimeout(2000);
  console.log('OFFLINE banner:', (await page.locator('body').innerText()).match(/(sin conexión|desconectad|offline)[^\n]*/i)?.[0]);
  await context.setOffline(false); await page.waitForTimeout(3000);
  await shot(page, 'H-9-online');
  await browser.close();
})();
