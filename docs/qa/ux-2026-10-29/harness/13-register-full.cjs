// Alta completa MX de una empresa vacía. EMAIL=... node 13-register-full.cjs
const { launch, instrument, shot, BASE, fs, path } = require('./lib.cjs'); const { dump } = require('./reglib.cjs');
const ROOT = path.resolve(__dirname, '../../../..');
const newest = (dir, ext) => { const d = path.join(ROOT, 'tmp', dir); if (!fs.existsSync(d)) return null; const f = fs.readdirSync(d).filter(x => x.endsWith(ext)).sort().pop(); return f ? path.join(d, f) : null; };
const EMAIL = process.env.EMAIL; const STOP = process.env.STOP || 'end';
(async () => { require('./lib.cjs').resetThrottle();
  const { browser, context } = await launch();
  const page = await context.newPage(); const log = instrument(page);
  const step = async (name, full = true) => { await page.waitForTimeout(1500); await shot(page, 'R-' + name, full); const d = await dump(page); console.log('\n=====', name, page.url()); console.log(d.main.replace(/(Argentina \(\+54\)[\s\S]*?Venezuela \(\+58\))/, '[prefijos]').slice(0, 1200)); console.log(d.f.filter(x => /^(INPUT|SELECT|TEXTAREA)/.test(x) || /txt=(Siguiente|Atrás|Verificar|Crear|Comenzar|Continuar|Omitir|Elegir)/.test(x)).join('\n')); return d; };
  await page.goto(BASE + '/es/mx/auth/register'); await page.waitForTimeout(3000);
  await page.getByLabel('Nombre', { exact: true }).fill('María José');
  await page.getByLabel('Apellidos').fill("O'Connor-Núñez");
  await page.getByLabel('Correo electrónico').fill(EMAIL);
  await page.getByLabel('Teléfono', { exact: true }).fill(process.env.TEL || '5512345678');
  await page.getByLabel('Contraseña', { exact: true }).fill('QA-Test-Pass-2026!');
  await page.getByLabel('Confirmar contraseña').fill('QA-Test-Pass-2026!');
  await page.getByRole('button', { name: 'Siguiente' }).click(); await page.waitForTimeout(2500);
  const m = JSON.parse(fs.readFileSync(newest('mail-outbox', '.json'))); const code = m.context.code;
  // código incorrecto primero
  const otp = page.getByLabel(/Dígito \d de 6/);
  console.log('OTP inputs', await otp.count());
  if (process.env.WRONG) { await otp.first().click(); await page.keyboard.type('000000', { delay: 120 }); await page.waitForTimeout(800); }
  await page.waitForTimeout(2000);
  await step('06-correo-codigo-incorrecto', false);
  await page.getByRole('button', { name: 'Limpiar' }).click().catch(() => {});
  await otp.first().click(); await page.keyboard.type(code, { delay: 120 }); await page.waitForTimeout(800);
  
  await page.waitForTimeout(2500);
  await step('07-paso3-telefono');
  if (STOP === '3') { await browser.close(); return; }
  const smsF = newest('sms-outbox', ''); console.log('SMS file', smsF, smsF && fs.readFileSync(smsF, 'utf8').slice(0, 300));
  const sms = smsF && (fs.readFileSync(smsF, 'utf8').match(/\b(\d{6})\b/) || [])[1];
  const otp2 = page.getByLabel(/Dígito 1 de 6/); await otp2.first().click(); await page.keyboard.type(sms || '000000', { delay: 120 }); await page.waitForTimeout(800);
  
  await page.waitForTimeout(2500);
  await step('08-paso4-fiscal');
  if (STOP === '4') { console.log(log.req.slice(-10).join('\n')); await browser.close(); return; }
  require('./reg-rest.cjs')(page, step, log).then(() => browser.close());
})();
