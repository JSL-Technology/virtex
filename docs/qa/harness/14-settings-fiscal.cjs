const { launch, instrument, uiLogin, shot, netSince } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  const secs = ['billing','accounting','currencies','taxes','closing-rules','intercompany','sequences','approvals','inventory-policies','security','integrations','smtp'];
  for (const s of secs) {
    await page.evaluate((h) => { location.hash = h; }, `settings/${s}`);
    await page.waitForTimeout(1500);
    const t = await page.locator('[role=dialog]').last().innerText().catch(() => '');
    console.log(s, /EN DESARROLLO/i.test(t) ? 'PLACEHOLDER' : 'contenido', '|', t.split('\n').slice(22, 26).join(' / ').slice(0, 160));
  }
  await page.evaluate(() => { location.hash = 'settings/fiscal'; });
  await page.waitForTimeout(2000);
  const txt = await page.locator('[role=dialog]').last().innerText();
  console.log('FISCAL-TEXT', txt.slice(txt.indexOf('Certificado digital')).slice(0, 2500));
  const ctrls = await page.locator('[role=dialog]').last().locator('input, select, textarea, button').evaluateAll((els) => els.map((e) => `${e.tagName}:${e.type}:${(e.innerText || e.placeholder || e.name || e.getAttribute('formcontrolname') || '').trim().slice(0, 40)}`));
  console.log('CTRLS', JSON.stringify(ctrls.slice(20)));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
