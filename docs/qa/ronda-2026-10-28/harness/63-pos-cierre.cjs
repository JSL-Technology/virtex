const { launch, instrument, shot, ADMIN, netSince } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.goto('http://localhost:4300/login'); await page.waitForTimeout(2500);
  await page.locator('[data-testid=login-email]').fill(ADMIN.email); await page.locator('[data-testid=login-password]').fill(ADMIN.password); await page.locator('[data-testid=login-submit]').click(); await page.waitForTimeout(5000);
  const dlg = () => page.locator('[role=dialog]').last();
  const D = async () => (await dlg().innerText().catch(() => '')).replace(/\s+/g, ' ');
  const sale = async (name, method, extra) => {
    const n = log.requests.length;
    await page.getByRole('button', { name: /QA3-7734/ }).click(); await page.waitForTimeout(300);
    await page.locator('[data-testid=pos-charge]').click(); await page.waitForTimeout(800);
    await dlg().getByRole('radio', { name: method }).click(); await page.waitForTimeout(500);
    console.log(`  [${name}] form: ${(await D()).slice(0, 400)}`);
    if (extra) await extra();
    const c = dlg().locator('[data-testid=pos-pay-confirm]'); console.log(`  [${name}] confirm deshab=${await c.isDisabled()}`);
    if (!(await c.isDisabled())) { await c.click(); await page.waitForTimeout(2500); }
    console.log(`  [${name}] red=${JSON.stringify(netSince(log, n)).slice(0, 400)} → ${(await D()).slice(0, 200)}`);
    await shot(page, `posc-${name}`);
    const nv = page.locator('[data-testid=pos-new-sale]'); if (await nv.count()) { await page.getByRole('button', { name: 'Imprimir ticket' }).click().catch(() => {}); await page.waitForTimeout(1000); console.log('  print', await page.evaluate(() => window.__printed)); await nv.click(); }
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  };
  await sale('tarjeta', /Tarjeta/);
  await sale('transferencia', /Transferencia/, async () => { const r = dlg().locator('input[type=text]').first(); if (await r.count()) await r.fill('TRF-QA3-POS-1'); });
  await sale('mixto', /Mixto/, async () => { const ins = dlg().locator('input'); console.log('   mixto inputs', await ins.count()); if (await ins.count() >= 2) { await ins.nth(0).fill('1000'); await ins.nth(1).fill('475'); } });
  // Cierre
  await page.locator('[data-testid=pos-close-shift]').click(); await page.waitForTimeout(1500);
  console.log('X', (await D()).slice(0, 800));
  await page.locator('[data-testid=pos-counted-cash]').fill('2950'); await page.waitForTimeout(500);
  console.log('ARQUEO', (await D()).match(/ARQUEO.*$/)?.[0].slice(0, 300));
  const n = log.requests.length;
  await page.locator('[data-testid=pos-confirm-close]').click(); await page.waitForTimeout(3000);
  console.log('CIERRE red', JSON.stringify(netSince(log, n)).slice(0, 500));
  console.log('Z', (await D()).slice(0, 900));
  await shot(page, 'posc-z');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
