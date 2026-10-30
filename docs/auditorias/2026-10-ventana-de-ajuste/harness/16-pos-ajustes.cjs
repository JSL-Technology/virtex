const { launch, instrument, snap } = require('./lib.cjs');
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v).slice(0, 1500)}`);
const POS = 'http://localhost:4300';
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await page.goto(POS, { waitUntil: 'load' }); await page.waitForTimeout(3000);
  out('url', page.url());
  await page.locator('input[type=email], input[name=email], input[autocomplete=username]').first().fill('dev@virtex.local');
  await page.locator('input[type=password]').first().fill('QA-Ajuste-2026!');
  await page.locator('button[type=submit]').first().click(); await page.waitForTimeout(4000);
  out('tras login', page.url());
  await snap(page, '90-pos-terminal');
  const btn = page.getByRole('button', { name: 'Ajustes de la caja' });
  out('boton ajustes', await btn.count());
  await btn.click(); await page.waitForTimeout(1000);
  const dlg = page.locator('[role=dialog]').last();
  await snap(page, '91-pos-ajustes');
  out('dialogo', await dlg.innerText());
  out('dialogo aria', await dlg.evaluate((d) => ({ role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), label: d.getAttribute('aria-label') || d.getAttribute('aria-labelledby'), tag: d.tagName })));
  out('foco inicial', await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
  out('input label', await dlg.locator('input[type=text]').evaluate((e) => ({ labelled: !!e.closest('label'), value: e.value })));
  // Valor inválido
  const t = dlg.locator('input[type=text]');
  const orig = await t.inputValue();
  await t.fill('CAJA 1 ñ'); await page.waitForTimeout(300);
  out('guardar deshabilitado con invalido', await dlg.getByRole('button', { name: 'Guardar' }).isDisabled());
  out('mensaje de error visible', (await dlg.innerText()).match(/inválid|no es válid|solo letras|caracter/i)?.[0] || 'ninguno');
  await snap(page, '92-pos-ajustes-invalido');
  // Escape con cambios
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  out('dialogos abiertos tras Escape', await page.locator('[role=dialog]').count());
  // Reabrir: valor restaurado?
  await btn.click(); await page.waitForTimeout(800);
  out('valor al reabrir', await page.locator('[role=dialog] input[type=text]').last().inputValue());
  // trampa de foco
  let fuera = 0; for (let i = 0; i < 20; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')))) fuera++; }
  out('tabs fuera del dialogo (de 20)', fuera);
  // Cambiar auto-imprimir y guardar; ¿llega al servidor?
  const n = log.requests.length;
  await page.locator('[role=dialog] input[type=checkbox]').last().click();
  await page.locator('[role=dialog]').last().getByRole('button', { name: 'Guardar' }).click(); await page.waitForTimeout(1200);
  out('toast', await page.locator('[role=status], [role=alert], [class*=toast]').allInnerTexts());
  out('red al guardar', log.requests.slice(n).map((r) => `${r.method} ${r.url} ${r.status}`));
  out('localStorage', await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => /pos|terminal|print/i.test(k)).map((k) => [k, localStorage.getItem(k)]))));
  // restaurar
  await btn.click(); await page.waitForTimeout(800); await page.locator('[role=dialog] input[type=checkbox]').last().click(); await page.locator('[role=dialog]').last().getByRole('button', { name: 'Guardar' }).click();
  for (const [w, h, nm] of [[1366, 768, '1366'], [375, 812, 'movil']]) { await page.setViewportSize({ width: w, height: h }); await btn.click().catch(() => {}); await page.waitForTimeout(800); await snap(page, `93-pos-ajustes-${nm}`); await page.keyboard.press('Escape'); }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
