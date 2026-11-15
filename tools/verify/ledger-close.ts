/**
 * Executable proof that a new company can keep, reorganise and close its books
 * (audit 2026-11-07: FIN-COA-01, FIN-COA-02, FIN-AC-01, FIN-AC-02).
 *
 * ## What this exists to stop from happening again
 *
 *  - Every account of the opening chart was valid only from the day the company signed up, so a
 *    company that signed up in November could not post its opening balances nor anything else
 *    from the year already under way: 403 on the first account an entry touched.
 *  - Merging an account rewrote the account of its posted lines. The immutability triggers refuse
 *    that, so the merge of any account with one posted movement failed — after the API had
 *    answered 200 and said it had started.
 *  - The annual close did not work with analytical accounting on: a mandatory dimension rule
 *    refused the closing entry, and where no rule existed the result by cost centre was left
 *    untouched because one untagged line cannot cancel two centres.
 *  - A period could be closed before it had ended, which refuses every posting in the rest of it,
 *    with no warning.
 *
 * This drives the REAL application — the queue, the worker, the posting path, the triggers —
 * against a real database with a QA tenant, and then asks the ledger what it holds. The unit and
 * integration specs pin each rule; this proves the pieces work together, which is where the merge
 * was found reclassifying balances without their dimension tags while this file was being written.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';

import { AppModule } from '../../apps/backend/api/src/app/app.module';
import { OrganizationsService } from '../../apps/backend/api/src/app/organizations/organizations.service';
import { LocalizationService } from '../../apps/backend/api/src/app/localization/services/localization.service';
import { ChartOfAccountsService } from '../../apps/backend/api/src/app/chart-of-accounts/chart-of-accounts.service';
import { AccountBalancesService } from '../../apps/backend/api/src/app/chart-of-accounts/account-balances.service';
import { AccountCategory, AccountNature, AccountType } from '../../apps/backend/api/src/app/chart-of-accounts/enums/account-enums';
import { JournalEntriesService } from '../../apps/backend/api/src/app/journal-entries/journal-entries.service';
import { CreateJournalEntryDto } from '../../apps/backend/api/src/app/journal-entries/dto/create-journal-entry.dto';
import { PeriodClosingService } from '../../apps/backend/api/src/app/accounting/period-closing.service';
import { YearEndCloseService } from '../../apps/backend/api/src/app/accounting/year-end-close.service';
import { TemporalValidityGuard } from '../../apps/backend/api/src/app/financial-reporting/guards/temporal-validity.guard';
import { Dimension } from '../../apps/backend/api/src/app/dimensions/entities/dimension.entity';
import { DimensionValue } from '../../apps/backend/api/src/app/dimensions/entities/dimension-value.entity';
import { DimensionRule } from '../../apps/backend/api/src/app/dimensions/entities/dimension-rule.entity';

const failures: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
const refusal = async (action: () => Promise<unknown>): Promise<string | null> => {
  try {
    await action();
    return null;
  } catch (error) {
    return (error as { messageKey?: string }).messageKey ?? (error as Error).message;
  }
};

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: ['error'] });
  await app.init();

  const ds = app.get(DataSource);
  const organizations = app.get(OrganizationsService, { strict: false });
  const localization = app.get(LocalizationService, { strict: false });
  const chart = app.get(ChartOfAccountsService, { strict: false });
  const balances = app.get(AccountBalancesService, { strict: false });
  const entries = app.get(JournalEntriesService, { strict: false });
  const closing = app.get(PeriodClosingService, { strict: false });
  const yearEnd = app.get(YearEndCloseService, { strict: false });

  const stamp = Date.now();
  const actor = '00000000-0000-4000-8000-000000000001';
  const ctx = { actorUserId: actor };
  const region = await localization.findRegionByCountryCode('DO');
  const [plan] = await ds.query(`SELECT id FROM "saas_plans" ORDER BY "monthly_price" DESC NULLS LAST LIMIT 1`);
  const org = await organizations.create({
    planId: plan?.id,
    subscriptionStatus: 'active',
    subscriptionPeriodEnd: new Date(Date.now() + 30 * 24 * 3600_000),
    legalName: `QA Sonda Contabilidad ${stamp}`,
    country: 'DO',
    fiscalRegionId: region!.id,
    address: 'Av. 27 de Febrero 100',
    city: 'Santo Domingo',
    state: '01',
    phone: '8095550103',
    email: `qa-contabilidad${stamp}@example.com`,
  });
  await localization.applyFiscalPackage(org, ds.manager);
  const orgId = org.id;

  const [fiscalYear] = await ds.query(
    `SELECT id, to_char(start_date, 'YYYY-MM-DD') AS start, to_char(end_date, 'YYYY-MM-DD') AS "end"
       FROM fiscal_years WHERE organization_id = $1 AND status = 'OPEN' ORDER BY start_date LIMIT 1`,
    [orgId],
  );
  const year = String(fiscalYear.start).slice(0, 4);
  const [ledger] = await ds.query(`SELECT id FROM ledgers WHERE organization_id = $1 AND is_default`, [orgId]);
  const [general] = await ds.query(`SELECT id FROM journals WHERE organization_id = $1 AND code = 'GENERAL'`, [orgId]);
  const one = async (sql: string, params: unknown[]) => (await ds.query(sql, params))[0];
  const cash = await one(
    `SELECT id, code FROM accounts WHERE organization_id = $1 AND type = 'ASSET' AND "isPostable" AND "isActive" ORDER BY code LIMIT 1`,
    [orgId],
  );
  const revenue = await one(
    `SELECT id, code FROM accounts WHERE organization_id = $1 AND type = 'REVENUE' AND "isPostable" AND "isActive" ORDER BY code LIMIT 1`,
    [orgId],
  );
  const [settings] = await ds.query(
    `SELECT default_retained_earnings_account_id AS retained FROM organization_settings WHERE organization_id = $1`,
    [orgId],
  );

  // ── FIN-COA-01: the chart is valid from the start of the open year ──────────────────────────
  const [validity] = await ds.query(
    `SELECT to_char(MIN(effective_from), 'YYYY-MM-DD') AS first, to_char(MAX(effective_from), 'YYYY-MM-DD') AS last, COUNT(*)::int AS n
       FROM accounts WHERE organization_id = $1`,
    [orgId],
  );
  check(
    'el plan aprovisionado vale desde el inicio del ejercicio abierto, no desde hoy',
    validity.first === fiscalYear.start && validity.last === fiscalYear.start,
    `${validity.n} cuentas · ${validity.first} … ${validity.last}`,
  );

  // An account somebody creates today, by hand, without saying when it becomes valid.
  const expenseParent = await one(
    `SELECT id, code FROM accounts WHERE organization_id = $1 AND type = 'EXPENSE' AND NOT "isPostable" ORDER BY code LIMIT 1`,
    [orgId],
  );
  const newAccount = (code: string, name: string) =>
    chart.create(
      {
        segments: [code],
        name,
        type: AccountType.EXPENSE,
        category: AccountCategory.OPERATING_EXPENSE,
        nature: AccountNature.DEBIT,
        parentId: expenseParent?.id ?? null,
        isPostable: true,
      } as never,
      orgId,
    );
  const source = await newAccount('6890', 'QA Gastos varios');
  const destination = await newAccount('6891', 'QA Gastos generales');
  const [created] = await ds.query(`SELECT to_char(effective_from, 'YYYY-MM-DD') AS d FROM accounts WHERE id = $1`, [source.id]);
  check('una cuenta creada hoy también vale desde el inicio del ejercicio', created.d === fiscalYear.start, created.d);

  const guard = new TemporalValidityGuard(ds);
  const asRequest = (body: unknown) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ body, user: { organizationId: orgId } }) }) }) as never;
  const early = `${year}-01-02`;
  check(
    'la guarda admite un asiento del 2 de enero',
    (await refusal(() => guard.canActivate(asRequest({ date: early, lines: [{ accountId: cash.id }, { accountId: revenue.id }] })))) === null,
  );

  const post = (date: string, description: string, lines: Array<Record<string, unknown>>) =>
    entries.create({ date, description, journalId: general.id, lines } as unknown as CreateJournalEntryDto, orgId, ctx);
  const sale = await post(early, 'QA venta de apertura', [
    { accountId: cash.id, debit: 20_000, credit: 0 },
    { accountId: revenue.id, debit: 0, credit: 20_000 },
  ]);
  check('y el asiento del 2 de enero se contabiliza', sale.status === 'Posted', sale.entryNumber ?? '');

  // ── Analytical accounting, with a rule that is really enforced ──────────────────────────────
  const dimension = await ds.getRepository(Dimension).save(
    ds.getRepository(Dimension).create({ organizationId: orgId, name: 'Centro de costo', isActive: true }),
  );
  for (const value of ['A', 'B']) {
    await ds.getRepository(DimensionValue).save(
      ds.getRepository(DimensionValue).create({ dimensionId: dimension.id, value, isActive: true }),
    );
  }
  for (const accountId of [source.id, destination.id]) {
    await ds.getRepository(DimensionRule).save(
      ds.getRepository(DimensionRule).create({ accountId, dimensionId: dimension.id, isRequired: true }),
    );
  }
  const tagged = (value: string) => ({ 'Centro de costo': value });

  const untagged = await refusal(() =>
    post(`${year}-01-15`, 'QA gasto sin centro', [
      { accountId: source.id, debit: 100, credit: 0 },
      { accountId: cash.id, debit: 0, credit: 100 },
    ]),
  );
  check('la regla obligatoria rige de verdad: un gasto sin centro se rechaza', untagged !== null, String(untagged));

  const expense = await post(`${year}-01-15`, 'QA gasto por centro', [
    { accountId: source.id, debit: 6_000, credit: 0, dimensions: tagged('A') },
    { accountId: source.id, debit: 4_000, credit: 0, dimensions: tagged('B') },
    { accountId: cash.id, debit: 0, credit: 10_000 },
  ]);
  const yearEndDate = fiscalYear.end as string;
  const balanceOf = (accountId: string, dimensions?: Record<string, string>) =>
    balances.balanceOf(accountId, { organizationId: orgId, ledgerId: ledger.id, asOf: yearEndDate, dimensions });

  // ── FIN-COA-02: the merge, through the real queue and the real worker ───────────────────────
  const preview = await chart.previewMerge(source.id, destination.id, orgId);
  check(
    'la vista previa dice lo que hará: líneas contabilizadas que se quedan y saldo que se reclasifica',
    preview.blockers.length === 0 && preview.postedLinesKept === 2 && near(preview.reclassifiedAmount, 10_000),
    `${preview.postedLinesKept} líneas se quedan · reclasifica ${preview.reclassifiedAmount}`,
  );

  const started = await chart.merge({ sourceAccountId: source.id, destinationAccountId: destination.id, reason: 'QA cuenta duplicada' }, orgId, actor);
  let merged = false;
  for (let attempt = 0; attempt < 120 && !merged; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const [row] = await ds.query(`SELECT "isActive" AS active FROM accounts WHERE id = $1`, [source.id]);
    merged = row.active === false;
  }
  check('el trabajo de fusión termina (cola real, worker real)', merged, `job ${started.jobId}`);

  const [history] = await ds.query(
    `SELECT COUNT(*)::int AS n FROM journal_entry_lines WHERE journal_entry_id = $1 AND account_id = $2`,
    [expense.id, source.id],
  );
  check('las líneas contabilizadas siguen en la cuenta de origen: no se reescribe historia', history.n === 2, `${history.n} líneas`);

  const [sourceA, sourceB, destinationA, destinationB] = await Promise.all([
    balanceOf(source.id, tagged('A')),
    balanceOf(source.id, tagged('B')),
    balanceOf(destination.id, tagged('A')),
    balanceOf(destination.id, tagged('B')),
  ]);
  check('la cuenta de origen queda en cero, centro por centro', near(sourceA, 0) && near(sourceB, 0), `A ${sourceA} · B ${sourceB}`);
  check(
    'y la de destino recibe cada centro con su etiqueta, pese a su regla obligatoria',
    near(destinationA, 6_000) && near(destinationB, 4_000),
    `A ${destinationA} · B ${destinationB}`,
  );
  const [reclassification] = await ds.query(
    `SELECT e.status, e.entry_number AS number, COUNT(l.id)::int AS lines
       FROM journal_entries e JOIN journal_entry_lines l ON l.journal_entry_id = e.id
      WHERE e.organization_id = $1 AND e.id <> $2 AND l.account_id = $3
      GROUP BY e.id ORDER BY e.created_at DESC LIMIT 1`,
    [orgId, expense.id, source.id],
  );
  check(
    'el traslado es un asiento de reclasificación contabilizado',
    reclassification?.status === 'Posted' && reclassification.lines === 2,
    `${reclassification?.number} · ${reclassification?.status}`,
  );
  const [retired] = await ds.query(`SELECT "isActive" AS active, is_blocked_for_posting AS blocked FROM accounts WHERE id = $1`, [source.id]);
  check('la cuenta de origen queda inactiva y bloqueada, no borrada', retired.active === false && retired.blocked === true);

  // ── FIN-AC-02: a period that has not ended does not close by accident ───────────────────────
  const periods: Array<{ id: string; name: string; end: string }> = await ds.query(
    `SELECT id, name, to_char(end_date, 'YYYY-MM-DD') AS "end" FROM accounting_periods
      WHERE organization_id = $1 AND start_date BETWEEN $2 AND $3 ORDER BY start_date`,
    [orgId, fiscalYear.start, fiscalYear.end],
  );
  const [{ today }] = await ds.query(`SELECT to_char((now() AT TIME ZONE 'America/Santo_Domingo')::date, 'YYYY-MM-DD') AS today`);
  const unfinished = periods.filter((period) => period.end >= today);
  if (unfinished.length > 0) {
    const refused = await refusal(() => closing.closePeriod(unfinished[0].id, orgId, actor));
    check(
      'un período que no ha terminado no se cierra sin decirlo',
      refused === 'accounting.period_has_not_ended_yet',
      `${unfinished[0].name} → ${refused}`,
    );
  } else {
    console.log('· ningún período del ejercicio sigue en curso hoy; el rechazo lo cubre period-close.spec.ts');
  }
  for (const period of periods) {
    await closing.closePeriod(period.id, orgId, actor, { closeBeforeItEnds: period.end >= today });
  }
  const [{ open }] = await ds.query(
    `SELECT COUNT(*)::int AS open FROM accounting_periods WHERE organization_id = $1 AND status <> 'CLOSED' AND start_date BETWEEN $2 AND $3`,
    [orgId, fiscalYear.start, fiscalYear.end],
  );
  check('los doce períodos cierran, los que no han terminado solo con la confirmación explícita', open === 0, `${periods.length} períodos`);

  // ── FIN-AC-01: the annual close with a mandatory dimension rule ─────────────────────────────
  const closeRefused = await refusal(() => yearEnd.closeFiscalYear({ fiscalYearId: fiscalYear.id }, orgId, actor));
  check('el ejercicio cierra con una regla de dimensión obligatoria vigente', closeRefused === null, String(closeRefused ?? 'cerrado'));

  const [expenseA, expenseB, revenueAfter, retainedA, retainedB, retainedTotal] = await Promise.all([
    balanceOf(destination.id, tagged('A')),
    balanceOf(destination.id, tagged('B')),
    balanceOf(revenue.id),
    balanceOf(settings.retained, tagged('A')),
    balanceOf(settings.retained, tagged('B')),
    balanceOf(settings.retained),
  ]);
  check('el resultado vuelve a cero centro por centro', near(expenseA, 0) && near(expenseB, 0) && near(revenueAfter, 0), `A ${expenseA} · B ${expenseB} · ingresos ${revenueAfter}`);
  check(
    'y queda en ganancias acumuladas, atribuido al centro que lo produjo',
    near(retainedA, 6_000) && near(retainedB, 4_000) && near(retainedTotal, -10_000),
    `A ${retainedA} · B ${retainedB} · total ${retainedTotal}`,
  );

  await app.close();
  if (failures.length > 0) {
    console.error(`\n${failures.length} comprobación(es) fallaron:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('\nUNA EMPRESA NUEVA LLEVA, REORGANIZA Y CIERRA SUS LIBROS');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
