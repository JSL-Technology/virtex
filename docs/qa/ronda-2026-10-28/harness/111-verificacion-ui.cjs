// Re-verificación en la interfaz de las correcciones de la ronda 3, con capturas.
// Cada comprobación va aislada: una que falle se informa y no detiene las demás.
const { launch, instrument, uiLogin, shot, go, panel, panelText, toasts, ORG_SLUG } = require('./lib.cjs');

const ADMIN2 = { email: 'qa3-admin2@example.com', password: 'QA3-Pass-Segura-2026!' };
const out = (id, data) => console.log(JSON.stringify({ id, ...data }));

async function check(id, work) {
  try {
    out(id, await work());
  } catch (error) {
    out(id, { error: String(error).slice(0, 300) });
  }
}

(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  page.on('dialog', (d) => d.dismiss());
  await uiLogin(page);
  const p = panel(page);

  // M10 — «Registrar tasa» abre su formulario aunque la lista esté vacía.
  await check('M10-registrar-tasa', async () => {
    await go(page, 'masters/currencies/exchange-rates');
    await p.getByRole('button', { name: /Registrar tasa/ }).click();
    await page.waitForTimeout(800);
    const visible = await p.locator('#rf-rate').isVisible();
    await p.getByRole('button', { name: /^Importar$/ }).click();
    await page.waitForTimeout(500);
    const importVisible = await p.locator('#rate-paste').isVisible();
    return { formularioTasa: visible, panelImportar: importVisible, evidencia: await shot(page, 'r3fix-m10-tasas') };
  });

  // M11 — «Resolver» del cierre lleva a la pantalla del paso.
  await check('M11-resolver', async () => {
    await go(page, 'accounting/closing/checklist');
    await page.waitForTimeout(1500);
    const link = p.locator('a.table-link', { hasText: /Resolver/ }).first();
    const href = await link.getAttribute('href');
    await link.click();
    await page.waitForTimeout(1500);
    return { href, url: page.url().replace(/^https?:\/\/[^/]+/, ''), evidencia: await shot(page, 'r3fix-m11-resolver') };
  });

  // B03 — capitalización en Declaraciones fiscales.
  await check('B03-capitalizacion', async () => {
    await go(page, 'reports/fiscal-returns');
    await page.waitForTimeout(1500);
    const rows = await p.locator('.fr-calendar th[scope=row]').evaluateAll((cells) =>
      cells.slice(0, 3).map((cell) => getComputedStyle(cell).textTransform + ' · ' + cell.innerText.trim()),
    );
    return { filas: rows, evidencia: await shot(page, 'r3fix-b03-fiscal') };
  });

  // B02 — la balanza abre el mayor de la cuenta en su período.
  await check('B02-balanza-mayor', async () => {
    await go(page, 'reports/financial-statements/trial-balance');
    await page.waitForTimeout(2500);
    const link = p.locator('a.account-link').first();
    const label = (await link.innerText()).replace(/\s+/g, ' ');
    await link.click();
    await page.waitForTimeout(2500);
    return { cuenta: label, url: page.url().replace(/^https?:\/\/[^/]+/, ''), texto: (await panelText(page)).replace(/\s+/g, ' ').slice(0, 200), evidencia: await shot(page, 'r3fix-b02-mayor') };
  });

  // B02 — el kárdex ordena por columna (en el servidor).
  await check('B02-kardex', async () => {
    await go(page, 'inventory/movements');
    await page.waitForTimeout(1500);
    const n = log.requests.length;
    await p.locator('th[appsortheader=quantity] button').click();
    await page.waitForTimeout(1500);
    return { peticion: log.requests.slice(n).map((r) => `${r.method} ${r.url} ${r.status}`).filter((r) => /movements/.test(r)) };
  });

  // M12 — departamento duplicado avisado en el cliente.
  await check('M12-departamento', async () => {
    await go(page, 'hcm/departments');
    await page.waitForTimeout(1200);
    await p.getByRole('button', { name: /Nuevo|Agregar/ }).first().click();
    await page.waitForTimeout(500);
    await p.locator('input').first().fill('QA3-1180-Operaciones');
    await p.getByRole('button', { name: /Guardar/ }).first().click();
    await page.waitForTimeout(1200);
    return { aviso: await toasts(page), evidencia: await shot(page, 'r3fix-m12-departamento') };
  });

  // B08 — selección de productos: barra visible y «Exportar N» de solo esos N.
  await check('B08-seleccion', async () => {
    await go(page, 'inventory/products');
    await page.waitForTimeout(1500);
    const boxes = p.locator('tbody td.select-column input[type=checkbox]');
    const count = await boxes.count();
    for (let i = 0; i < Math.min(2, count); i++) await boxes.nth(i).check();
    await page.waitForTimeout(500);
    const bar = (await p.locator('.selection-bar').innerText()).replace(/\s+/g, ' ');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
      p.locator('.selection-bar').getByRole('button', { name: /Exportar/ }).click(),
    ]);
    let lines = null;
    if (download) {
      const text = require('fs').readFileSync(await download.path(), 'utf8');
      lines = text.split('\r\n').filter(Boolean).length - 2; // sep= y cabecera
    }
    const shotPath = await shot(page, 'r3fix-b08-seleccion');
    await p.locator('.selection-bar').getByRole('button', { name: /Quitar selección/ }).click();
    return { barra: bar, filasExportadas: lines, evidencia: shotPath };
  });

  // B08 — toda fila con enlace tiene menú contextual (aquí, la lista de facturas).
  await check('B08-menu-fila', async () => {
    await go(page, 'invoices');
    await page.waitForTimeout(1500);
    await p.locator('tbody tr td').nth(2).click({ button: 'right' });
    await page.waitForTimeout(600);
    const items = await page.locator('[role=menuitem]').allInnerTexts();
    const shotPath = await shot(page, 'r3fix-b08-menu-fila');
    await page.keyboard.press('Escape');
    return { opciones: items.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean), evidencia: shotPath };
  });

  // M08 — sin modelo de lenguaje, el correo de la factura no ofrece «Redactar con IA».
  await check('M08-redactar', async () => {
    await go(page, 'invoices');
    await page.waitForTimeout(1500);
    await p.locator('tbody tr a').first().click();
    await page.waitForTimeout(2000);
    await p.getByRole('button', { name: /Enviar/ }).first().click();
    await page.waitForTimeout(1500);
    const compose = await page.locator('.email-dialog__compose').count();
    const shotPath = await shot(page, 'r3fix-m08-correo');
    await page.keyboard.press('Escape');
    return { botonRedactar: compose > 0, evidencia: shotPath };
  });

  // B04 — flechas de la barra de factura.
  await check('B04-flechas', async () => {
    const prev = page.locator('[aria-label="Anterior"], [title="Anterior"]').first();
    const next = page.locator('[aria-label*="iguiente"], [title*="iguiente"]').first();
    return { anteriorDeshabilitada: await prev.isDisabled().catch(() => null), siguienteDeshabilitada: await next.isDisabled().catch(() => null) };
  });

  // B06 — Escape en «Invitar usuario» cierra el diálogo, no Ajustes.
  await check('B06-escape', async () => {
    await page.evaluate((slug) => { history.pushState({}, '', `/e/${slug}/home#settings/users`); dispatchEvent(new PopStateEvent('popstate')); }, ORG_SLUG);
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /Invitar/ }).first().click();
    await page.waitForTimeout(800);
    const dialog = page.locator('[aria-labelledby="user-modal-title"]');
    const role = await dialog.getAttribute('role');
    const focusInside = await page.evaluate(() => !!document.activeElement?.closest('[aria-labelledby="user-modal-title"]'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    return {
      role,
      focoDentro: focusInside,
      dialogoAbierto: await dialog.isVisible(),
      ajustesAbiertos: await page.locator('.sm-panel').isVisible(),
      evidencia: await shot(page, 'r3fix-b06-escape'),
    };
  });

  await context.clearCookies();
  // M09 — la campana de quien aprueba tiene sus avisos, y cada uno lleva a su documento.
  await check('M09-campana', async () => {
    await uiLogin(page, ADMIN2);
    const bell = page.locator('button[aria-label*="otificaciones"]').first();
    await bell.click();
    await page.waitForTimeout(1500);
    const items = await page.locator('[class*=notification] li, [class*=notification-item]').evaluateAll((els) =>
      els.slice(0, 6).map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
    );
    const shotPath = await shot(page, 'r3fix-m09-campana');
    return { avisos: items, evidencia: shotPath };
  });

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
