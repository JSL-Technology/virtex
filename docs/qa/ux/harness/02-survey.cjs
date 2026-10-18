// Uso: node 02-survey.cjs <tag> <theme light|dark> <width> [filtro]
const fs = require('fs');
const { execSync } = require('child_process');
const { launch, shot, login } = require('./lib.cjs');
const AXE = fs.readFileSync(process.env.AXE_PATH || require.resolve('axe-core/axe.min.js'), 'utf8');
const idleTx = () => +execSync(`sudo -u postgres psql -d erp -tAc "select count(*) from pg_stat_activity where datname='erp' and state like 'idle in%'"`).toString().trim();
const hung = () => +execSync(`sudo -u postgres psql -d erp -tAc "select count(*) from pg_stat_activity where datname='erp' and (wait_event_type='Lock')"`).toString().trim();
const unthrottle = () => execSync(`redis-cli --scan --pattern '{*:default}:*' | xargs -r redis-cli del`);
const [tag='es-light', theme='light', width='1440', filt='', lang='es'] = process.argv.slice(2);
const START = +(process.env.START || 1);
const ORG = process.env.ORG || 'virtex-dev'; const CREDS = process.env.EMAIL ? { email: process.env.EMAIL, password: 'Sup3r-Segura-2026!' } : undefined;
const routes = fs.readFileSync(__dirname + '/routes.txt', 'utf8').trim().split('\n').map(l => { const [mod, rest] = l.split(' || '); const [href, label] = rest.split(' | '); return { mod, href, label }; }).filter(r => r.href.includes(filt)).map(r => ({ ...r, href: r.href.replace('/e/virtex-dev/', `/e/${ORG}/`) }));
(async () => {
  const w = +width; const mobile = w < 800;
  fs.mkdirSync(__dirname + `/../evidence/survey/${tag}`, { recursive: true });
  const { browser, context } = await launch({ colorScheme: theme, viewport: { width: w, height: mobile ? 844 : 900 }, isMobile: mobile });
  await context.addInitScript((t) => { try { localStorage.setItem('vx-theme-mode', t); } catch {} }, theme);
  const page = await context.newPage();
  unthrottle();
  await login(page, CREDS, lang);
  const outFile = __dirname + `/survey-${tag}.json`;
  const out = START > 1 && fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile)) : []; let cur = {};
  const save = () => fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  page.on('response', async (res) => { if (res.url().includes('/api/') && res.status() >= 400) { let b=''; try { b=(await res.text()).slice(0,200);} catch{} (cur.api ||= []).push(`${res.request().method()} ${res.url().replace(/.*\/api\/v1/,'')} ${res.status()} ${b}`); } });
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|fonts|recaptcha/i.test(m.text())) (cur.console ||= []).push(m.text().slice(0,200)); });
  page.on('pageerror', (e) => (cur.pageerr ||= []).push(String(e).slice(0,200)));
  let i = 0;
  for (const r of routes) {
    i++; if (i < START) continue; cur = { ...r }; if (i % 8 === 0) unthrottle();
    const t0 = Date.now();
    try { if (i === START) await page.goto('http://localhost:4200' + r.href, { waitUntil: 'load', timeout: 60000 }); else await page.evaluate((u) => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate')); }, r.href); } catch (e) { cur.navErr = e.message.slice(0,100); }
    await page.waitForTimeout(4000);
    cur.ms = Date.now() - t0; cur.idleTx = idleTx();
    if (hung() >= 6) { console.log('API HANG detected at', r.href); fs.appendFileSync(__dirname + '/hangs.log', `HANG ${tag} #${i} ${r.href}\n`); save(); process.exit(3); }
    if (page.url().includes('/auth/') || !(await page.locator('body').innerText()).trim()) { console.log('SESSION LOST/BLANK at', r.href); cur.lost = true; await login(page, CREDS, lang); await page.goto('http://localhost:4200' + r.href, { waitUntil: 'load' }); await page.waitForTimeout(4000); }
    cur.url = page.url().replace('http://localhost:4200','');
    const name = `${tag}-${String(i).padStart(2,'0')}-${r.href.replace(`/e/${ORG}/`,'').replace(/\//g,'_')}`;
    await shot(page, `survey/${tag}/${name}`);
    await page.addScriptTag({ content: AXE }).catch(()=>{});
    const res = await page.evaluate(async () => {
      const ax = await window.axe.run(document, { resultTypes: ['violations'] }).catch(e => ({ violations: [], err: String(e) }));
      const viol = ax.violations.map(v => `${v.impact}:${v.id}(${v.nodes.length}) e.g. ${v.nodes[0]?.target?.[0] ?? ''}`.slice(0,180));
      const txt = document.body.innerText;
      const keys = [...new Set((txt.match(/\b[A-Z_]{3,}\.[A-Z_.]+\b|\b[a-z]+[A-Za-z]*\.[a-z][A-Za-z]*\.[a-zA-Z.]+\b/g) || []))].filter(k => !/\.(com|local|do|png|pdf|csv)$/.test(k)).slice(0,15);
      const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      const small = [...document.querySelectorAll('body *')].filter(e => [...e.childNodes].some(n => n.nodeType===3 && n.textContent.trim()) && e.getBoundingClientRect().width>0 && parseFloat(getComputedStyle(e).fontSize) < 11).map(e => `${getComputedStyle(e).fontSize} "${e.innerText.trim().slice(0,25)}"`);
      const clipped = [...document.querySelectorAll('body *')].filter(e => { const s=getComputedStyle(e); return e.scrollWidth > e.clientWidth + 2 && (s.textOverflow==='ellipsis' || s.overflow==='hidden') && e.innerText && e.clientWidth>0 && !e.title && e.childElementCount===0; }).map(e => e.innerText.trim().slice(0,40));
      const tiny = [...document.querySelectorAll('button, a, [role=button], input[type=checkbox]')].filter(e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && (r.width<24 || r.height<24); }).length;
      const h1 = [...document.querySelectorAll('h1')].map(h=>h.innerText.trim()).slice(0,3);
      return { viol, keys, overflowX, small: [...new Set(small)].slice(0,8), clipped: [...new Set(clipped)].slice(0,8), tiny, h1, title: document.title, lang: document.documentElement.lang };
    }).catch(e => ({ evalErr: String(e) }));
    Object.assign(cur, res, { shot: name });
    out.push(cur); save(); fs.writeFileSync(__dirname + `/progress-${tag}`, String(i+1));
    console.log(i, r.href, 'axe', (res.viol||[]).length, 'api', (cur.api||[]).length, 'idleTx', cur.idleTx, cur.lost ? 'LOST' : '');
  }
  save();
  await browser.close();
})();
