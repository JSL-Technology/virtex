const { launch, shot, instrument } = require('./lib.cjs');
const fs = require('fs');
const P = process.argv[2] || 'en/us'; const tag = P.replace('/','-');
(async () => {
  const { browser, context } = await launch({ locale: P.startsWith('en') ? 'en-US' : 'es-DO' });
  const page = await context.newPage(); const log = instrument(page);
  await page.goto(`http://localhost:4200/${P}/auth/register`, { waitUntil: 'load' }); await page.waitForTimeout(3000);
  // 1. Enviar vacío
  await page.locator('button', { hasText: /Next|Siguiente/ }).click(); await page.waitForTimeout(800);
  await shot(page, `auth/R-${tag}-1-vacio`, true);
  // 2. Datos inválidos
  const inputs = page.locator('form input:not([type=hidden])');
  console.log('inputs', await inputs.evaluateAll(els => els.map(e => `${e.type}|${e.getAttribute('formcontrolname')}|${e.placeholder}|ac=${e.autocomplete}`)));
  await page.locator('form input[type=text]').nth(0).fill('A');
  await page.locator('form input[type=text]').nth(1).fill('B');
  await page.locator('input[type=email]').fill('correo-malo');
  await page.locator('input[type=tel]').fill('123');
  const pw = page.locator('input[type=password]');
  await pw.nth(0).fill('abc'); await pw.nth(1).fill('abd');
  await page.locator('button', { hasText: /Next|Siguiente/ }).click(); await page.waitForTimeout(800);
  await shot(page, `auth/R-${tag}-2-invalido`, true);
  // 3. Válidos
  const stamp = Date.now().toString().slice(-6);
  await page.locator('form input[type=text]').nth(0).fill('María José');
  await page.locator('form input[type=text]').nth(1).fill("O'Connor-Núñez");
  await page.locator('input[type=email]').fill(`qa.ux.${tag}.${stamp}@example.com`);
  const sel = page.locator('select').first();
  console.log('phone country options', (await sel.locator('option').allInnerTexts()).slice(0, 40).join(', '));
  console.log('selected', await sel.inputValue());
  await page.locator('input[type=tel]').fill(P.startsWith('en') ? '2025550147' : '8095550147');
  await pw.nth(0).fill('Sup3r-Segura-2026!'); await pw.nth(1).fill('Sup3r-Segura-2026!');
  await page.waitForTimeout(500);
  await shot(page, `auth/R-${tag}-3-valido`, true);
  await page.locator('button', { hasText: /Next|Siguiente/ }).click(); await page.waitForTimeout(3000);
  await shot(page, `auth/R-${tag}-4-paso2`, true);
  console.log('STEP2 text:', (await page.locator('form, main').first().innerText()).slice(0, 800));
  fs.writeFileSync(__dirname + `/reg-${tag}.json`, JSON.stringify({ email: `qa.ux.${tag}.${stamp}@example.com` }));
  await context.storageState({ path: __dirname + `/reg-${tag}-state.json` });
  console.log(log.req.join('\n')); console.log(log.errors.join('\n'));
  await browser.close();
})();
