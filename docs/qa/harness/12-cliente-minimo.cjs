// Cliente mínimo (solo nombre + país) en una sesión limpia; vuelca payload y respuesta.
const { launch, uiLogin, go, fill, click, shot } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  page.on('request', (r) => { if (/\/customers$/.test(r.url()) && r.method() === 'POST') console.log('PAYLOAD', r.postData()); });
  page.on('response', async (r) => { if (/\/customers$/.test(r.url()) && r.request().method() === 'POST') console.log('RESP', r.status(), (await r.text()).slice(0, 900)); });
  if (process.env.STRIP) await page.route(/\/api\/v1\/(customers|suppliers)$/, (r) => { if (r.request().method() !== 'POST') return r.continue(); const b = JSON.parse(r.request().postData()); for (const k of Object.keys(b)) if (b[k] === '' || b[k] === null) delete b[k]; return r.continue({ postData: JSON.stringify(b) }); });
  await uiLogin(page);
  await go(page, 'contacts/customers/new');
  await fill(page, 'Nombre del cliente', process.env.NAME || 'QA-Cliente-01 Distribuidora Ñandú & Hijos');
  await fill(page, 'País', 'República Dominicana');
  if (process.env.DOC) await fill(page, 'Número de documento', process.env.DOC);
  await click(page, 'Guardar cliente', { wait: 3000 });
  await shot(page, 'f-cli-minimo');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
