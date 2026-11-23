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
 *  - FINB-03: each market's official rate is read from its publisher. With Colombia's TRM feed and a
 *    recorded publication in place of the network (nothing leaves this process): a tenant
 *    administrator cannot operate it; in shadow it reads and writes nothing; activated by a
 *    platform operator — which the trail records — it writes the TRM, and the official rate a
 *    company resolves is the TRM, named; a publication it does not recognise fails the reading and
 *    writes nothing; and a process whose external effects exclude reference data does not ask.
 */
import { DataSource } from 'typeorm';
import { NOTICES_HEADER, parseRequestNotices } from '@virtex/shared/types';
import { bootApplication, qaCompanySession } from './support/qa-company-session';
import { OfficialRatesTransport } from '../../apps/backend/api/src/app/currencies/official-rates.transport';

/**
 * Colombia's publisher, recorded: the TRM rows the open-data portal answers, in its own shape. A
 * request for a range answers the rows in it; `broken` answers what a portal under maintenance
 * does. Every request is counted, so a reading that must not ask can be seen not asking.
 */
const TRM = [
  { valor: '4050.10', unidad: 'COP', vigenciadesde: '2026-03-13T00:00:00.000', vigenciahasta: '2026-03-13T00:00:00.000' },
  // A Friday's certification covers the weekend and the Monday holiday: dated by its first day.
  { valor: '4061.25', unidad: 'COP', vigenciadesde: '2026-03-14T00:00:00.000', vigenciahasta: '2026-03-16T00:00:00.000' },
  { valor: '4070.00', unidad: 'COP', vigenciadesde: '2026-03-17T00:00:00.000', vigenciahasta: '2026-03-17T00:00:00.000' },
];
const publisher = {
  broken: false,
  requests: [] as string[],
  async get(url: string) {
    this.requests.push(url);
    if (this.broken) return { status: 200, body: '<html><body>Portal en mantenimiento</body></html>' };
    const where = new URL(url).searchParams.get('$where') ?? '';
    const [, from, to] = where.match(/between '(\d{4}-\d{2}-\d{2})T[^']*' and '(\d{4}-\d{2}-\d{2})T/) ?? [];
    const rows = TRM.filter((row) => row.vigenciadesde.slice(0, 10) >= from && row.vigenciadesde.slice(0, 10) <= to);
    return { status: 200, body: JSON.stringify(rows) };
  },
};

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

type TrailRow = { action: string; user_id: string | null; new_value: Record<string, unknown>; previous_value: Record<string, unknown> | null };

async function main() {
  // Reading reference data is an external effect: allowed for this process, with the publisher recorded.
  process.env['EXTERNAL_EFFECTS'] = 'reference_data';
  const app = await bootApplication([{ provide: OfficialRatesTransport, useValue: publisher }]);
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

  // ── FINB-03: the official rate, read from its publisher ───────────────────────────────────────
  const feeds = await company.call('GET', '/api/v1/exchange-rate-feeds');
  check('a tenant administrator cannot operate the feeds: they are a platform right', feeds.statusCode === 403, `${feeds.statusCode}`);

  const operator = await qaCompanySession(app, 'Fuentes', 'pro', 'DO', { platformRoles: ['Platform Operations'] });
  const listed = await operator.call('GET', '/api/v1/exchange-rate-feeds');
  const trm = listed.json<Array<{ code: string; formatEstablishedFrom: string; publisher: string; quoteCurrency: string }>>().find((feed) => feed.code === 'CO-TRM');
  check(
    'a platform operator sees the market feeds, Colombia\'s TRM among them, read from its documentation',
    listed.statusCode === 200 && trm?.publisher === 'Superintendencia Financiera de Colombia' && trm.quoteCurrency === 'COP' && trm.formatEstablishedFrom === 'documentation',
    `${listed.statusCode} ${JSON.stringify(trm)}`,
  );
  await operator.call('PUT', '/api/v1/exchange-rate-feeds/CO-TRM/status', { status: 'SHADOW' });
  const trmOnFile = () =>
    ds.query(
      `SELECT to_char(date, 'YYYY-MM-DD') AS day, rate::float AS rate FROM exchange_rate
        WHERE source = 'CO-TRM' AND "fromCurrency" = 'USD' AND "toCurrency" = 'COP' AND date BETWEEN '2026-03-01' AND '2026-03-20' ORDER BY date`,
    );
  await ds.query(`DELETE FROM exchange_rate WHERE source = 'CO-TRM' AND date BETWEEN '2026-03-01' AND '2026-03-20'`);

  process.env['EXTERNAL_EFFECTS'] = 'none';
  publisher.requests.length = 0;
  const skipped = await operator.call('POST', '/api/v1/exchange-rate-feeds/CO-TRM/runs', { from: '2026-03-01', to: '2026-03-20' });
  check(
    'a process whose external effects exclude reference data does not ask the publisher, and records why',
    skipped.statusCode === 200 && skipped.json<{ status: string; reason: string }>().status === 'SKIPPED' &&
      skipped.json<{ reason: string }>().reason === 'currencies.official_rates.reason.external_effects_disabled' && publisher.requests.length === 0,
    `${skipped.statusCode} ${skipped.body.slice(0, 160)}`,
  );
  process.env['EXTERNAL_EFFECTS'] = 'reference_data';

  const shadow = await operator.call('POST', '/api/v1/exchange-rate-feeds/CO-TRM/runs', { from: '2026-03-01', to: '2026-03-20' });
  const shadowRun = shadow.json<{ status: string; mode: string; written: number; quotes: Array<{ effectiveOn: string; rate: number }> }>();
  check(
    'in shadow it reads the publication and writes nothing',
    shadow.statusCode === 200 && shadowRun.status === 'SUCCEEDED' && shadowRun.mode === 'SHADOW' && shadowRun.written === 0 &&
      shadowRun.quotes.length === 3 && (await trmOnFile()).length === 0,
    `${shadow.statusCode} ${JSON.stringify(shadowRun).slice(0, 200)}`,
  );

  const activated = await operator.call('PUT', '/api/v1/exchange-rate-feeds/CO-TRM/status', { status: 'ACTIVE' });
  const [feedTrail] = await ds.query(
    `SELECT user_id, previous_value, new_value FROM audit_logs WHERE entity = 'exchange_rate_feeds' AND entity_id = 'CO-TRM' ORDER BY created_at DESC LIMIT 1`,
  );
  check(
    'a platform operator activates it, and the trail records who and from what',
    activated.statusCode === 200 && activated.json<{ status: string }>().status === 'ACTIVE' && feedTrail?.new_value?.status === 'ACTIVE' && Boolean(feedTrail?.user_id),
    `${activated.statusCode} ${JSON.stringify(feedTrail)}`,
  );

  const active = await operator.call('POST', '/api/v1/exchange-rate-feeds/CO-TRM/runs', { from: '2026-03-01', to: '2026-03-20' });
  const activeRun = active.json<{ status: string; mode: string; written: number }>();
  const written = await trmOnFile();
  check(
    'active, it writes each TRM on the first day it is in force, under its own code',
    active.statusCode === 200 && activeRun.mode === 'ACTIVE' && activeRun.written === 3 &&
      JSON.stringify(written) === JSON.stringify([{ day: '2026-03-13', rate: 4050.1 }, { day: '2026-03-14', rate: 4061.25 }, { day: '2026-03-17', rate: 4070 }]),
    `${active.statusCode} ${JSON.stringify(written)}`,
  );

  const monday = await company.call('GET', '/api/v1/exchange-rates?from=USD&to=COP&date=2026-03-16');
  const resolvedTrm = monday.json<{ rate: number; source: string; rateType: string; quotedOn: string }>();
  check(
    'and the official rate a company resolves for the Monday is the weekend TRM, named by its source',
    monday.statusCode === 200 && Number(resolvedTrm.rate) === 4061.25 && resolvedTrm.source === 'CO-TRM' && resolvedTrm.rateType === 'OFFICIAL' && resolvedTrm.quotedOn === '2026-03-14',
    `${monday.statusCode} ${monday.body.slice(0, 200)}`,
  );

  const sources = await company.call('GET', '/api/v1/exchange-rates/official-sources');
  const colombia = sources.json<Array<{ country: string; feed: { status: string; latestEffectiveOn: string | null } | null }>>().find((source) => source.country === 'CO');
  const dominican = sources.json<Array<{ country: string; publisher: string; feed: unknown }>>().find((source) => source.country === 'DO');
  check(
    'a company reads where its market\'s official rate comes from, and whether it arrives on its own',
    sources.statusCode === 200 && colombia?.feed?.status === 'ACTIVE' && Boolean(colombia.feed.latestEffectiveOn) &&
      dominican?.publisher === 'Banco Central de la República Dominicana' && dominican.feed === null,
    `${sources.statusCode} CO=${JSON.stringify(colombia)} DO=${JSON.stringify(dominican)}`,
  );

  publisher.broken = true;
  const broken = await operator.call('POST', '/api/v1/exchange-rate-feeds/CO-TRM/runs', { from: '2026-03-01', to: '2026-03-20' });
  publisher.broken = false;
  check(
    'a publication it does not recognise fails the reading, says why, and writes nothing',
    broken.statusCode === 200 && broken.json<{ status: string; reason: string }>().status === 'FAILED' &&
      broken.json<{ reason: string }>().reason === 'currencies.official_rates.reason.publication_unrecognised' && (await trmOnFile()).length === 3,
    `${broken.statusCode} ${broken.body.slice(0, 200)}`,
  );

  // Back as found: the feed in shadow, the TRM this run wrote removed.
  await operator.call('PUT', '/api/v1/exchange-rate-feeds/CO-TRM/status', { status: 'SHADOW' });
  await ds.query(`DELETE FROM exchange_rate WHERE source = 'CO-TRM' AND date BETWEEN '2026-03-01' AND '2026-03-20'`);

  await app.close();
  if (failures.length) {
    console.error(`\n✗ ${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log('\n✓ Exchange rates: the import says what it did, every change is in the trail, a fallback is said, and the official rate is read from its publisher.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
