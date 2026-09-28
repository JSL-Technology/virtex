const { launch, instrument, uiLogin, shot, netSince } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  for (const nm of ['Crear Nuevo', 'Notificaciones', 'Menú']) {
    const n = log.requests.length; const before = await page.locator('body *').count();
    await page.getByRole('button', { name: nm, exact: true }).first().click({ timeout: 5000 }).catch((e) => console.log(nm, 'EXC', e.message.split('\n')[0]));
    await page.waitForTimeout(1500);
    const after = await page.locator('body *').count();
    const vis = await page.evaluate(() => [...document.querySelectorAll('[role=menu],[role=dialog],.cdk-overlay-pane,[class*=dropdown],[class*=popover],[class*=panel]')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.className.toString().slice(0, 40) + ':' + e.innerText.slice(0, 80).replace(/\n+/g, ' ')).slice(0, 4));
    console.log(`[${nm}] nodos ${before}->${after} red=${netSince(log, n).join(' ; ').slice(0, 200)} visibles=${JSON.stringify(vis)}`);
    await shot(page, `f-chrome2-${nm.replace(/ /g, '')}`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  }
  await browser.close();
})();
