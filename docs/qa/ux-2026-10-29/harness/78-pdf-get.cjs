const { session, ADMIN, resetThrottle, BASE, EVID } = require('./flow-lib.cjs'); const fs = require('fs');
(async () => {
  resetThrottle();
  const { page, close } = await session('state-admin.json', ADMIN);
  await page.goto(BASE + '/e/virtex-dev/invoices'); await page.waitForTimeout(3000);
  for (const [u, f] of [['pdf', 'D-factura-api.pdf'], ['print', 'D-factura-print.html']]) {
    const r = await page.evaluate(async (u) => { const res = await fetch('http://localhost:3000/api/v1/invoices/48e1d104-5b00-4be4-9333-a78c6279ac3f/' + u, { credentials: 'include' }); const b = new Uint8Array(await res.arrayBuffer()); return { ct: res.headers.get('content-type'), b: Array.from(b) }; }, u);
    fs.writeFileSync(EVID + '/' + f, Buffer.from(r.b)); console.log(u, r.ct, r.b.length);
  }
  await page.goto('file://' + EVID + '/D-factura-print.html').catch(() => {}); await page.waitForTimeout(1500); await page.screenshot({ path: EVID + '/D-factura-print-html.png', fullPage: true });
  await close();
})();
