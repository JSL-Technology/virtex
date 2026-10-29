// Recorre todas las rutas del inventario, mide y captura. Uso: node 02-survey.cjs <variant> [lang] [theme] [w] [h]
const { launch, instrument, login, shot, BASE, fs, path } = require('./lib.cjs');
const variant = process.argv[2] || 'es-light'; const theme = process.argv[4] || 'light';
const W = +(process.argv[5] || 1440), H = +(process.argv[6] || 900);
const AXE = fs.readFileSync(path.resolve(__dirname, '../../../../node_modules/axe-core/axe.min.js'), 'utf8');
const MEAS = fs.readFileSync(__dirname + '/measure.js', 'utf8');
(async () => {
  const inv = JSON.parse(fs.readFileSync(__dirname + '/inventory.json'));
  const routes = []; inv.forEach(m => m.items.forEach(it => routes.push({ module: m.module, label: it.label, href: it.href })));
  const extra = (process.env.EXTRA || '').split(',').filter(Boolean).map(h => ({ module: 'extra', label: h, href: h }));
  const all = routes.concat(extra).filter(r => !process.env.ONLY || new RegExp(process.env.ONLY).test(r.href));
  const { browser, context } = await launch({ storageState: __dirname + '/state-admin.json', colorScheme: theme, viewport: { width: W, height: H }, isMobile: W < 500 });
  const page = await context.newPage(); const log = instrument(page);
  fs.mkdirSync(path.resolve(__dirname, '../evidence/survey/' + variant), { recursive: true });
  const out = [];
  for (const r of all) {
    log.req.length = 0; log.console.length = 0; log.errors.length = 0;
    const t0 = Date.now();
    try { await page.goto(BASE + r.href, { waitUntil: 'load', timeout: 30000 }); await page.waitForTimeout(1500); } catch (e) { out.push({ ...r, nav: String(e).slice(0,100) }); continue; }
    if (page.url().includes('/auth/')) { await login(page); await page.goto(BASE + r.href); }
    try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
    await page.waitForTimeout(1200);
    const ms = Date.now() - t0;
    await page.addScriptTag({ content: MEAS });
    const m = await page.evaluate(() => window.__measure()).catch(e => ({ err: String(e) }));
    await page.addScriptTag({ content: AXE }).catch(() => {});
    const axe = await page.evaluate(async () => { const r = await axe.run(document, { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'] }); return r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, ex: v.nodes.slice(0,3).map(n => n.target.join(' ') + ' :: ' + (n.failureSummary||'').split('\n').slice(1,2).join('').slice(0,140)) })); }).catch(e => [{ id: 'axe-error', ex: [String(e).slice(0,100)] }]);
    const slug = r.href.replace(/^\/e\/[^/]+\//, '').replace(/\//g, '_') || 'root';
    await shot(page, `survey/${variant}/${slug}`);
    const apiErr = log.req.filter(x => / [45]\d\d /.test(x));
    out.push({ ...r, url: page.url(), ms, ...m, axe, apiErr, consoleErr: log.console.filter(c => !c.includes('ERR_TUNNEL')).slice(0,8), pageErr: log.errors.slice(0,5) });
    console.log(variant, slug, ms + 'ms', 'title=', m.title, 'h1=', (m.h || []).filter(x => x.tag==='H1').map(x=>x.text).join('/'), 'axe=', axe.map(a => a.id + ':' + a.n).join(','), 'apiErr=', apiErr.length);
  }
  fs.writeFileSync(__dirname + `/survey-${variant}.json`, JSON.stringify(out, null, 1));
  await browser.close();
})();
