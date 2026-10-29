const { launch, uiLogin, snap, go, panel, panelText } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await uiLogin(page); await go(page, 'inventory/adjustments');
  for (const [lang, code] of [['English', 'en'], ['Português', 'pt'], ['Español', 'es']]) {
    await page.locator('header').getByText(/Dev User/).click(); await page.waitForTimeout(500);
    await page.getByRole('radio', { name: lang }).or(page.locator('button').filter({ hasText: new RegExp('^\\s*' + lang + '\\s*$') })).first().click(); await page.waitForTimeout(1500);
    await page.keyboard.press('Escape');
    if (code === 'es') break;
    const AJ1 = '692c79ff-fc82-46c9-94f5-f5eadb8296ec';
    for (const [p, nm] of [['inventory/adjustments/new', 'inv-nuevo'], [`inventory/adjustments/${AJ1}`, 'inv-contab'], ['accounting/audit-adjustments/new', 'aud-nuevo']]) {
      await go(page, p); await page.waitForTimeout(2500);
      await panel(page).locator('button[type=submit]').click().catch(() => {}); await page.waitForTimeout(800);
      await snap(page, `I-${code}-${nm}`);
      const t = await panelText(page);
      const es = (t.match(/\b(Ajuste|Almacén|Motivo|Contado|Cambio|Líneas|Guardar|Ejercicio|Diario|Débito|Crédito|obligatorio|Revisa)\b/g) || []);
      const raw = (t.match(/\b[a-z_]+\.[a-z_]+(\.[a-z_]+)+\b/g) || []);
      console.log(code, nm, 'ES:', JSON.stringify([...new Set(es)]), 'RAW:', JSON.stringify(raw.slice(0, 5)), '|', t.replace(/\s+/g, ' ').slice(0, 260));
    }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
