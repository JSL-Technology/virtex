const { launch, login, shot, instrument } = require('./lib.cjs');
const panel = (page) => page.locator('.dv-groupview.dv-active-group .dv-content-container').first();
async function nav(page, rail, item) {
  await page.locator('a, button').filter({ hasText: rail }).first().click(); await page.waitForTimeout(700);
  await page.locator('a').filter({ hasText: new RegExp('^\\s*' + item + '\\s*$') }).first().click(); await page.waitForTimeout(2500);
}
async function fields(page, root) {
  const r = root || page.locator('body');
  return r.locator('input, select, textarea').evaluateAll(els => els.filter(e => e.offsetParent && e.type !== 'hidden').map(e => {
    const lbl = (e.labels && e.labels[0]?.innerText) || e.getAttribute('aria-label') || e.closest('label')?.innerText || e.closest('.field, .form-field, .form-group, div')?.querySelector('label')?.innerText || '';
    return `${e.tagName.toLowerCase()}/${e.type}|${lbl.trim().replace(/\s+/g,' ').slice(0,40)}|ph=${e.placeholder||''}|req=${e.required}|ac=${e.autocomplete||''}`;
  }));
}
async function text(page, sel) { return (await page.locator(sel).first().innerText().catch(() => '')).replace(/\n{2,}/g, '\n'); }
module.exports = { launch, login, shot, instrument, panel, nav, fields, text };
