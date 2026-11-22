/**
 * Executable proof of the exchange-rate fixes of audit 2026-11-07 (FINB-03..06), over the real HTTP
 * API of a freshly provisioned QA company. Run it as `virtex_app` too.
 *
 *  - FINB-04: the import answers «Se importaron 2 tasas.», not «{{imported}}».
 *  - FINB-05: entering, importing, correcting and deleting a rate each leave a row in the audit
 *    trail, with the figure before and after and who did it.
 *  - FINB-06: a document converted at the MARKET rate because there was no OFFICIAL one says so to
 *    the person who posted it — in the `Virtex-Notices` header, in their language — and an official
 *    rate on file says nothing.
 */
import { DataSource } from 'typeorm';
import { NOTICES_HEADER, parseRequestNotices } from '@virtex/shared/types';
import { bootApplication, qaCompanySession } from './support/qa-company-session';

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

type TrailRow = { action: string; user_id: string | null; new_value: Record<string, unknown>; previous_value: Record<string, unknown> | null };

async function main() {
  const app = await bootApplication();
  const company = await qaCompanySession(app, 'Tasas', 'pro', 'DO');
  check('a Dominican company is provisioned and its owner signs in', company.signedIn, company.organizationId);
  const ds = app.get(DataSource);

  const trail = () =>
    company.query<TrailRow>(
      `SELECT "actionType" AS action, user_id, new_value, previous_value FROM audit_logs
        WHERE organization_id = $1 AND entity = 'tenant_exchange_rates' ORDER BY created_at, id`,
      [company.organizationId],
    );

  // ── FINB-04 and FINB-05: the import, with its count, and its trail ─────────────────────────
  const imported = await company.call('POST', '/api/v1/exchange-rates/import', {
    rates: [
      { fromCurrency: 'USD', toCurrency: 'DOP', rate: 60.1, date: '2026-01-05' },
      { fromCurrency: 'USD', toCurrency: 'DOP', rate: 60.2, date: '2026-01-06' },
    ],
  });
  const importMessage = imported.json<{ message?: string }>().message ?? '';
  check(
    'the import answers with the number it imported, not a raw placeholder (FINB-04)',
    imported.statusCode === 201 && /\b2\b/.test(importMessage) && !importMessage.includes('{{'),
    `${imported.statusCode} «${importMessage}»`,
  );
  let rows = await trail();
  check(
    'each imported rate leaves a CREATE row with its figure and its author (FINB-05)',
    rows.length === 2 && rows.every((row) => row.action === 'CREATE' && Boolean(row.user_id)) &&
      rows.map((row) => Number(row.new_value['rate'])).sort().join(',') === '60.1,60.2',
    JSON.stringify(rows.map((row) => [row.action, row.new_value['date'], row.new_value['rate']])),
  );

  const corrected = await company.call('POST', '/api/v1/exchange-rates', { fromCurrency: 'USD', toCurrency: 'DOP', rate: 60.15, date: '2026-01-05' });
  rows = await trail();
  const update = rows[rows.length - 1];
  check(
    'a correction leaves an UPDATE row with the figure it replaced',
    corrected.statusCode === 201 && update?.action === 'UPDATE' && Number(update.new_value['rate']) === 60.15 && Number(update.previous_value?.['rate']) === 60.1,
    `${corrected.statusCode} ${JSON.stringify(update)}`,
  );
  const repeated = await company.call('POST', '/api/v1/exchange-rates', { fromCurrency: 'USD', toCurrency: 'DOP', rate: 60.15, date: '2026-01-05' });
  check('the same figure entered again changes nothing and records nothing', repeated.statusCode === 201 && (await trail()).length === rows.length);

  const rateId = corrected.json<{ rate: { id: string } }>().rate.id;
  const removed = await company.call('DELETE', `/api/v1/exchange-rates/${rateId}`);
  rows = await trail();
  const deletion = rows[rows.length - 1];
  check(
    'a deletion leaves a DELETE row keeping the rate as it was',
    removed.statusCode >= 200 && removed.statusCode < 300 && deletion?.action === 'DELETE' && Number(deletion.new_value['rate']) === 60.15 && Boolean(deletion.user_id),
    `${removed.statusCode} ${JSON.stringify(deletion)}`,
  );

  // ── FINB-06: the market rate used for want of an official one is said, not only logged ────────
  // A currency with no official quote anywhere — shared, the company's own, or through the dollar —
  // so the fallback is what answers.
  const [{ officialYen }] = await ds.query(
    `SELECT COUNT(*)::int AS "officialYen" FROM exchange_rate
      WHERE rate_type = 'OFFICIAL' AND ('JPY' IN ("fromCurrency", "toCurrency"))`,
  );
  check('precondition: no official yen quote is on file', officialYen === 0, `${officialYen}`);
  const market = await company.call('POST', '/api/v1/exchange-rates', {
    fromCurrency: 'JPY',
    toCurrency: 'DOP',
    rate: 0.39,
    date: '2026-01-06',
    rateType: 'MARKET',
    source: 'QA',
  });
  check('a market quote for the yen is recorded', market.statusCode === 201, `${market.statusCode} ${market.body.slice(0, 160)}`);

  const fallback = await company.call('GET', '/api/v1/exchange-rates?from=JPY&to=DOP&date=2026-01-08');
  const resolved = fallback.json<{ rate: number; rateType: string; substitutedFor?: string }>();
  const notices = parseRequestNotices(fallback.headers[NOTICES_HEADER.toLowerCase()] as string | undefined);
  check(
    'asked for the official rate, it answers with the market one and says which it stood in for',
    fallback.statusCode === 200 && resolved.rateType === 'MARKET' && resolved.substitutedFor === 'OFFICIAL' && Number(resolved.rate) === 0.39,
    `${fallback.statusCode} ${fallback.body.slice(0, 200)}`,
  );
  const notice = notices.find((entry) => entry.code === 'EXCHANGE_RATE_MARKET_FALLBACK');
  check(
    'and the reader is told, in the response header, with the pair, the day, the source and the quote date (FINB-06)',
    Boolean(notice) &&
      notice?.messageKey === 'currencies.market_rate_used_without_official' &&
      notice.messageParams['from'] === 'JPY' &&
      notice.messageParams['source'] === 'QA' &&
      notice.messageParams['quotedOn'] === '2026-01-06' &&
      !notice.message.includes('{{') &&
      notice.message.includes('JPY'),
    JSON.stringify(notice),
  );

  const official = await company.call('GET', '/api/v1/exchange-rates?from=USD&to=DOP&date=2026-01-06');
  check(
    'an official rate on file answers for itself, and no notice comes with it',
    official.statusCode === 200 && official.json<{ rateType: string }>().rateType === 'OFFICIAL' && !official.headers[NOTICES_HEADER.toLowerCase()],
    `${official.statusCode} ${official.body.slice(0, 160)}`,
  );

  await app.close();
  if (failures.length) {
    console.error(`\n✗ ${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log('\n✓ Exchange rates: the import says what it did, every change is in the trail, and a fallback is said.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
