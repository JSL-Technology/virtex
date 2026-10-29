// Genera volumen por la API real (con sus validaciones) en la empresa MX: 400 clientes con tildes, eñes, emojis y nombres largos.
const { session, MX, shot, panel, text, go, resetThrottle } = require('./flow-lib.cjs');
(async () => {
  resetThrottle();
  const { page, close } = await session('state-mx.json', MX);
  page.on('console', m => { if (m.text().startsWith('progreso')) console.log(m.text()); });
  await go(page, 'contacts/customers');
  const all = { ok: 0, ko: [] };
  for (let b = 0; b < 20; b++) { require('./lib.cjs').resetThrottle();
  const res = await page.evaluate(async (b) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|; )(?:__Host-)?XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const pre = ['Ñandú', 'Pingüino', 'Acción Ágil', "O'Higgins", 'Café ☕', 'Distribuidora Peñasco', 'Comercializadora del Bajío y Occidente', 'Zoë & Søn'];
    let ok = 0; const ko = []; const t0 = performance.now();
    for (let i = b * 15 + 21; i < b * 15 + 36; i++) {
      if (i % 50 === 0) console.log('progreso', i, ok, ko[0] || '');
      const body = { companyName: `QA-Vol ${String(i).padStart(3, '0')} ${pre[i % pre.length]}${i % 50 === 0 ? ' — razón social extraordinariamente larga para probar truncado en tablas y selectores S.A.P.I. de C.V.' : ''}`, email: `qa.vol${i}@example.com`, phone: '55 1234 ' + String(1000 + i), country: 'MX', city: i % 3 ? 'Ciudad de México' : 'Mérida' };
      const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 10000);
      try { const r = await fetch('http://localhost:3000/api/v1/customers', { signal: ac.signal, method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': csrf }, body: JSON.stringify(body) }); if (r.ok) ok++; else if (ko.length < 3) ko.push(r.status + ' ' + (await r.text()).slice(0, 160)); } catch (e) { if (ko.length < 3) ko.push(String(e)); }
      clearTimeout(to);
    }
    return { ok, ko, ms: Math.round(performance.now() - t0) };
  }, b); all.ok += res.ok; all.ko.push(...res.ko); }
  console.log('VOLUMEN', all.ok, JSON.stringify(all.ko.slice(0, 2)));
  const t1 = Date.now(); await go(page, 'contacts/customers'); console.log('lista cargó en', Date.now() - t1, 'ms');
  await shot(page, 'V-1-clientes-volumen'); console.log((await text(page)).slice(0, 400).replace(/\n+/g, ' | '));
  console.log('tabla', JSON.stringify(await page.evaluate(() => { const r = document.querySelector('.dv-groupview.dv-active-group'); return { rows: r.querySelectorAll('tbody tr').length, search: !!r.querySelector('input[type=search], input[placeholder*=uscar]'), pager: !!r.querySelector('[class*=pager], [class*=pagination]') }; })));
  await page.mouse.move(900, 500); await page.mouse.wheel(0, 30000); await page.waitForTimeout(800); await shot(page, 'V-2-clientes-scroll');
  console.log('top del encabezado tras scroll', await page.evaluate(() => { const th = document.querySelector('.dv-groupview.dv-active-group thead th'); return th ? Math.round(th.getBoundingClientRect().top) : null; }));
  await go(page, 'invoices/new'); await panel(page).getByLabel(/Cliente/).click(); await page.waitForTimeout(1000);
  console.log('opciones selector sin teclear', await page.locator('[role=option]').count());
  await page.keyboard.type('Pingüino', { delay: 30 }); await page.waitForTimeout(1200); console.log('opciones "Pingüino"', await page.locator('[role=option]').count());
  await page.keyboard.press('Control+A'); await page.keyboard.type('pinguino', { delay: 30 }); await page.waitForTimeout(1200); console.log('opciones "pinguino" (sin diéresis)', await page.locator('[role=option]').count());
  await shot(page, 'V-3-selector-cliente');
  await close();
})();
