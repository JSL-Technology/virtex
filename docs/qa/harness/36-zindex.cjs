const { launch, uiLogin, shot } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await uiLogin(page);
  await page.evaluate(() => { location.hash = 'settings/users'; }); await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Invitar Usuario/ }).click(); await page.waitForTimeout(1000);
  await page.getByPlaceholder('Seleccionar rol').click({ force: true }); await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const o = document.querySelectorAll('[role=option]')[2]; const b = o.getBoundingClientRect();
    const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    const z = (el) => { const out = []; while (el) { const s = getComputedStyle(el); if (s.zIndex !== 'auto') out.push(`${el.className}:${s.zIndex}`); el = el.parentElement; } return out.slice(0, 3); };
    return { option: o.innerText, box: [b.x, b.y, b.width, b.height], topmost: top && (top.className || top.tagName), optionZ: z(o), topZ: z(top) };
  });
  console.log(JSON.stringify(r, null, 1));
  await shot(page, 'f-zindex-rol');
  await browser.close();
})();
