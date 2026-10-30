const { launch, uiLogin, go, api } = require('./lib.cjs');
const out = (k, v) => console.log(`### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v).slice(0, 600)}`);
(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await uiLogin(page); await go(page, 'inventory/adjustments');
  const s0 = await api(page, 'POST', '/auth/step-up', { scope: process.env.ROLE_SCOPE || 'manage_roles', password: 'QA-Ajuste-2026!' });
  out('step-up roles', s0.status);
  const r = await api(page, 'POST', '/roles', { name: 'QA-7734 Consulta inventario', description: 'Solo ve existencias', permissions: ['products:view', 'inventory:view_stock'] });
  out('rol', [r.status, r.body?.id, r.body?.message || r.body?.messageKey]);
  const s = await api(page, 'POST', '/auth/step-up', { scope: 'manage_users', password: 'QA-Ajuste-2026!' });
  out('step-up', [s.status, s.body?.messageKey]);
  const i = await api(page, 'POST', '/users/invite', { email: 'qa7734.consulta@example.test', firstName: 'QA-7734', lastName: 'Consulta', roleId: r.body?.id, preferredLanguage: 'es' });
  out('invite', [i.status, i.body]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
