/**
 * Executable proof of the fixed-asset fixes of audit 2026-11-07 (FINB-11, FINB-13, FINB-14,
 * FINB-17), over the real HTTP API of a freshly provisioned QA company. Run it as `virtex_app` too.
 *
 *  - FINB-14: an asset bought on the 30th of February is refused with a 400 that names the field —
 *    it answered a 500 — and a real day is accepted.
 *  - FINB-11: the sum of the years' digits over 18 months weighs the last six as half a year — the
 *    last month charged 350 after five of 50 — and the double declining balance switches to
 *    straight line instead of taking the rest in its last month.
 *  - FINB-13: the month still running, or one years away, is previewed but not posted; the month
 *    that has ended is.
 *  - FINB-12: the company chooses the convention a new asset follows, over its settings; each asset
 *    may name its own, fixed once charged; a month in service in part is charged its part, and the
 *    month an asset is sold in is charged through the day it leaves, in the sale's own entry.
 *  - FINB-17: a run is a document — trigger, who, month, totals — listed and readable; each entry
 *    it posts names it and leads to it; running again charges nothing and records nothing. A
 *    disposal's entry is the register's, locked and leading to the asset; the months it was still
 *    due are charged by the disposal's own run, which names the asset.
 *  - FINB-16: a Dominican company starts with the DGII's categories, named in its books language
 *    and translated; a category of its own takes the authority's method and rate, and an asset
 *    registered in it takes what it gives and opens its tax book; the run charges both books and
 *    posts only the accounting one; the tax report gives the deduction, what is left and the
 *    temporary difference; a book that has charged fixes its basis, keeps its history and closes
 *    with the disposal; the fields a refusal names read in the reader's language.
 *  - FINB-15: an asset must say how its cost entered the ledger. Registering posts its acquisition,
 *    locked and leading to the asset, or links the bill or the entry that brought the cost in —
 *    never for more than it debited the asset account; that bill cannot be voided nor that entry
 *    reversed from under the asset. An asset registered before the rule is linked afterwards, and
 *    relinking one whose acquisition was posted here reverses it first. The reconciliation sets each
 *    account of the register against the ledger, and explains the difference to the cent — on any
 *    day; the close's checklist says what the close will depreciate and whether the register agrees.
 */
import { DataSource } from 'typeorm';
import { bootApplication, qaCompanySession } from './support/qa-company-session';
import { organizationToday } from '../../apps/backend/api/src/app/organizations/contracts/fiscal-today.contract';
import { lastEndedMonth } from '../../apps/backend/api/src/app/fixed-assets/depreciation.service';
import { runAsTenantJob } from '../../apps/backend/api/src/app/shared/tenancy/tenant-job';
import { ensureFiscalYearWithPeriods } from '../../apps/backend/api/src/app/accounting/provisioning/fiscal-calendar';
import { LEDGER_STATUSES_SQL } from '../../apps/backend/api/src/app/contracts/accounting/ledger-statuses.contract';

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

interface Asset {
  id: string;
  number: string;
  status: string;
  accumulatedDepreciation: number;
  depreciatedThrough: string | null;
  disposalJournalEntryId: string | null;
}
interface Schedule {
  posted: Array<{ periodEnd: string; amount: number; runId: string | null }>;
  projected: Array<{ periodEnd: string; amount: number }>;
}
interface RunResult {
  runId: string | null;
  journalEntryId: string | null;
  total: number;
  assets: Array<{ id: string; months: number; amount: number }>;
  postable: boolean;
  notPostable: { key: string; params: Record<string, unknown> } | null;
}
interface RunSummary {
  id: string;
  periodEnd: string;
  trigger: string;
  fixedAsset: { id: string; number: string } | null;
  ranByName: string | null;
  assetCount: number;
  chargeCount: number;
  total: number;
}
interface RunDetail extends RunSummary {
  charges: Array<{ fixedAssetId: string; periodEnd: string; amount: number; journalEntryId: string }>;
  entries: Array<{ id: string; entryNumber: string | null; date: string; total: number }>;
}
interface Entry {
  lines?: Array<{ accountId: string; debit: number | string; credit: number | string }>;
  systemReason: string | null;
  idempotencyKey: string | null;
  origin: { locked: boolean; reason: string | null; document: { type: string; id: string; route: string | null } | null };
}

const cents = (values: number[]) => values.reduce((sum, value) => sum + Math.round(value * 100), 0);

/** Every write the register takes is idempotent: each request carries a key of its own. */
let sequence = 0;
const freshKey = () => ({ 'idempotency-key': `qa-activos-${Date.now()}-${sequence++}` });

async function main() {
  const app = await bootApplication();
  const company = await qaCompanySession(app, 'Activos', 'pro', 'DO');
  check('a Dominican company is provisioned and its owner signs in', company.signedIn, company.organizationId);
  const ds = app.get(DataSource);

  // Today in the company's own calendar, read in its tenant context as the API reads it.
  const today = await runAsTenantJob(ds, company.organizationId, () => organizationToday(ds.manager, company.organizationId));
  const ended = lastEndedMonth(today);
  const running = today.slice(0, 7);
  console.log(`  hoy en el calendario de la empresa: ${today}; último mes terminado: ${ended.slice(0, 7)}`);

  const accounts = Object.fromEntries(
    (
      await company.query<{ code: string; id: string }>(
        `SELECT code, id FROM accounts WHERE organization_id = $1 AND code IN ('1120', '1210', '1220', '5500', '4900', '5900')`,
        [company.organizationId],
      )
    ).map((row) => [row.code, row.id]),
  );
  check('the chart has the accounts the register posts to', Object.keys(accounts).length === 6, Object.keys(accounts).sort().join(', '));

  // Months relative to the one that ended: assets bought two months before it are due a catch-up.
  const year = Number(ended.slice(0, 4));
  const month = (offset: number) => {
    const date = new Date(Date.UTC(year, Number(ended.slice(5, 7)) - 1 + offset, 1));
    return date.toISOString().slice(0, 7);
  };
  // The assets below entered service two months before the last that ended: in January and
  // February those months are last year's, and the company keeps that year's calendar too — as one
  // that has been trading does. Idempotent: in any other month it finds the year already there.
  await runAsTenantJob(ds, company.organizationId, () =>
    ensureFiscalYearWithPeriods(ds.manager, company.organizationId, `${month(-2).slice(0, 4)}-01-01`),
  );

  // Every asset says how its cost entered the ledger (FINB-15): unless the body says otherwise —
  // or sends none, to see the refusal —, its acquisition is posted here, against the bank.
  const postedAgainstBank = { method: 'POSTED', offsetAccountId: accounts['1120'] };
  const register = (body: Record<string, unknown>) =>
    company.call(
      'POST',
      '/api/v1/fixed-assets',
      {
        assetAccountId: accounts['1210'],
        accumulatedDepreciationAccountId: accounts['1220'],
        depreciationExpenseAccountId: accounts['5500'],
        capitalization: postedAgainstBank,
        ...body,
      },
      freshKey(),
    );

  // ── FINB-14: a day that does not exist ─────────────────────────────────────────────────────
  const impossible = await register({ name: 'QA-Febrero 30', acquisitionDate: `${year}-02-30`, cost: 1_000, usefulLifeMonths: 12 });
  const impossibleBody = impossible.json<{ fieldErrors?: Array<{ property: string }> }>();
  check(
    'an asset bought on the 30th of February is refused with a 400 that names the field, not a 500 (FINB-14)',
    impossible.statusCode === 400 && (impossibleBody.fieldErrors ?? []).some((error) => error.property === 'acquisitionDate'),
    `HTTP ${impossible.statusCode} ${JSON.stringify(impossibleBody.fieldErrors ?? [])}`,
  );

  // ── FINB-11: the accelerated methods over the real life ────────────────────────────────────
  const syd = await register({
    name: 'QA-Dígitos 18 meses',
    acquisitionDate: `${month(-2)}-01`,
    cost: 1_800,
    usefulLifeMonths: 18,
    depreciationMethod: 'SUM_OF_YEARS_DIGITS',
  });
  check('a real day is accepted', syd.statusCode === 201, `HTTP ${syd.statusCode}`);
  const sydAsset = syd.json<Asset>();
  const sydBoard = (await company.call('GET', `/api/v1/fixed-assets/${sydAsset.id}/schedule`)).json<Schedule>();
  const sydAmounts = sydBoard.projected.map((row) => row.amount);
  check(
    'the sum of the years\' digits over 18 months never charges a month more than the one before, and adds up (FINB-11)',
    // In cents: a year's months are equal but for the cent the rounding hands one of them.
    sydAmounts.length === 18 &&
      sydAmounts.every((amount, index) => index === 0 || Math.round(amount * 100) <= Math.round(sydAmounts[index - 1] * 100) + 1) &&
      cents(sydAmounts) === 180_000,
    sydAmounts.join(' · '),
  );
  check(
    'its last six months weigh as half a year: about 42.86 each, where the last one charged 350',
    sydAmounts.slice(12).every((amount) => Math.abs(amount - 42.86) <= 0.02),
    sydAmounts.slice(12).join(' · '),
  );

  const ddb = await register({
    name: 'QA-Doble saldo 12 meses',
    acquisitionDate: `${month(-2)}-01`,
    cost: 1_000,
    usefulLifeMonths: 12,
    depreciationMethod: 'DOUBLE_DECLINING_BALANCE',
  });
  const ddbBoard = (await company.call('GET', `/api/v1/fixed-assets/${ddb.json<Asset>().id}/schedule`)).json<Schedule>();
  const ddbAmounts = ddbBoard.projected.map((row) => row.amount);
  check(
    'the double declining balance switches to straight line: the last month is no spike (FINB-11)',
    ddbAmounts.length === 12 && Math.round(ddbAmounts[11] * 100) <= Math.round(ddbAmounts[10] * 100) + 1 && cents(ddbAmounts) === 100_000,
    `${ddbAmounts.slice(-3).join(' · ')} (antes: 26,92 y luego 134,58)`,
  );

  // ── FINB-13: a month that has not ended ────────────────────────────────────────────────────
  const truck = await register({ name: 'QA-Camioneta', acquisitionDate: `${month(-2)}-10`, cost: 120_000, usefulLifeMonths: 60 });
  const truckAsset = truck.json<Asset>();
  const runningPreview = (await company.call('GET', `/api/v1/fixed-assets/depreciation-runs/preview?period=${running}`)).json<RunResult>();
  check(
    'the month still running is previewed, with what it will charge, and marked not postable (FINB-13)',
    runningPreview.postable === false &&
      runningPreview.notPostable?.key === 'fixed_assets.depreciation_period_not_ended' &&
      runningPreview.assets.some((row) => row.id === truckAsset.id),
    JSON.stringify(runningPreview.notPostable),
  );
  const runningRun = await company.call('POST', '/api/v1/fixed-assets/depreciation-runs', { period: running }, freshKey());
  check(
    'posting the month still running is refused with a 422 that says why',
    runningRun.statusCode === 422 && runningRun.json<{ messageKey?: string }>().messageKey === 'fixed_assets.depreciation_period_not_ended',
    `HTTP ${runningRun.statusCode} ${runningRun.body}`,
  );
  const farRun = await company.call('POST', '/api/v1/fixed-assets/depreciation-runs', { period: `${year + 3}-12` }, freshKey());
  check('and so is a month three years away — it offered to post 25 future months', farRun.statusCode === 422, `HTTP ${farRun.statusCode}`);
  const nothingCharged = await company.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM fixed_asset_depreciations WHERE organization_id = $1`,
    [company.organizationId],
  );
  check('nothing was charged by either attempt', nothingCharged[0].count === 0);
  const endedPreview = (await company.call('GET', `/api/v1/fixed-assets/depreciation-runs/preview?period=${ended.slice(0, 7)}`)).json<RunResult>();
  check('the month that has ended is postable', endedPreview.postable === true && endedPreview.notPostable === null);

  // ── FINB-17: the run is a document ─────────────────────────────────────────────────────────
  const posted = await company.call('POST', '/api/v1/fixed-assets/depreciation-runs', { period: ended.slice(0, 7) }, freshKey());
  const result = posted.json<RunResult>();
  const truckRow = result.assets.find((row) => row.id === truckAsset.id);
  check(
    'the month that ended posts: the truck is charged its three months (FINB-13)',
    posted.statusCode === 201 && truckRow?.months === 3 && truckRow.amount === 6_000 && Boolean(result.runId),
    `HTTP ${posted.statusCode}, run ${result.runId}`,
  );
  const listed = (await company.call('GET', '/api/v1/fixed-assets/depreciation-runs')).json<{ rows: RunSummary[] }>();
  const listedRun = listed.rows.find((row) => row.id === result.runId);
  check(
    'the board lists the run: started by hand, by the owner, through the month, with its totals (FINB-17)',
    listedRun?.trigger === 'MANUAL' && listedRun.ranByName === 'QA Activos' && listedRun.periodEnd === ended && listedRun.total === result.total && listedRun.assetCount === 3,
    JSON.stringify(listedRun),
  );
  const detail = (await company.call('GET', `/api/v1/fixed-assets/depreciation-runs/${result.runId}`)).json<RunDetail>();
  const truckCharges = detail.charges.filter((row) => row.fixedAssetId === truckAsset.id);
  check(
    'the run reads back each month it charged and the entries — one per month — that carry them',
    truckCharges.length === 3 && detail.entries.length === 3 && detail.entries.map((entry) => entry.date).join() === [month(-2), month(-1), month(0)].map((m) => `${m}-${new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()}`).join(),
    detail.entries.map((entry) => `${entry.entryNumber} ${entry.date}`).join(', '),
  );
  const entry = (await company.call('GET', `/api/v1/journal-entries/${detail.entries[0].id}`)).json<Entry>();
  check(
    'each entry names its run, is locked in the journal, and leads to the run',
    entry.systemReason === 'depreciation-run' &&
      entry.idempotencyKey === `depreciation-run:${result.runId}:${detail.entries[0].date}` &&
      entry.origin.locked === true &&
      entry.origin.document?.route === `/accounting/fixed-assets/depreciation-runs/${result.runId}`,
    JSON.stringify(entry.origin),
  );
  const again = await company.call('POST', '/api/v1/fixed-assets/depreciation-runs', { period: ended.slice(0, 7) }, freshKey());
  const runsAfter = (await company.call('GET', '/api/v1/fixed-assets/depreciation-runs')).json<{ total: number }>();
  check(
    'running it again charges nothing and records no run',
    again.statusCode === 201 && again.json<RunResult>().runId === null && again.json<RunResult>().assets.length === 0 && runsAfter.total === 1,
    `runs: ${runsAfter.total}`,
  );
  const board = (await company.call('GET', `/api/v1/fixed-assets/${truckAsset.id}/schedule`)).json<Schedule>();
  check('the asset\'s board says which run charged each month', board.posted.length === 3 && board.posted.every((row) => row.runId === result.runId));

  // ── FINB-17: a disposal is a document of the register ──────────────────────────────────────
  const van = await register({ name: 'QA-Furgón', acquisitionDate: `${month(-2)}-05`, cost: 120_000, usefulLifeMonths: 60 });
  const vanAsset = van.json<Asset>();
  const disposed = await company.call(
    'POST',
    `/api/v1/fixed-assets/${vanAsset.id}/dispose`,
    {
      disposalDate: today,
      salePrice: 100_000,
      disposalReason: 'Venta a tercero',
      cashAccountId: accounts['1120'],
      lossOnDisposalAccountId: accounts['5900'],
    },
    freshKey(),
  );
  const sold = disposed.json<Asset>();
  check(
    'the van is sold after its three months due are charged',
    disposed.statusCode === 201 && sold.status === 'SOLD' && sold.accumulatedDepreciation === 6_000 && sold.depreciatedThrough === ended,
    `HTTP ${disposed.statusCode} ${sold.status} ${sold.accumulatedDepreciation}`,
  );
  const disposalEntry = (await company.call('GET', `/api/v1/journal-entries/${sold.disposalJournalEntryId}`)).json<Entry>();
  check(
    'its entry is the register\'s: reason set, locked, leading to the asset — it read as a manual entry (FINB-17)',
    disposalEntry.systemReason === 'fixed-asset-disposal' &&
      disposalEntry.origin.locked === true &&
      disposalEntry.origin.document?.route === `/accounting/fixed-assets/${vanAsset.id}`,
    JSON.stringify(disposalEntry.origin),
  );
  const disposalRuns = (await company.call('GET', '/api/v1/fixed-assets/depreciation-runs?trigger=DISPOSAL')).json<{ rows: RunSummary[] }>();
  check(
    'the months it was still due were charged by the disposal\'s own run, which names the asset and who disposed of it',
    disposalRuns.rows.length === 1 &&
      disposalRuns.rows[0].fixedAsset?.id === vanAsset.id &&
      disposalRuns.rows[0].chargeCount === 3 &&
      disposalRuns.rows[0].ranByName === 'QA Activos',
    JSON.stringify(disposalRuns.rows[0]),
  );
  const forAsset = (await company.call('GET', `/api/v1/fixed-assets/depreciation-runs?fixedAssetId=${truckAsset.id}`)).json<{ rows: RunSummary[] }>();
  check('the runs that charged one asset can be listed', forAsset.rows.length === 1 && forAsset.rows[0].id === result.runId);
  const missing = await company.call('GET', '/api/v1/fixed-assets/depreciation-runs/00000000-0000-4000-8000-0000000000ab');
  check('a run that does not exist answers 404', missing.statusCode === 404, `HTTP ${missing.statusCode}`);

  // ── FINB-12: where the life sits on the calendar ───────────────────────────────────────────
  const setting = await company.call('PATCH', '/api/v1/organizations/settings/accounting', { fields: { defaultDepreciationConvention: 'DAILY' } });
  check(
    'the company chooses the convention its new assets follow, in its accounting settings (FINB-12)',
    setting.statusCode === 200 && setting.json<{ fields: Record<string, unknown> }>().fields['defaultDepreciationConvention'] === 'DAILY',
    `HTTP ${setting.statusCode}`,
  );
  const badSetting = await company.call('PATCH', '/api/v1/organizations/settings/accounting', { fields: { defaultDepreciationConvention: 'WHENEVER' } });
  check('a convention that does not exist is refused', badSetting.statusCode === 400, `HTTP ${badSetting.statusCode}`);

  // In service on the 21st of the month two before the last that ended: eleven or so days of it.
  const crane = await register({ name: 'QA-Grúa', acquisitionDate: `${month(-2)}-21`, cost: 120_000, usefulLifeMonths: 60 });
  const craneAsset = crane.json<Asset & { depreciationConvention: string }>();
  const named = await register({ name: 'QA-Montacargas', acquisitionDate: `${month(-2)}-21`, cost: 120_000, usefulLifeMonths: 60, depreciationConvention: 'NEXT_MONTH' });
  const namedAsset = named.json<Asset & { depreciationConvention: string }>();
  check(
    'a new asset follows the company\'s convention unless it names its own',
    craneAsset.depreciationConvention === 'DAILY' && namedAsset.depreciationConvention === 'NEXT_MONTH',
    `${craneAsset.depreciationConvention} / ${namedAsset.depreciationConvention}`,
  );
  const firstMonthEnd = new Date(Date.UTC(year, Number(month(-2).slice(5, 7)), 0)).getUTCDate();
  const expectedFirst = Math.round((2_000 * (firstMonthEnd - 20)) / firstMonthEnd * 100) / 100;
  const craneBoard = (await company.call('GET', `/api/v1/fixed-assets/${craneAsset.id}/schedule`)).json<Schedule>();
  const namedBoard = (await company.call('GET', `/api/v1/fixed-assets/${namedAsset.id}/schedule`)).json<Schedule>();
  check(
    'by days: the month it entered service is charged the days it was in service; the life ends in part, 61 months on',
    craneBoard.projected[0].amount === expectedFirst && craneBoard.projected.length === 61 && cents(craneBoard.projected.map((row) => row.amount)) === 12_000_000,
    `${craneBoard.projected[0].periodEnd} ${craneBoard.projected[0].amount} (esperado ${expectedFirst}); ${craneBoard.projected.length} meses`,
  );
  check(
    'from the following month: nothing in the month it entered service',
    namedBoard.projected[0].periodEnd.slice(0, 7) === month(-1) && namedBoard.projected[0].amount === 2_000 && namedBoard.projected.length === 60,
    `${namedBoard.projected[0].periodEnd} ${namedBoard.projected[0].amount}`,
  );

  // The month that ended is charged: the forklift's two whole months, and the crane's days and months.
  const secondRun = await company.call('POST', '/api/v1/fixed-assets/depreciation-runs', { period: ended.slice(0, 7) }, freshKey());
  const forklift = secondRun.json<RunResult>().assets.find((row) => row.id === namedAsset.id);
  check('the run charges each asset by its own convention', secondRun.statusCode === 201 && forklift?.months === 2 && forklift.amount === 4_000, JSON.stringify(forklift));
  const lockedConvention = await company.call('PATCH', `/api/v1/fixed-assets/${namedAsset.id}`, { depreciationConvention: 'DAILY' });
  check(
    'an asset already charged keeps its convention: it decided how much its first month took',
    lockedConvention.statusCode === 409 && lockedConvention.json<{ messageKey?: string }>().messageKey === 'fixed_assets.valuation_locked_after_depreciation',
    `HTTP ${lockedConvention.statusCode}`,
  );

  // Sold on the 10th of this month: the months before charged, and ten days of this one in the sale's entry.
  const saleDay = `${running}-10` <= today ? `${running}-10` : today;
  const craneSold = await company.call(
    'POST',
    `/api/v1/fixed-assets/${craneAsset.id}/dispose`,
    { disposalDate: saleDay, salePrice: 110_000, disposalReason: 'Venta', cashAccountId: accounts['1120'], gainOnDisposalAccountId: accounts['4900'], lossOnDisposalAccountId: accounts['5900'] },
    freshKey(),
  );
  const craneAfter = craneSold.json<Asset>();
  const craneCharges = (await company.call('GET', `/api/v1/fixed-assets/${craneAsset.id}/schedule`)).json<Schedule>().posted;
  const saleMonth = craneCharges.at(-1);
  const daysOfSale = Number(saleDay.slice(8, 10));
  const daysInSaleMonth = new Date(Date.UTC(Number(saleDay.slice(0, 4)), Number(saleDay.slice(5, 7)), 0)).getUTCDate();
  check(
    'the month it is sold in is charged through the day it leaves — it was never charged at all (FINB-12)',
    craneSold.statusCode === 201 &&
      saleMonth?.periodEnd.slice(0, 7) === running &&
      Math.abs((saleMonth?.amount ?? 0) - (2_000 * daysOfSale) / daysInSaleMonth) <= 0.01,
    `${saleMonth?.periodEnd} ${saleMonth?.amount}`,
  );
  const saleEntry = (await company.call('GET', `/api/v1/journal-entries/${craneAfter.disposalJournalEntryId}`)).json<Entry>();
  const expenseLine = (saleEntry.lines ?? []).find((line) => line.accountId === accounts['5500']);
  check(
    'and that charge is in the sale\'s own entry, which leaves the books at the carrying amount on the day',
    Number(expenseLine?.debit ?? 0) === saleMonth?.amount && craneAfter.accumulatedDepreciation === cents(craneCharges.map((row) => row.amount)) / 100,
    `gasto ${expenseLine?.debit}, acumulada ${craneAfter.accumulatedDepreciation}`,
  );

  // ── FINB-16: categories and the tax book ───────────────────────────────────────────────────
  interface Category {
    id: string;
    code: string;
    name: string;
    nameTranslations: Record<string, string>;
    taxCategoryCode: string | null;
    taxMethod: string | null;
    taxAnnualRate: number | null;
  }
  interface TaxBook {
    taxCategoryCode: string | null;
    method: string;
    annualRate: number;
    cost: number;
    accumulatedDepreciation: number;
    closedOn: string | null;
    chargedMonths: number;
  }
  interface Refusal {
    messageKey?: string;
    message?: string;
    code?: string;
    params?: Record<string, unknown>;
  }
  const seeded = (await company.call('GET', '/api/v1/fixed-assets/categories')).json<Category[]>();
  const dgii = seeded.filter((row) => row.code.startsWith('DO-'));
  check(
    'a Dominican company starts with the DGII\'s three categories, at 5, 25 and 15 % on the declining balance (FINB-16)',
    dgii.map((row) => `${row.code}:${row.taxMethod}:${row.taxAnnualRate}`).join() === 'DO-1:DECLINING_BALANCE:0.05,DO-2:DECLINING_BALANCE:0.25,DO-3:DECLINING_BALANCE:0.15',
    dgii.map((row) => `${row.code} ${row.taxAnnualRate}`).join(', '),
  );
  const categoryTwo = dgii.find((row) => row.code === 'DO-2');
  check(
    'named in the books language, and translated for a reader in another',
    Boolean(categoryTwo?.name.startsWith('Categoría 2')) && Boolean(categoryTwo?.nameTranslations['en']?.startsWith('Category 2')),
    `${categoryTwo?.name} / ${categoryTwo?.nameTranslations['en']}`,
  );
  const catalogue = (await company.call('GET', '/api/v1/fixed-assets/tax-categories')).json<{ authority: string; categories: Array<{ code: string }> } | null>();
  check('the market\'s catalogue is the DGII\'s', catalogue?.authority === 'DGII' && catalogue.categories.length === 3, catalogue?.authority);

  const createdCategory = await company.call(
    'POST',
    '/api/v1/fixed-assets/categories',
    {
      code: 'qa-veh',
      name: 'QA-Vehículos',
      nameTranslations: { en: 'QA-Vehicles' },
      usefulLifeMonths: 60,
      depreciationMethod: 'STRAIGHT_LINE',
      depreciationConvention: 'FULL_MONTH',
      residualRate: 0.1,
      assetAccountId: accounts['1210'],
      accumulatedDepreciationAccountId: accounts['1220'],
      depreciationExpenseAccountId: accounts['5500'],
      taxCategoryCode: 'do-2',
    },
    freshKey(),
  );
  const vehicles = createdCategory.json<Category>();
  check(
    'a category of its own takes the authority\'s method and rate from its tax category',
    createdCategory.statusCode === 201 && vehicles.code === 'QA-VEH' && vehicles.taxCategoryCode === 'DO-2' && vehicles.taxMethod === 'DECLINING_BALANCE' && vehicles.taxAnnualRate === 0.25,
    `HTTP ${createdCategory.statusCode} ${vehicles.code} ${vehicles.taxMethod} ${vehicles.taxAnnualRate}`,
  );
  const duplicate = await company.call('POST', '/api/v1/fixed-assets/categories', { code: 'QA-VEH', name: 'Otra' }, freshKey());
  check('its code is unique in the company', duplicate.statusCode === 409 && duplicate.json<Refusal>().messageKey === 'fixed_assets.category_code_taken', `HTTP ${duplicate.statusCode}`);
  const unknown = await company.call('POST', '/api/v1/fixed-assets/categories', { code: 'QA-X', name: 'X', taxCategoryCode: 'DO-9' }, freshKey());
  check(
    'a tax category the DGII does not have is refused, naming the ones it has',
    unknown.statusCode === 400 && unknown.json<Refusal>().messageKey === 'fixed_assets.tax_category_unknown' && unknown.json<Refusal>().params?.['known'] === 'DO-1, DO-2, DO-3',
    `HTTP ${unknown.statusCode} ${JSON.stringify(unknown.json<Refusal>().params)}`,
  );

  const pickup = await company.call(
    'POST',
    '/api/v1/fixed-assets',
    { name: 'QA-Camioneta categoría', acquisitionDate: `${month(-2)}-10`, cost: 120_000, categoryId: vehicles.id, capitalization: postedAgainstBank },
    freshKey(),
  );
  const pickupAsset = pickup.json<Asset & { usefulLifeMonths: number; residualValue: number; depreciationConvention: string; taxBook: TaxBook | null }>();
  check(
    'an asset registered in it takes what it gives — life, residual share, convention, accounts — and opens its tax book',
    pickup.statusCode === 201 &&
      pickupAsset.usefulLifeMonths === 60 &&
      pickupAsset.residualValue === 12_000 &&
      pickupAsset.depreciationConvention === 'FULL_MONTH' &&
      pickupAsset.taxBook?.taxCategoryCode === 'DO-2' &&
      pickupAsset.taxBook.method === 'DECLINING_BALANCE' &&
      pickupAsset.taxBook.cost === 120_000,
    `HTTP ${pickup.statusCode} ${JSON.stringify(pickupAsset.taxBook)}`,
  );

  // The three months it is due, in each book: the accounting one on the depreciable base over the
  // life, the tax one at 25 % of the value at the start of the fiscal year.
  const months = [month(-2), month(-1), month(0)];
  let taxExpected = 0;
  let taxAccumulated = 0;
  let yearBase = 120_000;
  for (const [index, period] of months.entries()) {
    if (index > 0 && period.endsWith('-01')) yearBase = 120_000 - taxAccumulated;
    const charge = Math.round(yearBase * 0.25 * 100 / 12) / 100;
    taxExpected = Math.round((taxExpected + charge) * 100) / 100;
    taxAccumulated = taxExpected;
  }
  const thirdRun = await company.call('POST', '/api/v1/fixed-assets/depreciation-runs', { period: ended.slice(0, 7) }, freshKey());
  const third = thirdRun.json<RunResult & { tax: { total: number; assets: Array<{ id: string; months: number; amount: number }> } }>();
  const pickupBooks = third.assets.find((row) => row.id === pickupAsset.id);
  const pickupTax = third.tax.assets.find((row) => row.id === pickupAsset.id);
  check(
    'the run charges both books: 1 800 a month in the books, 25 % of 120 000 a twelfth in the tax book',
    thirdRun.statusCode === 201 && pickupBooks?.months === 3 && pickupBooks.amount === 5_400 && pickupTax?.months === 3 && Math.abs(pickupTax.amount - taxExpected) <= 0.02,
    `libros ${pickupBooks?.amount}, fiscal ${pickupTax?.amount} (esperado ${taxExpected})`,
  );
  const thirdDetail = (await company.call('GET', `/api/v1/fixed-assets/depreciation-runs/${third.runId}`)).json<RunDetail & { taxTotal: number; taxCharges: unknown[] }>();
  check(
    'and posts only the accounting one: its entries add up to the books\' months, the tax months are recorded apart',
    cents(thirdDetail.entries.map((row) => row.total)) === cents([third.total]) && thirdDetail.taxCharges.length === 3 && thirdDetail.taxTotal === pickupTax?.amount,
    `asientos ${thirdDetail.entries.map((row) => row.total).join(' + ')}; fiscal ${thirdDetail.taxTotal}`,
  );

  interface TaxReport {
    totals: { deduction: number };
    byTaxCategory: Array<{ taxCategoryCode: string | null; deduction: number }>;
    assets: { rows: Array<{ assetId: string; deduction: number; taxValue: number; accountingCarrying: number | null; difference: number | null; disposalDate: string | null }> };
  }
  const reportFrom = `${month(-2).slice(0, 4)}-01`;
  const taxReport = (await company.call('GET', `/api/v1/fixed-assets/tax-depreciation?from=${reportFrom}&to=${ended.slice(0, 7)}`)).json<TaxReport>();
  const pickupRow = taxReport.assets.rows.find((row) => row.assetId === pickupAsset.id);
  const taxValue = Math.round((120_000 - (pickupTax?.amount ?? 0)) * 100) / 100;
  check(
    'the tax report gives its deduction, what is left to deduct, and the temporary difference against the books (IAS 12)',
    pickupRow?.deduction === pickupTax?.amount &&
      pickupRow?.taxValue === taxValue &&
      pickupRow?.accountingCarrying === 114_600 &&
      pickupRow?.difference === Math.round((114_600 - taxValue) * 100) / 100 &&
      taxReport.byTaxCategory.some((group) => group.taxCategoryCode === 'DO-2'),
    JSON.stringify(pickupRow),
  );

  const fixedBasis = await company.call('PATCH', `/api/v1/fixed-assets/${pickupAsset.id}`, { taxBook: { cost: 100_000 } });
  const fields = fixedBasis.json<Refusal>().params?.['fields'] as Record<string, string> | undefined;
  check(
    'once it has charged, its basis is fixed — and the refusal names the field in every language, for each reader to read in theirs',
    fixedBasis.statusCode === 409 &&
      fixedBasis.json<Refusal>().messageKey === 'fixed_assets.tax_book_terms_fixed' &&
      fields?.['es'] === 'Base fiscal' &&
      fields?.['en'] === 'Tax basis' &&
      fields?.['pt'] === 'Base fiscal',
    JSON.stringify(fixedBasis.json<Refusal>().params),
  );
  const newRate = await company.call('PATCH', `/api/v1/fixed-assets/${pickupAsset.id}`, { taxBook: { annualRate: 0.15 } });
  check(
    'its rate changes from the next month on',
    newRate.statusCode === 200 && newRate.json<{ taxBook: TaxBook }>().taxBook.annualRate === 0.15,
    `HTTP ${newRate.statusCode}`,
  );
  const dropBook = await company.call('PATCH', `/api/v1/fixed-assets/${pickupAsset.id}`, { taxBook: null });
  check(
    'and a book that has charged is the record of what was deducted: it cannot be removed',
    dropBook.statusCode === 409 && dropBook.json<Refusal>().messageKey === 'fixed_assets.tax_book_has_charges',
    `HTTP ${dropBook.statusCode}`,
  );
  const deleteUsed = await company.call('DELETE', `/api/v1/fixed-assets/categories/${vehicles.id}`);
  check(
    'a category assets were registered in is not deleted: it says what uses it, and offers to deactivate it',
    deleteUsed.statusCode === 409 && deleteUsed.json<Refusal>().messageKey === 'fixed_assets.category_in_use',
    `HTTP ${deleteUsed.statusCode} ${deleteUsed.json<Refusal>().code}`,
  );

  const pickupSold = await company.call(
    'POST',
    `/api/v1/fixed-assets/${pickupAsset.id}/dispose`,
    { disposalDate: today, salePrice: 100_000, disposalReason: 'Venta', cashAccountId: accounts['1120'], gainOnDisposalAccountId: accounts['4900'], lossOnDisposalAccountId: accounts['5900'] },
    freshKey(),
  );
  const afterSale = (await company.call('GET', `/api/v1/fixed-assets/${pickupAsset.id}`)).json<{ taxBook: TaxBook }>();
  check(
    'the disposal closes its tax book on the day it leaves',
    pickupSold.statusCode === 201 && afterSale.taxBook.closedOn === today,
    `HTTP ${pickupSold.statusCode} cerrado ${afterSale.taxBook.closedOn}`,
  );
  const reportAfter = (await company.call('GET', `/api/v1/fixed-assets/tax-depreciation?from=${running}&to=${running}`)).json<TaxReport>();
  const soldRow = reportAfter.assets.rows.find((row) => row.assetId === pickupAsset.id);
  check(
    'and the report shows it left: no carrying amount and no difference for it',
    soldRow?.disposalDate === today && soldRow.accountingCarrying === null && soldRow.difference === null,
    JSON.stringify(soldRow),
  );

  // ── FINB-15: how each asset's cost entered the ledger, and the register against the ledger ─
  interface Capitalized {
    id: string;
    number: string;
    cost: number;
    capitalizationMethod: string;
    capitalizationEntryId: string | null;
    capitalizationOffsetAccountId: string | null;
    vendorBillId: string | null;
  }
  interface Source { kind: string; id: string; journalEntryId: string; accountId: string; debited: number; registered: number; available: number }
  interface ReconciliationRow { accountId: string; role: string; assets: number; register: number; ledger: number; difference: number; untraced: number; unlinked: number }
  interface Reconciliation {
    accounts: ReconciliationRow[];
    totals: { register: number; ledger: number; difference: number; untraced: number; unlinked: number };
    counts: { unlinkedAssets: number; untracedPostings: number };
  }
  interface Listed<T> { rows: T[]; total: number }
  interface UnlinkedRow { id: string; reason: string; cost: number; entryId: string | null }
  interface UntracedRow { entryId: string; accountId: string; amount: number }
  interface ChecklistItem { id: string; descriptionKey: string; params?: Record<string, unknown>; isCompleted: boolean }
  const refusal = (response: { json<T>(): T }) => response.json<Refusal>();
  const netOn = (entry: Entry, accountId: string) =>
    cents((entry.lines ?? []).filter((line) => line.accountId === accountId).map((line) => Number(line.debit) - Number(line.credit))) / 100;
  const acquisitions = async () =>
    (
      await company.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM journal_entries WHERE organization_id = $1 AND system_reason = 'fixed-asset-acquisition'`, [
        company.organizationId,
      ])
    )[0].n;
  const reconcile = async (asOf: string) => ({
    report: (await company.call('GET', `/api/v1/fixed-assets/reconciliation?asOf=${asOf}`)).json<Reconciliation>(),
    unlinked: (await company.call('GET', `/api/v1/fixed-assets/reconciliation/unlinked-assets?asOf=${asOf}&pageSize=200`)).json<Listed<UnlinkedRow>>(),
    untraced: (await company.call('GET', `/api/v1/fixed-assets/reconciliation/untraced-postings?asOf=${asOf}&pageSize=200`)).json<Listed<UntracedRow>>(),
  });
  const rowOf = (report: Reconciliation, code: string) => report.accounts.find((row) => row.accountId === accounts[code]);
  const explained = (report: Reconciliation) =>
    report.accounts.every((row) => Math.round(row.difference * 100) === Math.round((row.untraced - row.unlinked) * 100)) &&
    Math.round(report.totals.difference * 100) === Math.round((report.totals.untraced - report.totals.unlinked) * 100);
  /** What the books say, read apart from the report: the default ledger's balance of an account, and the register's cost on it. */
  const booksOn = async (code: string, asOf: string) => {
    const [ledger] = await company.query<{ balance: string }>(
      `SELECT COALESCE(SUM(v.debit - v.credit), 0)::text AS balance
         FROM journal_entry_lines l
         JOIN journal_entries e ON e.id = l.journal_entry_id
         JOIN journal_entry_line_valuations v ON v.journal_entry_line_id = l.id
         JOIN ledgers g ON g.id = v.ledger_id AND g.is_default
        WHERE e.organization_id = $1 AND l.account_id = $2 AND e.status IN ${LEDGER_STATUSES_SQL} AND e.date <= $3::date`,
      [company.organizationId, accounts[code], asOf],
    );
    const [register] = await company.query<{ cost: string }>(
      `SELECT COALESCE(SUM(cost), 0)::text AS cost FROM fixed_asset
        WHERE organization_id = $1 AND asset_account_id = $2 AND acquisition_date <= $3::date AND (disposal_date IS NULL OR disposal_date > $3::date)`,
      [company.organizationId, accounts[code], asOf],
    );
    return { ledger: Number(ledger.balance), register: Number(register.cost) };
  };
  const checklistOf = async () => {
    const [period] = await company.query<{ id: string }>(
      `SELECT id FROM accounting_periods WHERE organization_id = $1 AND start_date <= $2::date AND end_date >= $2::date ORDER BY start_date DESC LIMIT 1`,
      [company.organizationId, today],
    );
    return (await company.call('GET', `/api/v1/accounting/periods/${period.id}/closing-checklist`)).json<ChecklistItem[]>();
  };

  const unsaid = await register({ name: 'QA-Sin origen', acquisitionDate: today, cost: 5_000, usefulLifeMonths: 36, capitalization: undefined });
  check(
    'an asset that does not say how its cost entered the ledger is refused, saying what it needs (FINB-15)',
    unsaid.statusCode === 400 && refusal(unsaid).messageKey === 'fixed_assets.capitalization_required',
    `HTTP ${unsaid.statusCode} ${refusal(unsaid).messageKey}`,
  );

  const truckNow = (await company.call('GET', `/api/v1/fixed-assets/${truckAsset.id}`)).json<Capitalized>();
  const acquisition = (await company.call('GET', `/api/v1/journal-entries/${truckNow.capitalizationEntryId}`)).json<Entry & { date: string }>();
  check(
    'registering posts its acquisition — the cost into the asset account, against the account named —, locked and leading to the asset: the register used to carry costs the ledger never had',
    truckNow.capitalizationMethod === 'POSTED' &&
      truckNow.capitalizationOffsetAccountId === accounts['1120'] &&
      acquisition.systemReason === 'fixed-asset-acquisition' &&
      acquisition.origin.locked === true &&
      acquisition.origin.document?.route === `/accounting/fixed-assets/${truckAsset.id}` &&
      acquisition.date === `${month(-2)}-10` &&
      netOn(acquisition, accounts['1210']) === 120_000 &&
      netOn(acquisition, accounts['1120']) === -120_000,
    `${acquisition.systemReason} ${acquisition.date} ${netOn(acquisition, accounts['1210'])} / ${netOn(acquisition, accounts['1120'])}`,
  );

  // A purchase entered by hand: 50 000 of machinery, on the asset account.
  const [general] = await company.query<{ id: string }>(`SELECT id FROM journals WHERE organization_id = $1 AND code = 'GENERAL'`, [company.organizationId]);
  const manual = await company.call(
    'POST',
    '/api/v1/journal-entries',
    {
      date: today,
      description: 'QA-Compra de maquinaria registrada a mano',
      journalId: general.id,
      lines: [
        { accountId: accounts['1210'], debit: 50_000, credit: 0 },
        { accountId: accounts['1120'], debit: 0, credit: 50_000 },
      ],
    },
    freshKey(),
  );
  const manualEntry = manual.json<{ id: string; entryNumber: string; status: string }>();
  const waitingEntry = (await company.call('GET', `/api/v1/fixed-assets/capitalization-sources?journalEntryId=${manualEntry.id}`)).json<Listed<Source>>();
  check(
    'a purchase entered by hand is waiting to be registered: 50 000 debited to the asset account, none of it registered',
    manual.statusCode === 201 &&
      waitingEntry.rows.length === 1 &&
      waitingEntry.rows[0].kind === 'JOURNAL_ENTRY' &&
      waitingEntry.rows[0].debited === 50_000 &&
      waitingEntry.rows[0].available === 50_000,
    `HTTP ${manual.statusCode} ${JSON.stringify(waitingEntry.rows)}`,
  );
  const fromManual = { method: 'JOURNAL_ENTRY', journalEntryId: manualEntry.id };
  const postedBefore = await acquisitions();
  const lathe = await register({ name: 'QA-Torno', acquisitionDate: today, cost: 30_000, usefulLifeMonths: 120, capitalization: fromManual });
  const latheAsset = lathe.json<Capitalized>();
  check(
    'an asset registered from it is linked to it, and posts nothing more',
    lathe.statusCode === 201 && latheAsset.capitalizationMethod === 'JOURNAL_ENTRY' && latheAsset.capitalizationEntryId === manualEntry.id && (await acquisitions()) === postedBefore,
    `HTTP ${lathe.statusCode} ${latheAsset.capitalizationMethod}`,
  );
  const beyond = await register({ name: 'QA-Fresadora', acquisitionDate: today, cost: 30_000, usefulLifeMonths: 120, capitalization: fromManual });
  check(
    'a second asset of 30 000 from the same 50 000 is refused, naming what is left: 20 000',
    beyond.statusCode === 409 && refusal(beyond).messageKey === 'fixed_assets.capitalization_exceeds_source' && refusal(beyond).params?.['available'] === 20_000,
    `HTTP ${beyond.statusCode} ${JSON.stringify(refusal(beyond).params)}`,
  );
  const reversal = await company.call('POST', `/api/v1/journal-entries/${manualEntry.id}/reverse`, { reversalDate: today, reason: 'QA-Prueba de reversión' }, freshKey());
  check(
    'that entry cannot be reversed from under the asset it bought: the refusal names the asset',
    reversal.statusCode === 409 &&
      refusal(reversal).messageKey === 'journal_entries.entry_capitalized_fixed_assets' &&
      String(refusal(reversal).params?.['assets'] ?? '').includes(latheAsset.number),
    `HTTP ${reversal.statusCode} ${JSON.stringify(refusal(reversal).params)}`,
  );

  // A supplier bill for a press, booked to the asset account.
  const supplier = (await company.call('POST', '/api/v1/suppliers', { name: 'QA-Proveedor de equipos' }, freshKey())).json<{ id: string }>();
  const draft = await company.call(
    'POST',
    '/api/v1/accounts-payable',
    {
      vendorId: supplier.id,
      date: today,
      supplierInvoiceNumber: `QA-EQ-${Date.now()}`,
      lines: [{ product: 'QA-Prensa hidráulica', quantity: 1, unitPrice: 80_000, total: 80_000, expenseAccountId: accounts['1210'], nature: 'GOODS' }],
    },
    freshKey(),
  );
  const billId = draft.json<{ id: string }>().id;
  const submitted = await company.call('POST', `/api/v1/accounts-payable/${billId}/submit-for-approval`, undefined, freshKey());
  const bill = (await company.call('GET', `/api/v1/accounts-payable/${billId}`)).json<{ status: string; journalEntryId: string | null }>();
  const waitingBill = (await company.call('GET', `/api/v1/fixed-assets/capitalization-sources?vendorBillId=${billId}`)).json<Listed<Source>>();
  check(
    'a supplier bill booked to the asset account posts, and is waiting to be registered',
    draft.statusCode === 201 && submitted.statusCode === 200 && Boolean(bill.journalEntryId) && waitingBill.rows[0]?.kind === 'VENDOR_BILL' && waitingBill.rows[0]?.available === 80_000,
    `HTTP ${draft.statusCode}/${submitted.statusCode} ${bill.status} ${JSON.stringify(waitingBill.rows)} ${draft.statusCode !== 201 ? draft.body.slice(0, 300) : submitted.statusCode !== 200 ? submitted.body.slice(0, 300) : ''}`,
  );
  const press = await register({ name: 'QA-Prensa', acquisitionDate: today, cost: 80_000, usefulLifeMonths: 120, capitalization: { method: 'VENDOR_BILL', vendorBillId: billId } });
  const pressAsset = press.json<Capitalized>();
  const afterPress = (await company.call('GET', `/api/v1/fixed-assets/capitalization-sources?vendorBillId=${billId}`)).json<Listed<Source>>();
  check(
    'an asset registered from the bill names it, and the bill is no longer waiting',
    press.statusCode === 201 && pressAsset.capitalizationMethod === 'VENDOR_BILL' && pressAsset.vendorBillId === billId && afterPress.total === 0,
    `HTTP ${press.statusCode} ${pressAsset.capitalizationMethod} ${afterPress.total}`,
  );
  const voided = await company.call('POST', `/api/v1/accounts-payable/${billId}/void`, { reason: 'QA-Prueba de anulación' }, freshKey());
  check(
    'and the bill cannot be voided from under the asset it bought: the refusal names it',
    voided.statusCode === 409 &&
      refusal(voided).messageKey === 'accounts_payable.bill_capitalized_as_fixed_assets' &&
      String(refusal(voided).params?.['assets'] ?? '').includes(pressAsset.number),
    `HTTP ${voided.statusCode} ${JSON.stringify(refusal(voided).params)}`,
  );

  // An asset registered before the rule, as the migration left it: no source at all.
  const [legacy] = await company.query<{ id: string; number: string }>(
    `INSERT INTO fixed_asset (organization_id, name, number, cost, acquisition_date, in_service_date, useful_life_months,
                              asset_account_id, accumulated_depreciation_account_id, depreciation_expense_account_id, book_value, capitalization_method)
     VALUES ($1, 'QA-Antiguo', $2, 12000, $3, $3, 60, $4, $5, $6, 12000, 'UNLINKED') RETURNING id, number`,
    [company.organizationId, `AF-QA-${Date.now()}`, `${month(-1)}-15`, accounts['1210'], accounts['1220'], accounts['5500']],
  );
  const before = await reconcile(today);
  const beforeBooks = await booksOn('1210', today);
  const beforeCost = rowOf(before.report, '1210');
  check(
    'the reconciliation sets the asset account against the ledger, to the cent: what the register holds and what the ledger holds, read apart from the report',
    beforeCost?.role === 'COST' && beforeCost.register === beforeBooks.register && beforeCost.ledger === beforeBooks.ledger,
    `${JSON.stringify(beforeCost)} / libros ${JSON.stringify(beforeBooks)}`,
  );
  check(
    'and explains the difference: 20 000 of the entry no asset is behind, less the 12 000 of the asset with no source',
    beforeCost?.untraced === 20_000 &&
      beforeCost.unlinked === 12_000 &&
      beforeCost.difference === 8_000 &&
      explained(before.report) &&
      before.unlinked.rows.some((row) => row.id === legacy.id && row.reason === 'NEVER_LINKED') &&
      before.untraced.rows.some((row) => row.entryId === manualEntry.id && row.amount === 20_000) &&
      before.report.counts.unlinkedAssets === 1 &&
      before.report.counts.untracedPostings === 1,
    `${JSON.stringify(beforeCost)} ${JSON.stringify(before.report.counts)}`,
  );
  check(
    'the accumulated depreciation account agrees: every charge is in both, from its own entry',
    rowOf(before.report, '1220')?.role === 'ACCUMULATED' && rowOf(before.report, '1220')?.difference === 0,
    JSON.stringify(rowOf(before.report, '1220')),
  );
  const pendingClose = (await checklistOf()).find((item) => item.id === 'fixed-assets-reconciliation');
  check(
    'the close\'s checklist says the register does not agree with the ledger, by how much and why',
    pendingClose?.isCompleted === false &&
      pendingClose.descriptionKey === 'fixed_assets.closing.register_not_reconciled' &&
      pendingClose.params?.['unlinked'] === 1 &&
      pendingClose.params?.['untraced'] === 1,
    JSON.stringify(pendingClose),
  );

  const linked = await company.call('POST', `/api/v1/fixed-assets/${legacy.id}/capitalization`, fromManual, freshKey());
  check(
    'the asset registered before the rule is linked afterwards to the entry its cost came in by',
    [200, 201].includes(linked.statusCode) && linked.json<Capitalized>().capitalizationMethod === 'JOURNAL_ENTRY',
    `HTTP ${linked.statusCode} ${linked.body.slice(0, 200)}`,
  );
  const ddbBefore = (await company.call('GET', `/api/v1/fixed-assets/${ddb.json<Asset>().id}`)).json<Capitalized>();
  const moved = await company.call('POST', `/api/v1/fixed-assets/${ddbBefore.id}/capitalization`, fromManual, freshKey());
  const [replaced] = await company.query<{ is_reversed: boolean }>(`SELECT is_reversed FROM journal_entries WHERE id = $1`, [ddbBefore.capitalizationEntryId]);
  const [undone] = await company.query<{ date: string; system_reason: string }>(
    `SELECT date::text AS date, system_reason FROM journal_entries WHERE reverses_entry_id = $1`,
    [ddbBefore.capitalizationEntryId],
  );
  check(
    'relinking an asset whose acquisition was posted here reverses that acquisition first — on its own date, its month being open',
    [200, 201].includes(moved.statusCode) &&
      moved.json<Capitalized>().capitalizationEntryId === manualEntry.id &&
      replaced?.is_reversed === true &&
      undone?.system_reason === 'fixed-asset-acquisition' &&
      undone.date === `${month(-2)}-01`,
    `HTTP ${moved.statusCode} ${JSON.stringify(undone)}`,
  );
  const tooling = await register({ name: 'QA-Herramental', acquisitionDate: today, cost: 7_000, usefulLifeMonths: 60, capitalization: fromManual });
  const doneEntry = (await company.call('GET', `/api/v1/fixed-assets/capitalization-sources?journalEntryId=${manualEntry.id}`)).json<Listed<Source>>();
  check(
    'the 7 000 left of the entry make one more asset, and the entry is registered in full',
    tooling.statusCode === 201 && doneEntry.total === 0,
    `HTTP ${tooling.statusCode} ${doneEntry.total}`,
  );

  const after = await reconcile(today);
  const afterBooks = await booksOn('1210', today);
  check(
    'with every asset traced to the ledger and every movement to an asset, the register and the ledger agree on every account',
    after.report.accounts.every((row) => row.difference === 0 && row.untraced === 0 && row.unlinked === 0) &&
      rowOf(after.report, '1210')?.register === afterBooks.register &&
      rowOf(after.report, '1210')?.ledger === afterBooks.ledger &&
      after.unlinked.total === 0 &&
      after.untraced.total === 0,
    `${JSON.stringify(after.report.accounts)} / libros ${JSON.stringify(afterBooks)}`,
  );
  const closeAgrees = (await checklistOf()).find((item) => item.id === 'fixed-assets-reconciliation');
  const closeCharges = (await checklistOf()).find((item) => item.id === 'fixed-assets-depreciation');
  check(
    'and the close\'s checklist says so — and, computed, what the close will depreciate: it was a manual step that could never be ticked',
    closeAgrees?.isCompleted === true &&
      closeAgrees.descriptionKey === 'fixed_assets.closing.register_reconciled' &&
      closeCharges?.isCompleted === true &&
      ['fixed_assets.closing.depreciation_ready', 'fixed_assets.closing.depreciation_nothing'].includes(closeCharges.descriptionKey),
    `${JSON.stringify(closeAgrees)} ${JSON.stringify(closeCharges)}`,
  );

  // The day before: the lathe, the press and the tooling were not acquired yet, and the entry and
  // the bill were not in the ledger; the old asset and the declining-balance one were held, their
  // source posted today. The report says so, and still explains every cent.
  const yesterday = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) - 1)).toISOString().slice(0, 10);
  const dayBefore = await reconcile(yesterday);
  const dayBeforeCost = rowOf(dayBefore.report, '1210');
  check(
    'on the day before, the two assets whose source is dated today are the difference — 13 000 — and nothing else is',
    dayBeforeCost?.difference === -13_000 &&
      dayBeforeCost.unlinked === 13_000 &&
      dayBeforeCost.untraced === 0 &&
      explained(dayBefore.report) &&
      dayBefore.unlinked.rows.filter((row) => row.reason === 'SOURCE_LATER').map((row) => row.cost).sort((a, b) => a - b).join() === '1000,12000',
    `${JSON.stringify(dayBeforeCost)} ${JSON.stringify(dayBefore.unlinked.rows)}`,
  );

  await app.close();
  if (failures.length) {
    console.error(`\n${failures.length} comprobación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nActivos fijos: todas las comprobaciones pasaron.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
