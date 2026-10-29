const { session, ADMIN, shot, panel, resetThrottle, BASE } = require('./flow-lib.cjs');
const SIZES = [['1920', 1920, 1080, 1], ['1366', 1366, 768, 1], ['tablet768', 768, 1024, 1], ['movil375', 375, 812, 2], ['zoom150', 960, 600, 1.5], ['zoom200', 720, 450, 2]];
const PAGES = ['overview', 'invoices', 'invoices/new', 'contacts/customers/new', 'reports/financial-statements/balance-sheet', 'accounting/journal-entries/new'];
(async () => {
  resetThrottle();
  const out = [];
  for (const [name, w, h, dpr] of SIZES) {
    const { page, close } = await session('state-admin.json', ADMIN, { viewport: { width: w, height: h }, dpr, isMobile: w < 500 });
    for (const p of PAGES) {
      await page.goto(BASE + '/e/virtex-dev/' + p); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(2000);
      const m = await page.evaluate(() => {
        const de = document.scrollingElement; const pnl = document.querySelector('.dv-groupview.dv-active-group .dv-content-container');
        const prim = [...document.querySelectorAll('button.primary-button, button[class*=primary], .dr__save')].filter(b => b.offsetParent);
        const vis = prim.map(b => { const r = b.getBoundingClientRect(); return { t: b.innerText.trim().slice(0, 25), inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, x: Math.round(r.left), w: Math.round(r.width) }; });
        const rail = document.querySelector('nav.rail'); const side = document.querySelector('aside.main-sidebar');
        const pr = pnl && pnl.getBoundingClientRect();
        return { docOverflowX: de.scrollWidth - de.clientWidth, docOverflowY: de.scrollHeight - de.clientHeight, panelW: pr ? Math.round(pr.width) : null, panelOverflowX: pnl ? pnl.scrollWidth - pnl.clientWidth : null, railW: rail ? Math.round(rail.getBoundingClientRect().width) : 0, sideW: side && side.offsetParent ? Math.round(side.getBoundingClientRect().width) : 0, prim: vis.slice(0, 3), h1: (document.querySelector('.dv-groupview.dv-active-group h1') || {}).innerText };
      });
      out.push({ name, p, ...m }); console.log(name, p, JSON.stringify(m));
      await shot(page, `R/${name}-${p.replace(/\//g, '_')}`);
    }
    await close();
  }
  require('fs').writeFileSync(__dirname + '/responsive.json', JSON.stringify(out, null, 1));
})();
