/**
 * Executable proof of the journal-entry API contract (FIN-JE-02, FIN-JE-03, FIN-JE-04, FIN-JE-05).
 *
 * ## What this exists to stop from happening again
 *
 *  - An entry dated a year ahead was posted, and opened that whole fiscal year and its twelve
 *    periods to receive it: a mistyped year changed the calendar.
 *  - `POST /journal-entries` answered with the entity built before posting — its lines carrying the
 *    entry in its intermediate state (`Draft`, no number) beside an entry already `Posted` — and a
 *    replayed request with another shape.
 *  - A closed period, or an account not yet valid, answered 403, which the client reads as «you lack
 *    a permission».
 *  - `"debit": "100"` passed `@IsNumber`: the implicit conversion had made it a number first.
 *
 * Over the real HTTP API of a freshly provisioned QA company; run it as `virtex_app` too.
 */
import { DataSource } from 'typeorm';
import { bootApplication, qaCompanySession } from './support/qa-company-session';

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

/** `YYYY-MM-DD` plus `days`. */
const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

async function main() {
  const app = await bootApplication();
  const company = await qaCompanySession(app, 'Asientos');
  check('a company is provisioned and its owner signs in', company.signedIn, company.organizationId);

  const [cash] = await company.query<{ id: string }>(`SELECT id FROM accounts WHERE organization_id = $1 AND system_role = 'CASH'`, [company.organizationId]);
  const [revenue] = await company.query<{ id: string }>(
    `SELECT id FROM accounts WHERE organization_id = $1 AND type = 'REVENUE' AND "isPostable" ORDER BY code LIMIT 1`,
    [company.organizationId],
  );
  const [general] = await company.query<{ id: string }>(`SELECT id FROM journals WHERE organization_id = $1 AND code = 'GENERAL'`, [company.organizationId]);
  const [{ today }] = await company.query<{ today: string }>(
    `SELECT to_char((now() AT TIME ZONE 'America/Santo_Domingo')::date, 'YYYY-MM-DD') AS today`,
  );
  const entry = (date: string, amount: unknown = 100) => ({
    date,
    description: 'QA asiento del contrato',
    journalId: general.id,
    lines: [
      { accountId: cash.id, debit: amount, credit: 0 },
      { accountId: revenue.id, debit: 0, credit: amount },
    ],
  });

  // Every create carries its own idempotency key, as the client sends one: the route requires it.
  let sequence = 0;
  const post = (payload: unknown, key = `qa-asiento-${Date.now()}-${sequence++}`) =>
    company.call('POST', '/api/v1/journal-entries', payload, { 'idempotency-key': key });

  // ── FIN-JE-05: amounts are numbers, not text that looks like one ─────────────────────────
  const textual = await post(entry(today, '100'));
  const textualErrors = JSON.stringify(textual.json());
  check(
    'an amount sent as text is refused, as an amount that is not a number',
    textual.statusCode === 400 && textualErrors.includes('validation.create_journal_entry.debit_transaction_currency_must_number'),
    `${textual.statusCode} ${textual.body.slice(0, 200)}`,
  );

  // ── FIN-JE-03: one representation, the same as a read, the same on a replay ──────────────
  const key = `qa-asiento-${Date.now()}`;
  const created = await post(entry(today), key);
  const body = created.json<{ id: string; status: string; entryNumber: string | null; lines: Array<Record<string, unknown>> }>();
  check(
    'the entry comes back posted, numbered, and its lines without the entry nested inside',
    created.statusCode === 201 && body.status === 'Posted' && Boolean(body.entryNumber) && body.lines.every((line) => !('journalEntry' in line)),
    `${created.statusCode} ${body.status} ${body.entryNumber}`,
  );
  const read = await company.call('GET', `/api/v1/journal-entries/${body.id}`);
  /**
   * A document as data, with its keys in one order: a replay is stored as `jsonb`, which keeps the
   * content and not the order of the keys — not significant in JSON.
   */
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value as Record<string, unknown>)
              .filter((k) => k !== 'updatedAt')
              .sort()
              .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
          )
        : value;
  const shape = (value: unknown) => JSON.stringify(canonical(value));
  /** The first path where two documents differ, to say what a replay changed. */
  const firstDifference = (a: unknown, b: unknown, path = '$'): string | null => {
    if (JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))) return null;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      for (const key of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) {
        const found = firstDifference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
        if (found) return found;
      }
    }
    return `${path}: ${JSON.stringify(a)?.slice(0, 80)} ≠ ${JSON.stringify(b)?.slice(0, 80)}`;
  };
  check('what the create answers is what a read answers', shape(read.json()) === shape(body));
  const replay = await post(entry(today), key);
  check(
    'and a replayed request answers the same, once',
    replay.statusCode === 201 && shape(replay.json()) === shape(body),
    `${replay.statusCode} ${firstDifference(replay.json(), body) ?? 'mismo documento'}`,
  );

  // ── FIN-JE-02: a date past the horizon is refused, and opens no year ─────────────────────
  const nextYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  const yearsBefore = await company.query<{ n: number }>(`SELECT count(*)::int AS n FROM fiscal_years WHERE organization_id = $1`, [company.organizationId]);
  const ahead = await post(entry(nextYear));
  const aheadBody = ahead.json<{ messageKey?: string; params?: { limit?: string; days?: number } }>();
  const yearsAfter = await company.query<{ n: number }>(`SELECT count(*)::int AS n FROM fiscal_years WHERE organization_id = $1`, [company.organizationId]);
  check(
    'an entry dated a year ahead is refused as unprocessable, saying how far ahead the company allows',
    ahead.statusCode === 422 && aheadBody.messageKey === 'accounting.posting_date_beyond_horizon' && aheadBody.params?.days === 31,
    `${ahead.statusCode} ${ahead.body.slice(0, 160)}`,
  );
  check('and no fiscal year was opened for it', yearsAfter[0].n === yearsBefore[0].n, `${yearsBefore[0].n} → ${yearsAfter[0].n}`);
  const withinHorizon = await post(entry(addDays(today, 3)));
  check('a date a few days ahead posts', withinHorizon.statusCode === 201, String(withinHorizon.statusCode));

  // ── FIN-JE-04: a closed period is a conflict, not a missing permission ───────────────────
  const [first] = await company.query<{ id: string; start: string }>(
    `SELECT id, to_char(start_date, 'YYYY-MM-DD') AS start FROM accounting_periods
      WHERE organization_id = $1 AND end_date < $2 ORDER BY start_date LIMIT 1`,
    [company.organizationId, today],
  );
  if (first) {
    const closed = await company.call('POST', '/api/v1/accounting/close-period', { periodId: first.id });
    const intoClosed = await post(entry(first.start));
    check(
      'posting into a closed period answers 409 with the period named',
      closed.statusCode === 200 && intoClosed.statusCode === 409 && intoClosed.json<{ messageKey?: string }>().messageKey === 'accounting.transaction_date_falls_accounting_period_name',
      `${closed.statusCode} · ${intoClosed.statusCode} ${intoClosed.body.slice(0, 140)}`,
    );
  } else {
    console.log('· ningún período del ejercicio ha terminado todavía; el 409 lo cubre period-status.spec.ts');
  }

  await app.get(DataSource).destroy().catch(() => undefined);
  await app.close().catch(() => undefined);
  if (failures.length > 0) {
    console.error(`\n${failures.length} comprobación(es) fallaron:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('\nEL CONTRATO DE ASIENTOS SE CUMPLE: FECHAS, RESPUESTA, CÓDIGOS E IMPORTES');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
