// Proveedor: vacío, inválido, mínimo (tal cual la UI) y mínimo con vacíos eliminados (workaround).
const { launch, uiLogin, go, panel, shot, errorsShown } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  page.on('request', (r) => { if (/\/suppliers$/.test(r.url()) && r.method() === 'POST') console.log('PAYLOAD', r.postData()); });
  page.on('response', async (r) => { if (/\/suppliers$/.test(r.url()) && r.request().method() === 'POST') console.log('RESP', r.status(), (await r.text()).slice(0, 500)); });
  if (process.env.STRIP) await page.route(/\/api\/v1\/suppliers$/, (r) => { if (r.request().method() !== 'POST') return r.continue(); const b = JSON.parse(r.request().postData()); for (const k of Object.keys(b)) if (b[k] === '' || b[k] === null) delete b[k]; return r.continue({ postData: JSON.stringify(b) }); });
  await uiLogin(page);
  await go(page, 'masters/suppliers/new');
  const p = panel(page);
  const save = p.getByRole('button', { name: 'Guardar Proveedor' });
  if (!process.env.STRIP) {
    await save.click(); await page.waitForTimeout(1200); console.log('[vacio]', JSON.stringify(await errorsShown(page)));
    await p.locator('[formcontrolname=name], input[name=name]').first().fill('QA-Prov-Inv'); await p.locator('input[type=email]').fill('malo@'); await p.locator('input[type=tel]').fill('abc'); await save.click(); await page.waitForTimeout(1500); console.log('[invalido]', JSON.stringify(await errorsShown(page)));
    await p.locator('input[type=email]').fill(''); await p.locator('input[type=tel]').fill('');
  }
  await p.locator('[formcontrolname=name], input[name=name]').first().fill('QA-Proveedor-01 Suministros Ñ&Co');
  const country = p.locator('select').nth(1); await country.selectOption({ label: 'República Dominicana' });
  await save.click(); await page.waitForTimeout(2500);
  console.log('[minimo]', JSON.stringify(await errorsShown(page)), page.url().split('/e/')[1]);
  await shot(page, `f-prov-minimo${process.env.STRIP ? '-strip' : ''}`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
