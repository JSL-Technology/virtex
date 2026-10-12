const { launch, login, shot, instrument, nav } = require('./flow-lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  await login(page);
  await nav(page, 'Inventario', 'Productos');
  const P = page.locator('.dv-active-group .dv-content-container');
  const L = (l) => P.getByLabel(l, { exact: false }).first();
  const open = async () => { await P.locator('a, button').filter({ hasText: 'Nuevo producto' }).first().click(); await page.waitForTimeout(2000); };
  const save = async () => { await P.locator('button').filter({ hasText: 'Guardar producto' }).click(); await page.waitForTimeout(2500); };
  await open();
  // inválidos
  await L('Nombre del producto').fill('QA-UX Martillo');
  await L('Precio de venta').fill('-10');
  await L('Costo unitario').fill('99999999999999');
  await L('Existencia inicial').fill('1.5');
  await save();
  await shot(page, 'F-prod-2-invalido', true);
  console.log('ALERTS1', await page.locator('[role=alert], .toast').allInnerTexts());
  console.log('URL1', page.url());
  // válido
  await L('Nombre del producto').fill('QA-UX Martillo de carpintero 16 oz — mango de fibra');
  await L('SKU').fill('QA-MART-16');
  await L('Descripción').fill('Martillo con mango antivibración.');
  await L('Precio de venta').fill('1500.50');
  await L('Costo unitario').fill('900');
  await L('Existencia inicial').fill('25');
  await L('Punto de pedido').fill('5');
  await save();
  console.log('ALERTS2', await page.locator('[role=alert], .toast').allInnerTexts());
  console.log('URL2', page.url());
  await shot(page, 'F-prod-3-guardado');
  // servicio
  if (!page.url().endsWith('/new')) { await open(); }
  await L('Nombre del producto').fill('QA-UX Servicio de instalación');
  await L('Precio de venta').fill('2500');
  await P.getByLabel('Tipo', { exact: true }).selectOption({ index: 1 });
  await page.waitForTimeout(500);
  await shot(page, 'F-prod-4-servicio-form', true);
  await save();
  console.log('ALERTS3', await page.locator('[role=alert], .toast').allInnerTexts());
  await shot(page, 'F-prod-5-lista');
  console.log(log.req.filter(r => /product/.test(r)).join('\n'));
  await browser.close();
})();
