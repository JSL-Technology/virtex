const { launch, instrument, uiLogin, snap, go, panel, panelText, netSince, api, BASE } = require('./lib.cjs');
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v).slice(0, 900)}`);
const TOKEN = process.argv[2];
const CREDS = { email: 'qa7734.consulta@example.test', password: 'QA-7734-Consulta-2026!' };
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  if (TOKEN) {
    await page.goto(`${BASE}/es/auth/set-password#token=${TOKEN}`, { waitUntil: 'load' }); await page.waitForTimeout(2500);
    const pw = page.locator('input[type=password]');
    await pw.nth(0).fill(CREDS.password); if ((await pw.count()) > 1) await pw.nth(1).fill(CREDS.password);
    await page.getByRole('button', { name: /Establecer|Guardar|Activar|Crear|Continuar|Confirmar/ }).last().click();
    await page.waitForTimeout(12000);
    out('tras set-password', page.url());
  }
  if (!TOKEN) await uiLogin(page, CREDS).catch((e) => out('login', e.message.split('\n')[0]));
  out('url', page.url());
  await page.goto(BASE + '/e/virtex-dev/inventory/adjustments', { waitUntil: 'load' }); await page.waitForTimeout(5000);
  out('url lista', page.url());
  await snap(page, '60-restringido-lista');
  out('lista', (await panelText(page)).slice(0, 600));
  out('boton nuevo', await panel(page).getByText('Nuevo ajuste').count());
  await go(page, 'inventory/adjustments/new'); await page.waitForTimeout(2500);
  await snap(page, '61-restringido-nuevo-url-directa');
  out('nuevo directo', (await panelText(page)).slice(0, 500));
  const list = await api(page, 'GET', '/inventory/adjustments?status=DRAFT');
  const d = (list.body.items || list.body)[0];
  await go(page, `inventory/adjustments/${d.id}`); await page.waitForTimeout(2500);
  await snap(page, '62-restringido-borrador');
  out('borrador acciones', await panel(page).locator('button:visible').allInnerTexts());
  const n = log.requests.length;
  const post = panel(page).getByRole('button', { name: 'Contabilizar' });
  if (await post.count()) { await post.click(); await page.waitForTimeout(700); await page.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: 'Contabilizar' }).last().click().catch(() => {}); await page.waitForTimeout(2500); }
  await snap(page, '63-restringido-contabilizar');
  out('red', netSince(log, n));
  out('alertas', [...new Set(await page.locator('[role=alert]').allInnerTexts())]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
