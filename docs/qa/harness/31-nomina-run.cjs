const { launch, instrument, uiLogin: _ul, shot, go, click, fill, panel, panelText, netSince, stepUpAll: stepUp, toasts, errorsShown } = require('./lib.cjs');
const uiLogin = (pg) => _ul(pg, process.env.AS ? { email: process.env.AS, password: 'QA-Valid-Pass-2026!' } : undefined);
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
  await uiLogin(page);
  const p = panel(page);
  const dump = async (tag, n) => { await page.waitForTimeout(5000); console.log(`[${tag}] red=${netSince(log, n).map((x) => x.slice(0, 90)).join(' ; ')}\n   err=${JSON.stringify(await errorsShown(page))}\n   texto=${(await panelText(page)).replace(/\n+/g, ' | ').slice(0, 900)}\n   botones=${JSON.stringify((await p.getByRole('button').allInnerTexts()).filter(Boolean))}`); await shot(page, `f-nom-${tag}`); };
  await go(page, 'payroll/runs');
  let n = log.requests.length;
  if (!process.env.SKIP_CREATE) {
    await click(page, 'Nueva nómina');
    const mes = p.locator('input[type=number]').nth(1); await mes.fill('9');
    await click(page, 'Crear', { exact: true });
    console.log('DIALOGOS-STEPUP', await stepUp(page)); await dump('crear', n);
  }
  n = log.requests.length;
  await p.getByRole('link', { name: '2026-09' }).click(); await page.waitForTimeout(2000);
  console.log('DIALOGOS-STEPUP', await stepUp(page)); await dump('abrir', n);
  // Reabrir con el step-up vigente: cerrar la pestaña atascada y volver por la URL del documento
  const runUrl = page.url().split('/e/virtex-dev/')[1];
  console.log('TABS', JSON.stringify(await page.locator('.dv-tab').allInnerTexts()));
  const active = page.locator('.dv-tab.dv-active-tab, .dv-tab[aria-selected=true]').first();
  await active.hover().catch(() => {}); await active.locator('[class*=close]').first().click().catch((e) => console.log('no cierra', e.message.split('\n')[0]));
  await page.waitForTimeout(1000);
  console.log('TABS2', JSON.stringify(await page.locator('.dv-tab').allInnerTexts()));
  n = log.requests.length; await go(page, runUrl); console.log('DIALOGOS-STEPUP-2', await stepUp(page)); await dump('reabrir', n);
  for (const b of ['Registrar pago', 'Pagar', 'Marcar como pagada',  'Aprobar', 'Contabilizar', 'Registrar pago', 'Pagar', 'Cerrar']) {
    const btn = p.getByRole('button', { name: new RegExp(`^\\s*${b}`, 'i') });
    if (!(await btn.count())) continue;
    n = log.requests.length;
    await btn.first().click();
    await page.waitForTimeout(800);
    const dlgs = page.locator('[role=dialog], [role=alertdialog], .cdk-overlay-pane, dialog');
    console.log('DLG-COUNT', await dlgs.count(), JSON.stringify(await dlgs.allInnerTexts()).slice(0, 300));
    const confirmBtn = page.locator('[role=dialog] button, [role=alertdialog] button, .cdk-overlay-pane button, dialog button').filter({ hasText: new RegExp(`^\\s*(Aceptar|Confirmar|${b})\\s*$`) });
    console.log('CONFIRM-BTNS', await confirmBtn.count());
    if (await confirmBtn.count()) await confirmBtn.last().click({ timeout: 2500 }).catch((e) => console.log('ERR-CONF', e.message.split('\n')[0]));
    await stepUp(page);
    await dump(b, n);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
