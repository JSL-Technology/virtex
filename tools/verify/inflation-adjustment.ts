/**
 * Executable proof of the restatement for inflation (IAS 29; audit 2026-11-07, FIN-AC-04), over the
 * real HTTP API of freshly provisioned QA companies. Run it as `virtex_app` too.
 *
 * ## What it used to be
 *
 * `balance × monthly rate` from a per-organization table nothing could fill (`inflation_indices`, no
 * endpoint, 0 rows), on the balance at the END of the month, with no notion of when an amount
 * originated and nothing to stop the same month being restated twice; the journal it posted to was
 * not provisioned and there was no screen.
 *
 * ## What this proves
 *
 *  - An Argentine company starts restating at the year end with the FACPCE series, capital kept at
 *    nominal value with «Ajuste de Capital» beside it; a Dominican one restates nothing.
 *  - A month is restated from the month each amount originated, and the gain or loss on the net
 *    monetary position the run books equals the loss on the money the company held, computed apart.
 *  - Posting is idempotent; an earlier month is refused while a later one is restated; a revised
 *    index makes the run outdated and «replace» books the current figure; the run is undone only as
 *    a run, never by reversing its entry by hand.
 *  - A monetary account cannot be marked as restated.
 */
import { bootApplication, qaCompanySession } from './support/qa-company-session';

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

type Line = { accountId: string; accountCode: string; postedAccountCode: string; adjustment: string };
type Outlook = {
  blockers: Array<{ key: string; params?: Record<string, unknown> }>;
  lines: Line[];
  netMonetaryResult: string;
  current: boolean | null;
  run: { id: string } | null;
  policy: string;
  seriesCode: string | null;
};
type RunResponse = { created: boolean; run: { id: string; status: string; journalEntryId: string | null; netMonetaryResult: string } };

/** The loss on holding `amount` of money from index `from` to index `to`, in cents. */
const lossOn = (amount: number, from: number, to: number) => Math.round(amount * (to / from - 1) * 100);

async function main() {
  const app = await bootApplication();
  const company = await qaCompanySession(app, 'Ajuste', 'pro', 'AR');
  check('an Argentine company is provisioned and its owner signs in', company.signedIn, company.organizationId);

  // ── Provisioned from the market ───────────────────────────────────────────────────────────
  const closing = (await company.call('GET', '/api/v1/organizations/settings/closing')).json<{ fields: Record<string, unknown> }>();
  check(
    'it restates at the year end with the FACPCE series (RT 6)',
    closing.fields['inflationAdjustmentPolicy'] === 'YEAR_END' && closing.fields['inflationIndexSeriesCode'] === 'AR-FACPCE',
    JSON.stringify(closing.fields),
  );
  const accounts = await company.query<{ id: string; code: string; system_role: string | null; is_inflation_adjustable: boolean; target: string | null }>(
    `SELECT a.id, a.code, a.system_role, a.is_inflation_adjustable, t.code AS target
       FROM accounts a LEFT JOIN accounts t ON t.id = a.inflation_adjustment_account_id
      WHERE a.organization_id = $1 AND a."isPostable"`,
    [company.organizationId],
  );
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const cash = accounts.find((account) => account.system_role === 'CASH')!;
  const capital = byCode.get('3100')!;
  const equipment = byCode.get('1210')!;
  const sales = accounts.find((account) => account.system_role === 'SALES_REVENUE')!;
  const recpam = accounts.find((account) => account.system_role === 'INFLATION_ADJUSTMENT')!;
  check(
    'capital stays at nominal value, its restatement in «Ajuste de Capital»; money and RECPAM are never restated',
    capital?.target === '3110' && !byCode.get('3110')?.is_inflation_adjustable && !cash.is_inflation_adjustable && !recpam.is_inflation_adjustable && equipment.is_inflation_adjustable,
    `3100→${capital?.target}`,
  );

  // ── The index: months the platform has not loaded, recorded by the company ────────────────
  const index: Record<string, string> = { '2026-01': '110', '2026-02': '121', '2026-10': '200' };
  const recorded = await company.call('POST', '/api/v1/price-indices/AR-FACPCE/values', {
    values: Object.entries(index).map(([period, value]) => ({ period, value, reference: 'QA' })),
  });
  check('the company records the months of the index', recorded.statusCode === 200 && recorded.json<{ recorded: number }>().recorded === 3, recorded.body);
  const again = await company.call('POST', '/api/v1/price-indices/AR-FACPCE/values', { values: [{ period: '2026-01', value: '110.000' }] });
  check('recording the same figure again records nothing', again.json<{ unchanged: number }>().unchanged === 1, again.body);
  const future = await company.call('POST', '/api/v1/price-indices/AR-FACPCE/values', { values: [{ period: '2999-01', value: '1' }] });
  check('a month that has not begun has no index', future.statusCode === 422 && future.body.includes('price_indices.period_in_future'), future.body.slice(0, 160));

  // ── The books: capital in January, equipment bought in January, a sale in February ───────
  const [general] = await company.query<{ id: string }>(`SELECT id FROM journals WHERE organization_id = $1 AND code = 'GENERAL'`, [company.organizationId]);
  let sequence = 0;
  const post = (date: string, lines: Array<{ accountId: string; debit?: number; credit?: number }>) =>
    company.call(
      'POST',
      '/api/v1/journal-entries',
      { date, description: 'QA reexpresión', journalId: general.id, lines: lines.map((line) => ({ debit: 0, credit: 0, ...line })) },
      { 'idempotency-key': `qa-ajuste-${Date.now()}-${sequence++}` },
    );
  const posted = [
    await post('2026-01-10', [{ accountId: cash.id, debit: 1000 }, { accountId: capital.id, credit: 1000 }]),
    await post('2026-01-20', [{ accountId: equipment.id, debit: 600 }, { accountId: cash.id, credit: 600 }]),
    await post('2026-02-15', [{ accountId: cash.id, debit: 500 }, { accountId: sales.id, credit: 500 }]),
  ];
  check('three entries are posted', posted.every((response) => response.statusCode === 201), posted.map((r) => r.statusCode).join(','));

  // ── What October's restatement books ──────────────────────────────────────────────────────
  const outlook = (await company.call('GET', '/api/v1/accounting/inflation-adjustment/outlook?period=2026-10')).json<Outlook>();
  const adjustment = (id: string) => outlook.lines.filter((line) => line.accountId === id).reduce((sum, line) => sum + Number(line.adjustment), 0);
  check('nothing blocks October', outlook.blockers.length === 0, JSON.stringify(outlook.blockers));
  check(
    'each amount is restated from the month it originated',
    adjustment(equipment.id) === 490.91 && adjustment(capital.id) === -818.18 && adjustment(sales.id) === -326.45 && adjustment(cash.id) === 0,
    `equipo ${adjustment(equipment.id)}, capital ${adjustment(capital.id)}, ventas ${adjustment(sales.id)}`,
  );
  check(
    'capital’s restatement is posted to «Ajuste de Capital»',
    outlook.lines.find((line) => line.accountId === capital.id)?.postedAccountCode === '3110',
  );
  // 400 held since January (110 → 200), 500 since February (121 → 200).
  const expectedLoss = (lossOn(400, 110, 200) + lossOn(500, 121, 200)) / 100;
  check(
    'the gain or loss on the net monetary position equals the loss on the money held',
    Number(outlook.netMonetaryResult) === expectedLoss,
    `${outlook.netMonetaryResult} = ${expectedLoss}`,
  );

  // ── Posting, once ─────────────────────────────────────────────────────────────────────────
  const runKey = `qa-ajuste-run-${Date.now()}`;
  const first = await company.call('POST', '/api/v1/accounting/inflation-adjustment/runs', { period: '2026-10' }, { 'idempotency-key': runKey });
  const firstBody = first.json<RunResponse>();
  check('October is restated', first.statusCode === 200 && firstBody.created && Boolean(firstBody.run.journalEntryId), first.body.slice(0, 200));
  const replay = await company.call('POST', '/api/v1/accounting/inflation-adjustment/runs', { period: '2026-10' }, { 'idempotency-key': runKey });
  check('a retried request answers what the first did', replay.statusCode === 200 && replay.json<RunResponse>().run.id === firstBody.run.id, replay.body.slice(0, 120));
  const second = await company.call('POST', '/api/v1/accounting/inflation-adjustment/runs', { period: '2026-10' }, { 'idempotency-key': `${runKey}-2` });
  check(
    'a second run of the month finds the first',
    second.statusCode === 200 && second.json<RunResponse>().created === false && second.json<RunResponse>().run.id === firstBody.run.id,
  );
  const [entry] = await company.query<{ system_reason: string; journal: string }>(
    `SELECT e.system_reason, j.code AS journal FROM journal_entries e JOIN journals j ON j.id = e.journal_id WHERE e.id = $1`,
    [firstBody.run.journalEntryId],
  );
  check('its entry is in the inflation-adjustment journal, marked as the restatement', entry?.journal === 'AJU-INF' && entry?.system_reason === 'inflation-adjustment');
  const recpamBalance = await company.query<{ balance: string }>(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS balance FROM journal_entry_lines l WHERE l.journal_entry_id = $1 AND l.account_id = $2`,
    [firstBody.run.journalEntryId, recpam.id],
  );
  check('the entry books it to the RECPAM account', Number(recpamBalance[0]?.balance) === expectedLoss, recpamBalance[0]?.balance);
  const byHand = await company.call('POST', `/api/v1/journal-entries/${firstBody.run.journalEntryId}/reverse`, { reversalDate: '2026-10-31', reason: 'QA' }, {
    'idempotency-key': `qa-ajuste-reverse-${Date.now()}`,
  });
  check('its entry cannot be reversed by hand: the run is', byHand.statusCode >= 400 && byHand.statusCode < 500, `${byHand.statusCode}`);

  // ── Order, revision, replacement ──────────────────────────────────────────────────────────
  const earlier = await company.call('POST', '/api/v1/accounting/inflation-adjustment/runs', { period: '2026-02' }, { 'idempotency-key': `qa-ajuste-feb-${Date.now()}` });
  check('an earlier month is refused while October is restated', earlier.statusCode === 409 && earlier.body.includes('later_period_restated'), earlier.body.slice(0, 160));
  await company.call('POST', '/api/v1/price-indices/AR-FACPCE/values', { values: [{ period: '2026-10', value: '210', reference: 'QA revisado' }] });
  const outdated = (await company.call('GET', '/api/v1/accounting/inflation-adjustment/outlook?period=2026-10')).json<Outlook>();
  check('a revised index makes the run outdated', outdated.current === false && outdated.run?.id === firstBody.run.id);
  const replaced = await company.call('POST', '/api/v1/accounting/inflation-adjustment/runs', { period: '2026-10', replace: true }, {
    'idempotency-key': `qa-ajuste-replace-${Date.now()}`,
  });
  const replacedBody = replaced.json<RunResponse>();
  const statuses = await company.query<{ status: string }>(
    `SELECT status FROM inflation_adjustment_runs WHERE organization_id = $1 ORDER BY ran_at`,
    [company.organizationId],
  );
  check(
    '«replace» reverses the run and books the current figure',
    replaced.statusCode === 200 && replacedBody.created && statuses.map((row) => row.status).join(',') === 'REVERSED,POSTED',
    statuses.map((row) => row.status).join(','),
  );
  const current = (await company.call('GET', '/api/v1/accounting/inflation-adjustment/outlook?period=2026-10')).json<Outlook>();
  check('after it, the books hold the restatement', current.current === true && current.lines.length === 0);
  const undone = await company.call('POST', `/api/v1/accounting/inflation-adjustment/runs/${replacedBody.run.id}/reverse`, { reason: 'QA' }, {
    'idempotency-key': `qa-ajuste-undo-${Date.now()}`,
  });
  check('the latest run is undone as a run', undone.statusCode === 200 && undone.json<{ status: string }>().status === 'REVERSED', undone.body.slice(0, 120));

  // ── The classification holds ──────────────────────────────────────────────────────────────
  const monetary = await company.call('PATCH', `/api/v1/chart-of-accounts/${cash.id}`, { isInflationAdjustable: true, reasonForChange: 'QA reexpresión' });
  check('cash cannot be marked as restated', monetary.statusCode === 400 && monetary.body.includes('restatement_only_non_monetary'), monetary.body.slice(0, 160));
  // A partial edit changes what it names: renaming accumulated depreciation keeps it postable,
  // active and a contra account (it used to reset all three to the create DTO's defaults).
  const accumulated = accounts.find((account) => account.system_role === 'ACCUMULATED_DEPRECIATION')!;
  const renamed = await company.call('PATCH', `/api/v1/chart-of-accounts/${accumulated.id}`, {
    name: 'Depreciación acumulada QA',
    reasonForChange: 'QA renombrar la cuenta',
  });
  const [kept] = await company.query<{ isPostable: boolean; is_contra_account: boolean; isActive: boolean; is_inflation_adjustable: boolean }>(
    `SELECT "isPostable", is_contra_account, "isActive", is_inflation_adjustable FROM accounts WHERE id = $1`,
    [accumulated.id],
  );
  check(
    'a partial edit keeps what it left out',
    renamed.statusCode === 200 && kept.isPostable && kept.is_contra_account && kept.isActive && kept.is_inflation_adjustable,
    `${renamed.statusCode} ${JSON.stringify(kept)}`,
  );

  // ── A market whose economy does not call for it ───────────────────────────────────────────
  const dominican = await qaCompanySession(app, 'AjusteDo');
  const doOutlook = (await dominican.call('GET', '/api/v1/accounting/inflation-adjustment/outlook?period=2026-10')).json<Outlook>();
  check(
    'a Dominican company does not restate: no policy, no series',
    doOutlook.policy === 'NONE' && doOutlook.seriesCode === null && doOutlook.blockers.some((blocker) => blocker.key === 'inflation_adjustment.series_not_configured'),
    `${doOutlook.policy} ${doOutlook.seriesCode}`,
  );
  const doRun = await dominican.call('POST', '/api/v1/accounting/inflation-adjustment/runs', { period: '2026-10' }, { 'idempotency-key': `qa-ajuste-do-${Date.now()}` });
  check('and a run is refused, saying why', doRun.statusCode === 422 && doRun.body.includes('series_not_configured'), doRun.body.slice(0, 160));

  await app.close();
  console.log(failures.length === 0 ? '\nAll inflation-adjustment checks passed.' : `\n${failures.length} check(s) failed.`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
