const { launch, instrument, uiLogin, go } = require('./lib.cjs');
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v)}`);
const DIR = __dirname + '/../capturas/config';
(async () => {
  const { browser } = await launch();
  // Admin: oscuro y 1366
  let ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'es-ES', colorScheme: 'dark' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  let page = await ctx.newPage();
  await uiLogin(page); await go(page, 'overview');
  const open = async (p, s) => { await p.evaluate((s) => { location.hash = 'settings/' + s; }, s); await p.locator('.sm-panel').waitFor(); await p.waitForTimeout(2200); };
  for (const s of ['accounting', 'branding', 'security', 'roles']) {
    await open(page, s);
    await page.screenshot({ path: `${DIR}/Y-1366-oscuro-${s}.png` });
    const r = await page.evaluate(() => { const b = [...document.querySelectorAll('.sm-panel button')].find((x) => /Guardar cambios/.test(x.innerText)); if (!b) return null; const bb = b.getBoundingClientRect(); return { y: Math.round(bb.y), visibleSinScroll: bb.bottom <= innerHeight }; });
    out(`guardar 1366 ${s}`, r);
  }
  await ctx.close();
  // Restringido: intentar guardar Contabilidad
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page = await ctx.newPage(); const log = instrument(page);
  await uiLogin(page, { email: 'qa7734.consulta@example.test', password: 'QA-7734-Consulta-2026!' }); await go(page, 'overview');
  await open(page, 'accounting');
  out('restringido contabilidad: errores de carga', log.requests.filter((x) => typeof x.status === 'number' && x.status >= 400).map((x) => `${x.method} ${x.url} ${x.status}`));
  const plazo = page.locator('.sm-panel').getByLabel(/Plazo de pago/);
  out('campo editable', await plazo.isEditable().catch(() => 'no existe'));
  if (await plazo.count()) {
    await plazo.fill('7');
    const n = log.requests.length;
    await page.locator('.sm-panel').getByRole('button', { name: 'Guardar cambios' }).click().catch(() => {}); await page.waitForTimeout(2000);
    out('red guardar restringido', log.requests.slice(n).map((x) => `${x.method} ${x.url} ${x.status}`));
    out('alertas', [...new Set(await page.locator('[role=alert]').allInnerTexts())].filter(Boolean));
    await page.screenshot({ path: `${DIR}/Y-restringido-guardar-contabilidad.png` });
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
