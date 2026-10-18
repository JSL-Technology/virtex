const { launch, login, shot } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await login(page);
  await page.mouse.click(700, 160); // foco en el cuerpo
  const seq = [];
  for (let i = 0; i < 45; i++) {
    await page.keyboard.press('Tab'); await page.waitForTimeout(120);
    const f = await page.evaluate(() => { const e = document.activeElement; if (!e) return null; const s = getComputedStyle(e); const r = e.getBoundingClientRect();
      const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
      return `${e.tagName.toLowerCase()} "${(e.getAttribute('aria-label') || e.innerText || e.title || '').trim().slice(0, 30)}" @${Math.round(r.x)},${Math.round(r.y)} ring=${ring} vis=${r.width > 0 && r.y < innerHeight && r.y > -5}`; });
    seq.push(f);
    if ([3, 10, 20, 30].includes(i)) await shot(page, `K-foco-${i}`);
  }
  console.log(seq.map((s, i) => i + ' ' + s).join('\n'));
  // Atajos
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k'); await page.waitForTimeout(800); await shot(page, 'K-ctrl-k');
  console.log('tras Ctrl+K activo:', await page.evaluate(() => document.activeElement?.getAttribute('placeholder') || document.activeElement?.tagName));
  await page.keyboard.press('Escape');
  await page.keyboard.press('?'); await page.waitForTimeout(800); await shot(page, 'K-atajos');
  console.log('dialogs:', (await page.locator('[role=dialog]').allInnerTexts()).map(t => t.slice(0, 400)));
  await browser.close();
})();
