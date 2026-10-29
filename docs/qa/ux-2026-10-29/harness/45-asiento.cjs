const { session, MX, shot, panel, fields, errors, text, go, resetThrottle } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, log, close } = await session('state-mx.json', MX);
  await go(page, 'accounting/journal-entries'); await panel(page).getByRole('button', { name: /Nuevo asiento/ }).or(panel(page).getByRole('link', { name: /Nuevo asiento/ })).first().click(); await page.waitForTimeout(2500);
  console.log('URL', page.url()); await shot(page, 'T-je-1-form', true);
  console.log((await text(page)).replace(/\nPAB[\s\S]*?yuan renminbi/, '[monedas]').slice(0, 1500)); console.log((await fields(page)).join('\n'));
  const P = panel(page);
  // Intentar guardar descuadrado
  const accts = P.getByPlaceholder(/cuenta/i);
  console.log('n account inputs', await accts.count());
  await accts.nth(0).click(); await page.waitForTimeout(800); console.log('opts sin teclear', (await page.locator('[role=option]').allInnerTexts()).slice(0, 12)); await page.keyboard.type('Caja', { delay: 40 }); await page.waitForTimeout(1000); console.log('opts Caja', (await page.locator('[role=option]').allInnerTexts()).slice(0, 4)); await page.keyboard.press('Control+A'); await page.keyboard.type('Banco', { delay: 40 }); await page.waitForTimeout(1000); console.log('opts Banco', (await page.locator('[role=option]').allInnerTexts()).slice(0, 4)); await page.locator('[role=option]').first().click().catch(() => {});
  const nums = P.locator('input[type=number], input[inputmode=decimal]'); console.log('num inputs', await nums.count());
  await nums.nth(0).fill('1000'); await page.waitForTimeout(300);
  await accts.nth(1).click(); await page.keyboard.type('Capital', { delay: 40 }); await page.waitForTimeout(1000); console.log('opts2', (await page.locator('[role=option]').allInnerTexts()).slice(0, 4)); await page.locator('[role=option]').first().click().catch(() => {});
  await nums.nth(3).fill('900'); await page.waitForTimeout(500);
  await shot(page, 'T-je-2-descuadrado', true); console.log('totales:', (await text(page)).split(/Totales|Total/).slice(-1)[0].slice(0, 300));
  const btns = (await P.getByRole('button').allInnerTexts()).map(s => s.trim()).filter(Boolean); console.log('botones', btns);
  const save = P.getByRole('button', { name: /Contabilizar|Guardar|Registrar/ }).last(); console.log('save', await save.innerText(), 'enabled', await save.isEnabled(), 'title', await save.getAttribute('title'));
  if (await save.isEnabled()) { await save.click(); await page.waitForTimeout(2000); console.log('descuadrado →', await errors(page)); }
  await nums.nth(3).fill('1000'); await page.waitForTimeout(500);
  const desc = P.getByLabel(/Descripción|Concepto/).first(); if (await desc.count()) await desc.fill('QA-Aporte inicial de capital'); await P.getByLabel(/Diario/).first().selectOption({ label: 'Diario general' });
  if (await save.isEnabled()) { await save.click(); await page.waitForTimeout(3000); }
  console.log('cuadrado →', page.url(), await errors(page)); await shot(page, 'T-je-3-guardado', true);
  console.log(log.req.filter(r => /journal/.test(r)).slice(-4).join('\n'));
  await close();
})();
