const { launch, instrument, uiLogin, shot, go, panel, netSince, toasts } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('download', async (d) => console.log('DOWNLOAD', d.suggestedFilename()));
  await uiLogin(page);
  await go(page, 'invoices'); const p = panel(page);
  await p.locator('tbody tr').first().click(); await page.waitForTimeout(2500);
  const detail = page.url().split('/e/virtex-dev/')[1];
  for (const item of []) {
    await go(page, detail);
    const n = log.requests.length;
    await p.getByRole('button', { name: 'Más', exact: true }).click(); await page.waitForTimeout(600);
    await page.getByRole('menuitem', { name: item }).click().catch(async () => page.getByText(item, { exact: true }).last().click());
    await page.waitForTimeout(2000);
    const ov = await page.locator('[role=dialog], .cdk-overlay-pane, [class*=drawer], [class*=panel][class*=open]').last().innerText().catch(() => '');
    console.log(`[Más › ${item}] url=${page.url().split('/e/')[1]} red=${JSON.stringify(netSince(log, n)).slice(0, 300)} toast="${(await toasts(page)).replace(/\s+/g, ' ').slice(-150)}" overlay="${ov.replace(/\s+/g, ' ').slice(0, 300)}"`);
    await shot(page, `facmas-${item.replace(/\W+/g, '_')}`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  }
  // Enviar: vacío (usa correo del cliente), inválido, IA, enviar
  await go(page, detail);
  await p.getByRole('button', { name: 'Enviar', exact: true }).click(); await page.waitForTimeout(800);
  const dlg = page.locator('[role=dialog]').last();
  const to = dlg.locator('input').first();
  await to.fill('no-es-correo'); let n = log.requests.length;
  await to.blur(); await page.waitForTimeout(800); console.log('deshab', await dlg.getByRole('button', { name: 'Enviar', exact: true }).isDisabled());
  console.log('[enviar-invalido]', JSON.stringify(netSince(log, n)), (await dlg.innerText().catch(() => 'cerrado')).replace(/\s+/g, ' ').slice(0, 300));
  await shot(page, 'facenv-invalido');
  n = log.requests.length;
  await dlg.getByRole('button', { name: /Redactar con IA/ }).click().catch((e) => console.log('IA no clic', e.message.split('\n')[0])); await page.waitForTimeout(3000);
  console.log('[enviar-IA]', JSON.stringify(netSince(log, n)).slice(0, 400), (await dlg.innerText().catch(() => 'cerrado')).replace(/\s+/g, ' ').slice(0, 400), '| toast', (await toasts(page)).replace(/\s+/g, ' ').slice(-200));
  await shot(page, 'facenv-ia');
  await to.fill('qa3-envio@example.com'); n = log.requests.length;
  await dlg.locator('textarea').first().fill('Mensaje QA3 <b>negrita</b> & "comillas" ñ').catch(() => {});
  await dlg.getByRole('button', { name: 'Enviar', exact: true }).click(); await page.waitForTimeout(3000);
  console.log('[enviar-ok]', JSON.stringify(netSince(log, n)), 'toast', (await toasts(page)).replace(/\s+/g, ' ').slice(-200));
  await shot(page, 'facenv-ok');
  // Escape / clic fuera / X en el diálogo
  await p.getByRole('button', { name: 'Enviar', exact: true }).click(); await page.waitForTimeout(600);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  console.log('[esc] dialogs', await page.locator('[role=dialog]').count());
  await p.getByRole('button', { name: 'Enviar', exact: true }).click(); await page.waitForTimeout(600);
  await page.mouse.click(5, 450); await page.waitForTimeout(500);
  console.log('[clic-fuera] dialogs', await page.locator('[role=dialog]').count());
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
