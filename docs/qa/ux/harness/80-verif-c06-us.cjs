// QA C-06 (y A-15, M-13): verificación en navegador con la empresa de EE. UU.
// Capturas en evidence/fix/C06-*.png. Uso: node docs/qa/ux/harness/80-verif-c06-us.cjs [paso]
const path = require('path');
const { launch, login, instrument, nav, panel } = require('./flow-lib.cjs');
const FIX = path.resolve(__dirname, '..', 'evidence', 'fix');
const US = { email: 'qa.ux.en-us.869854@example.com', password: 'Sup3r-Segura-2026!' };
const only = process.argv[2];
const snap = (page, name, full = false) => page.screenshot({ path: path.join(FIX, `${name}.png`), fullPage: full }).catch((e) => console.log('shot', name, e.message));
const say = async (label, P) => console.log(`\n== ${label}\n` + (await P.innerText()).slice(0, 1800).replace(/\n+/g, ' | '));

/** Contesta la reautenticación (step-up) si aparece. */
async function stepUp(page) {
  const pwd = page.locator('dialog input[type=password], .cdk-overlay-container input[type=password], [role=dialog] input[type=password]').first();
  if (await pwd.isVisible({ timeout: 2500 }).catch(() => false)) {
    await pwd.fill(US.password);
    await page.locator('[role=dialog] button[type=submit], dialog button[type=submit], [role=dialog] button.primary-button').first().click();
    await page.waitForTimeout(2000);
  }
}

(async () => {
  const { browser, context } = await launch({ locale: 'en-US' });
  const page = await context.newPage();
  const log = instrument(page);
  await login(page, US, 'en');
  const P = panel(page);

  if (!only || only === 'pm') {
    await nav(page, 'Treasury', 'Payment methods');
    await snap(page, 'C06-1-payment-methods-us');
    await P.locator('button').filter({ hasText: 'New payment method' }).first().click();
    await page.waitForTimeout(600);
    await P.locator('input[formcontrolname=code]').fill('ACH_SAMEDAY');
    await P.locator('input[formcontrolname=name]').fill('Same-day ACH');
    await P.locator('select[formcontrolname=kind]').selectOption('BANK_TRANSFER');
    await snap(page, 'C06-2-payment-methods-us-adding-ach');
    await P.locator('form button[type=submit]').click();
    await page.waitForTimeout(2000);
    await snap(page, 'C06-3-payment-methods-us-ach-added');
    await say('payment methods', P);
  }

  if (!only || only === 'tax') {
    await nav(page, 'Accounting', 'Taxes');
    await snap(page, 'C06-4-taxes-us-guided-empty');
    const first = P.locator('button').filter({ hasText: /Add your first state|Add state/ }).first();
    if (await first.isVisible().catch(() => false)) {
      await first.click();
      await page.waitForTimeout(500);
      await P.locator('select[formcontrolname=stateCode]').selectOption('TX');
      await P.locator('input[formcontrolname=ratePercent]').fill('6.25');
      await snap(page, 'C06-5-taxes-us-state-picker');
      await P.locator('form button[type=submit]').click();
      await page.waitForTimeout(2500);
    }
    await snap(page, 'C06-6-taxes-us-texas-registered');
    await say('taxes', P);
  }

  if (!only || only === 'customer') {
    await nav(page, 'Sales', 'Customers');
    await snap(page, 'C06-7-customers-us-walk-in');
    await say('customers', P);
    await P.locator('a, button').filter({ hasText: /Add customer|New customer/ }).first().click();
    await page.waitForTimeout(2500);
    const F = panel(page);
    await F.locator('#companyName').fill('Lone Star Supply Co');
    await F.locator('#city').fill('Austin');
    await F.locator('#stateOrProvince').selectOption('TX');
    await F.locator('#postalCode').fill('78701');
    await snap(page, 'C06-8-customer-form-us');
    await say('customer form', F);
    await F.locator('button').filter({ hasText: 'Save customer' }).first().click();
    await page.waitForTimeout(2500);
  }

  if (!only || only === 'invoice') {
    await nav(page, 'Sales', 'Invoices');
    await P.locator('a, button').filter({ hasText: /New (sales )?invoice/ }).first().click();
    await page.waitForTimeout(3500);
    const F = panel(page);
    await F.locator('#customerId').fill('Lone Star');
    await page.waitForTimeout(1500);
    await page.locator('[role=option]').filter({ hasText: 'Lone Star' }).first().click();
    await page.waitForTimeout(800);
    await F.locator('input.line-description').first().fill('Consulting hours');
    await F.locator('input[formcontrolname=unitPrice]').first().fill('100');
    await page.waitForTimeout(2500);
    await snap(page, 'C06-9-invoice-us-sales-tax-column');
    await say('invoice content', F);
    await F.getByRole('tab').nth(1).click();
    await page.waitForTimeout(1200);
    await snap(page, 'C06-10-invoice-us-no-withholding-no-ncf');
    await say('invoice finance', F);
  }

  if (!only || only === 'payroll') {
    await nav(page, 'HR & payroll', 'Statutory parameters');
    await snap(page, 'C06-11-payroll-parameters-us', true);
    await say('payroll parameters', P);
    await P.locator('button').filter({ hasText: 'Add parameter' }).first().click();
    await page.waitForTimeout(600);
    await snap(page, 'C06-12-payroll-add-parameter');
    await P.locator('button').filter({ hasText: 'Cancel' }).first().click();
    // The state unemployment rate is the company's own: enter it.
    const row = P.locator('tr').filter({ hasText: 'State unemployment' }).first();
    await row.locator('button').filter({ hasText: 'Enter values' }).click();
    await page.waitForTimeout(500);
    const inputs = P.locator('.editor input[type=number]');
    await inputs.nth(1).fill('2.7');
    await inputs.nth(2).fill('9000');
    await P.locator('.editor button').filter({ hasText: 'Save' }).first().click();
    await page.waitForTimeout(1500);
    await stepUp(page);
    await page.waitForTimeout(2000);
    await snap(page, 'C06-13-payroll-suta-entered', true);
  }

  if (!only || only === 'returns') {
    await nav(page, 'Accounting', 'Fiscal returns');
    await snap(page, 'C06-14-fiscal-returns-us-honest');
    await say('fiscal returns', P);
  }

  console.log('\n-- API errors:', log.req.filter((r) => / [45]\d\d /.test(r)).join('\n'));
  console.log('-- console:', log.console.slice(0, 10).join('\n'), log.errors.join('\n'));
  await browser.close();
})();
