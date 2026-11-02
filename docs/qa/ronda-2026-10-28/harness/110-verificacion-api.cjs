// Re-verificación por API (misma sesión que la UI) de las correcciones de la ronda 3.
// Cada bloque imprime una línea JSON con lo observado; nada se simula: son respuestas reales.
const { execSync } = require('child_process');
const { launch, uiLogin } = require('./lib.cjs');

const sql = (q) => execSync(`psql -U postgres -h localhost -d erp -At -F '|' -c ${JSON.stringify(q)}`).toString().trim();
// The payroll month the check creates (session data; it is cancelled at the end).
const MONTH = Number(process.env.QA_PAYROLL_MONTH || 11);
const out = (id, data) => console.log(JSON.stringify({ id, ...data }));

(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await uiLogin(page);
  const api = (method, url, body, extra = {}) =>
    page.evaluate(
      async ({ method, url, body, extra }) => {
        const csrf = document.cookie.split('; ').find((c) => /xsrf-token=/i.test(c))?.split('=')[1];
        const res = await fetch('http://localhost:3000/api/v1' + url, {
          method,
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf), 'X-XSRF-TOKEN': decodeURIComponent(csrf) } : {}),
            ...extra,
          },
          // Fastify refuses an empty body sent as JSON: a POST without one sends `{}`, as the client does.
          body: body ? JSON.stringify(body) : method === 'GET' ? undefined : '{}',
        });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* CSV u otro texto */ }
        return { status: res.status, json, text: json ? null : text.slice(0, 600) };
      },
      { method, url, body, extra },
    );

  // M12 — departamento duplicado (mismo nombre, otra capitalización y espacios).
  const dept = await api('POST', '/hcm/departments', { name: '  qa3-1180-operaciones ' });
  out('M12-departamento-duplicado', { status: dept.status, key: dept.json?.messageKey });

  // M13 — búsqueda por e-NCF y estado propio del documento.
  const search = await api('GET', '/relationship-map/search?q=B0100000001');
  out('M13-busqueda-ncf', {
    status: search.status,
    hits: (search.json ?? []).map((h) => ({ number: h.number, description: h.description, statusKind: h.statusKind, statusKey: h.statusKey })),
  });

  // B02 — kárdex ordenado en el servidor.
  const kardex = await api('GET', '/inventory/movements?sort=quantity&direction=desc&limit=5');
  out('B02-kardex-orden', { status: kardex.status, quantities: (kardex.json?.items ?? []).map((r) => Number(r.quantity)) });

  // M11 — enlaces «Resolver» del cierre.
  const current = await api('GET', '/accounting/current-period');
  const periodId = current.json?.id ?? current.json?.period?.id;
  const checklist = periodId ? await api('GET', `/accounting/periods/${periodId}/closing-checklist`) : null;
  const items = checklist?.json?.items ?? checklist?.json ?? [];
  out('M11-enlaces-cierre', { periodId, links: (Array.isArray(items) ? items : []).map((i) => [i.id, i.resolutionLink ?? null]) });

  // B10 — CSV del servidor: sep=, delimitador y fecha en la zona de la empresa.
  const datasets = await api('GET', '/data-transfer/datasets');
  const ids = (datasets.json ?? []).map((d) => d.id);
  const csvDataset = ids.find((id) => /pos/i.test(id)) ?? ids.find((id) => /invoice|factur/i.test(id)) ?? ids[0];
  const csv = await api('POST', '/data-transfer/exports', { dataset: csvDataset, format: 'csv' });
  out('B10-csv-servidor', { dataset: csvDataset, status: csv.status, head: (csv.text ?? '').split('\r\n').slice(0, 3) });

  // C02 + B09 — venta de caja contabilizada; cierre con diferencia exige justificación.
  let shift = (await api('GET', '/pos/shifts/active?terminalId=main')).json;
  if (!shift?.id) shift = (await api('POST', '/pos/shifts', { terminalId: 'main', openingBalance: 100 })).json;
  const catalog = await api('GET', '/pos/catalog');
  const items2 = catalog.json?.items ?? catalog.json ?? [];
  const product = items2.find((p) => Number(p.stock ?? p.quantityOnHand ?? 0) > 0 && Number(p.price) > 0) ?? items2[0];
  let saleOut = { shift: shift?.id ?? null, product: product?.name ?? null };
  if (shift?.id && product) {
    const price = Number(product.price);
    const taxRate = Number(product.taxRate ?? 0);
    const tax = Math.round(price * taxRate * 100) / 100;
    const total = Math.round((price + tax) * 100) / 100;
    const sale = await api('POST', '/pos/sales', {
      terminalId: 'main',
      items: [{ productId: product.id, productName: product.name, price, quantity: 1 }],
      subtotal: price,
      tax,
      total,
      payments: [{ method: 'cash', amount: total }],
    }, { 'Idempotency-Key': `qa3-${Date.now()}` });
    saleOut = { ...saleOut, saleStatus: sale.status, saleKey: sale.json?.messageKey, fiscalNumber: sale.json?.fiscalNumber ?? null };
    if (sale.json?.id) {
      saleOut.asientos = sql(
        `select je.entry_number, je.date, a.code, l.debit, l.credit from pos_sales s join journal_entries je on je.id in (s.journal_entry_id, s.cost_journal_entry_id) join journal_entry_lines l on l.journal_entry_id=je.id join accounts a on a.id=l.account_id where s.id='${sale.json.id}' order by je.entry_number, a.code`,
      ).split('\n');
    }
    // The void reverses both entries, dated the day of the void.
    if (sale.json?.id) {
      const voided = await api('POST', `/pos/sales/${sale.json.id}/void`, { reason: 'QA3 anulación de verificación' }, { 'Idempotency-Key': `qa3-void-${Date.now()}` });
      saleOut.anulacion = { status: voided.status, key: voided.json?.messageKey ?? null };
      saleOut.reversos = sql(
        `select je.entry_number, je.date, je."entryType", left(je.description, 60) from journal_entries je where je.reverses_entry_id in (select unnest(array[journal_entry_id, cost_journal_entry_id]) from pos_sales where id='${sale.json.id}') order by 1`,
      ).split('\n');
    }
    const report = await api('GET', `/pos/shifts/${shift.id}/report`);
    const expected = Number(report.json?.expectedCash ?? 0);
    const noReason = await api('POST', `/pos/shifts/${shift.id}/close`, { closingBalance: expected + 475 });
    const withReason = await api('POST', `/pos/shifts/${shift.id}/close`, { closingBalance: expected + 475, closingNotes: 'QA3 sobrante de prueba' });
    saleOut.cierreSinMotivo = { status: noReason.status, key: noReason.json?.messageKey };
    saleOut.cierreConMotivo = { status: withReason.status, variance: withReason.json?.closingVariance, notes: withReason.json?.closingNotes };
  }
  out('C02-B09-caja', saleOut);

  // M09 — nómina calculada avisa a quien puede aprobarla.
  const before = Number(sql(`select count(*) from notification`));
  const run = await api('POST', '/payroll/runs', { periodYear: 2026, periodMonth: MONTH, runType: 'REGULAR', name: `QA3 Nómina ${MONTH}/2026 (verificación)` });
  // A previous pass may have left the November draft; it is reused rather than duplicated.
  const runId =
    run.json?.id ??
    sql(`select id from payroll_runs where period_year=2026 and period_month=${MONTH} and status in ('DRAFT','CALCULATED') limit 1`);
  const calc = runId ? await api('POST', `/payroll/runs/${runId}/calculate`) : null;
  await page.waitForTimeout(1500);
  const notes = sql(
    `select u.email, n.title_key, n.link from notification n join users u on u.id=n."userId" order by n."createdAt" desc limit 5`,
  );
  out('M09-avisos-nomina', { run: run.status, runKey: run.json?.messageKey, calc: calc?.status, calcKey: calc?.json?.messageKey, calcParams: calc?.json?.params, nuevas: Number(sql(`select count(*) from notification`)) - before, ultimas: notes.split('\n') });
  if (runId) {
    const cancel = await api('POST', `/payroll/runs/${runId}/cancel`);
    out('M09-limpieza', { cancel: cancel.status, key: cancel.json?.messageKey });
  }

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
