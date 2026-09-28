// Pausa el hilo principal congelado vía CDP y vuelca la pila de llamadas (evidencia del bucle).
const { launch, uiLogin, BASE } = require('./lib.cjs');
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await uiLogin(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Debugger.enable');
  const paused = new Promise((r) => cdp.once('Debugger.paused', r));
  await page.reload({ waitUntil: 'commit' });
  await new Promise((r) => setTimeout(r, 7000));
  await cdp.send('Debugger.pause');
  const ev = await Promise.race([paused, new Promise((r) => setTimeout(() => r(null), 10000))]);
  if (!ev) { console.log('no pause'); } else {
    for (const f of ev.callFrames.slice(0, 25)) console.log(f.functionName || '(anon)', f.url.replace(BASE, ''), f.location.lineNumber + 1);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
