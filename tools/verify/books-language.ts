/**
 * Executable proof of the books-bilingual work, over the real HTTP API of a freshly provisioned
 * Dominican QA company read by someone whose language is English. Run it as `virtex_app` too.
 *
 * What the law keeps in the books language stays there, whoever reads: the name an account is
 * filed under, the journal and chart exports. Everything else can be read in the reader's own:
 *
 *  - the opening chart carries every account's name in Spanish (the books), English and Portuguese;
 *  - an account is created with its translations, and the books name stays the one it was given;
 *  - the chart's export says the official name and each translation in its own column;
 *  - the journal's export — the books as a filing reads them — names the accounts in Spanish even
 *    when the person exporting reads English;
 *  - a narrative the system writes is recorded in Spanish and kept with the message it came from,
 *    which the screen renders in English with the catalogue the browser receives — a reversal with
 *    the narrative it reverses, a reclassification with the accounts it names; what a person
 *    typed has no message; and the API refuses a message sent from outside.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localizedNameIn, renderNarrative, type NarrativeRef } from '@virtex/shared/types';
import { bootApplication, qaCompanySession } from './support/qa-company-session';

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

type Names = Record<string, string>;
let sequence = 0;
const freshKey = () => ({ 'idempotency-key': `qa-idiomas-${Date.now()}-${sequence++}` });
/** The person reading: an English-speaking controller. */
const ENGLISH = { 'accept-language': 'en-US,en;q=0.9' };

/** A CSV export as rows of cells: the separator its `sep=` line declares, quotes as CSV has them. */
function csvRows(body: string): string[][] {
  const lines = body.replace(/^\uFEFF/, '').split(/\r?\n/);
  let separator = ',';
  if (lines[0]?.startsWith('sep=')) separator = lines.shift()?.slice(4, 5) || ',';
  const parse = (line: string): string[] => {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
      const character = line[index];
      if (quoted) {
        if (character === '"' && line[index + 1] === '"') {
          cell += '"';
          index++;
        } else if (character === '"') quoted = false;
        else cell += character;
      } else if (character === '"') quoted = true;
      else if (character === separator) {
        cells.push(cell);
        cell = '';
      } else cell += character;
    }
    cells.push(cell);
    return cells;
  };
  return lines.filter(Boolean).map(parse);
}

async function main() {
  const app = await bootApplication();
  const company = await qaCompanySession(app, 'Idiomas', 'pro', 'DO');
  check('a Dominican company is provisioned and its owner signs in', company.signedIn, company.organizationId);

  // ── The opening chart in every language ────────────────────────────────────────────────────
  const chart = (await company.call('GET', '/api/v1/chart-of-accounts', undefined, ENGLISH)).json<Array<{ id: string; code: string; name: Names }>>();
  const bank = chart.find((account) => account.code === '1120');
  check(
    'the opening chart names each account in Spanish — the books — and in English and Portuguese',
    JSON.stringify(bank?.name) === JSON.stringify({ en: 'Bank Accounts', es: 'Bancos', pt: 'Bancos' }) || (bank?.name['es'] === 'Bancos' && bank?.name['en'] === 'Bank Accounts' && bank?.name['pt'] === 'Bancos'),
    JSON.stringify(bank?.name),
  );
  const complete = chart.filter((account) => account.name['es'] && account.name['en'] && account.name['pt']).length;
  check('every account of the opening chart has all three', complete === chart.length && chart.length > 40, `${complete} de ${chart.length}`);
  const pension = chart.find((account) => account.code === '2141');
  check(
    'a Dominican institution keeps its name in the books and reads for what it is in English',
    pension?.name['es'] === 'AFP por Pagar (TSS)' && pension?.name['en'] === 'Pension Contributions Payable',
    JSON.stringify(pension?.name),
  );

  // ── An account with its translations ───────────────────────────────────────────────────────
  const expenses = chart.find((account) => account.code === '5000');
  const created = await company.call(
    'POST',
    '/api/v1/chart-of-accounts',
    {
      segments: ['5990'],
      name: 'Viáticos QA',
      translations: { en: 'QA travel allowances', es: 'no la toma: el nombre de los libros es «name»' },
      type: 'EXPENSE',
      category: 'OPERATING_EXPENSE',
      nature: 'DEBIT',
      parentId: expenses?.id,
      isPostable: true,
    },
    { ...ENGLISH, ...freshKey() },
  );
  const [stored] = await company.query<{ name: Names }>(`SELECT name FROM accounts WHERE organization_id = $1 AND code = '5990'`, [company.organizationId]);
  check(
    'an account is created with its translations, and the books name is the one it was given',
    created.statusCode === 201 && stored?.name['es'] === 'Viáticos QA' && stored?.name['en'] === 'QA travel allowances' && !stored?.name['pt'],
    `HTTP ${created.statusCode} ${JSON.stringify(stored?.name)}`,
  );
  const unknownLanguage = await company.call(
    'POST',
    '/api/v1/chart-of-accounts',
    { segments: ['5991'], name: 'x', translations: { fr: 'Frais' }, type: 'EXPENSE', category: 'OPERATING_EXPENSE', nature: 'DEBIT', parentId: expenses?.id },
    { ...ENGLISH, ...freshKey() },
  );
  check('a translation in a language the product does not speak is refused', unknownLanguage.statusCode === 400, `HTTP ${unknownLanguage.statusCode}`);

  // ── The chart's export: the official name, and each language in its column ──────────────────
  const chartExport = await company.call('POST', '/api/v1/data-transfer/exports', { dataset: 'chart_of_accounts', format: 'csv' }, ENGLISH);
  const [header = [], ...rows] = csvRows(chartExport.body);
  const column = (key: string) => header.indexOf(key);
  const bankRow = rows.find((row) => row[column('codigo')] === '1120');
  check(
    'the chart\'s export keeps the books name as the name, and each translation beside it',
    chartExport.statusCode === 200 &&
      bankRow?.[column('nombre')] === 'Bancos' &&
      bankRow?.[column('nombre_en')] === 'Bank Accounts' &&
      bankRow?.[column('nombre_pt')] === 'Bancos',
    bankRow ? `${bankRow[column('nombre')]} / ${bankRow[column('nombre_en')]} / ${bankRow[column('nombre_pt')]}` : chartExport.body.slice(0, 200),
  );

  // ── The journal's export is the books: in Spanish, whoever exports it ──────────────────────
  const [general] = await company.query<{ id: string }>(`SELECT id FROM journals WHERE organization_id = $1 AND code = 'GENERAL'`, [company.organizationId]);
  const [revenue] = await company.query<{ id: string }>(
    `SELECT id FROM accounts WHERE organization_id = $1 AND type = 'REVENUE' AND "isPostable" ORDER BY code LIMIT 1`,
    [company.organizationId],
  );
  const [{ today }] = await company.query<{ today: string }>(`SELECT to_char((now() AT TIME ZONE 'America/Santo_Domingo')::date, 'YYYY-MM-DD') AS today`);
  const posted = await company.call(
    'POST',
    '/api/v1/journal-entries',
    {
      date: today,
      description: 'QA depósito',
      journalId: general.id,
      lines: [
        { accountId: bank?.id, debit: 500, credit: 0 },
        { accountId: revenue.id, debit: 0, credit: 500 },
      ],
    },
    { ...ENGLISH, ...freshKey() },
  );
  check('an entry is posted to the bank', posted.statusCode === 201, `HTTP ${posted.statusCode}`);
  const journalExport = await company.call('POST', '/api/v1/data-transfer/exports', { dataset: 'journal_entry_lines', format: 'csv' }, ENGLISH);
  const [journalHeader = [], ...journalRows] = csvRows(journalExport.body);
  const bankLine = journalRows.find((row) => row[journalHeader.indexOf('cuenta')] === '1120');
  check(
    'the journal\'s export names the account as the books do — «Bancos» — though the reader reads English',
    journalExport.statusCode === 200 && bankLine?.[journalHeader.indexOf('nombre_cuenta')] === 'Bancos',
    bankLine ? bankLine.join(' | ') : journalExport.body.slice(0, 200),
  );

  // ── The narratives the system writes: the record in Spanish, readable in English ─────────────
  // The catalogue the browser receives, and the rule the screen renders with (`vxNarrative`).
  const shipped = JSON.parse(readFileSync(join(process.cwd(), 'apps/core/client-web/src/assets/i18n/en.json'), 'utf8')) as Record<string, string>;
  const inEnglish = (ref: NarrativeRef | null) =>
    ref
      ? renderNarrative(ref, {
          message: (key, values) =>
            key in shipped ? shipped[key].replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => (name in values ? String(values[name]) : match)) : null,
          name: (name) => localizedNameIn(name, 'en', 'es'),
        })
      : null;
  type Entry = {
    id: string;
    entryNumber: string | null;
    description: string;
    descriptionKey: string | null;
    descriptionParams: NarrativeRef['params'] | null;
    lines: Array<{ accountId: string; description: string | null; descriptionKey: string | null; descriptionParams: NarrativeRef['params'] | null }>;
  };
  const refOf = (narrated: { descriptionKey: string | null; descriptionParams: NarrativeRef['params'] | null }) =>
    narrated.descriptionKey && narrated.descriptionParams ? { key: narrated.descriptionKey, params: narrated.descriptionParams } : null;

  const manual = (await company.call('GET', `/api/v1/journal-entries/${posted.json<{ id: string }>().id}`, undefined, ENGLISH)).json<Entry>();
  check(
    'what a person typed is only text: no message is kept beside it',
    manual.description === 'QA depósito' && manual.descriptionKey === null && manual.lines.every((line) => line.descriptionKey === null),
    JSON.stringify({ description: manual.description, key: manual.descriptionKey }),
  );

  const forged = await company.call(
    'POST',
    '/api/v1/journal-entries',
    {
      date: today,
      description: 'QA falsa',
      narrative: { key: 'ledger.sales.invoice', params: { number: 'B0100000001', customer: 'QA' } },
      journalId: general.id,
      lines: [
        { accountId: bank?.id, debit: 1, credit: 0 },
        { accountId: revenue.id, debit: 0, credit: 1 },
      ],
    },
    { ...ENGLISH, ...freshKey() },
  );
  check(
    'the API refuses a message sent from outside: only the system says what it wrote a narrative from',
    forged.statusCode === 400 && forged.body.includes('narrative'),
    `HTTP ${forged.statusCode} ${forged.body.slice(0, 160)}`,
  );

  const reversed = await company.call('POST', `/api/v1/journal-entries/${manual.id}/reverse`, { reversalDate: today, reason: 'Depósito duplicado' }, { ...ENGLISH, ...freshKey() });
  const reversalId = (
    await company.query<{ id: string }>(`SELECT id FROM journal_entries WHERE organization_id = $1 AND reverses_entry_id = $2`, [company.organizationId, manual.id])
  )[0]?.id;
  const reversal = (await company.call('GET', `/api/v1/journal-entries/${reversalId}`, undefined, ENGLISH)).json<Entry>();
  check(
    'a reversal is recorded in Spanish, with the message it came from',
    reversed.statusCode < 300 && reversal.description === `Reversión de ${manual.entryNumber}. Razón: Depósito duplicado` && reversal.descriptionKey === 'ledger.reversal.entry',
    `HTTP ${reversed.statusCode} «${reversal.description}» ${reversal.descriptionKey}`,
  );
  check(
    'the screen reads it in English, and the record stays Spanish',
    inEnglish(refOf(reversal)) === `Reversal of ${manual.entryNumber}. Reason: Depósito duplicado`,
    String(inEnglish(refOf(reversal))),
  );
  const reversalBank = reversal.lines.find((line) => line.accountId === bank?.id);
  check(
    'a reversed line nests what it reverses — the person\'s text, kept as typed',
    reversalBank?.description === 'Reversión: QA depósito' && inEnglish(reversalBank ? refOf(reversalBank) : null) === 'Reversal: QA depósito',
    `«${reversalBank?.description}» → «${inEnglish(reversalBank ? refOf(reversalBank) : null)}»`,
  );

  const [ledger] = await company.query<{ id: string }>(`SELECT id FROM ledgers WHERE organization_id = $1 AND is_default`, [company.organizationId]);
  const cash = chart.find((account) => account.code === '1110');
  const reclassified = await company.call(
    'POST',
    '/api/v1/journal-entries/adjustments/reclassify',
    { ledgerId: ledger.id, date: today, description: 'QA reclasificación', fromAccountId: cash?.id, toAccountId: bank?.id, amount: 10, journalId: general.id },
    { ...ENGLISH, ...freshKey() },
  );
  const reclassification = (await company.call('GET', `/api/v1/journal-entries/${reclassified.json<{ id: string }>().id}`, undefined, ENGLISH)).json<Entry>();
  const intoBank = reclassification.lines.find((line) => line.accountId === bank?.id);
  check(
    'a reclassification names the accounts by code and name in the books — never «[object Object]»',
    reclassified.statusCode === 201 &&
      intoBank?.description === `Transferencia desde la cuenta relacionada 1110 — ${cash?.name['es']}` &&
      !JSON.stringify(reclassification).includes('[object Object]'),
    `HTTP ${reclassified.statusCode} «${intoBank?.description}»`,
  );
  check(
    'and the screen reads the account names in English',
    !!cash?.name['en'] && inEnglish(intoBank ? refOf(intoBank) : null) === `Transfer from related account 1110 — ${cash.name['en']}`,
    String(inEnglish(intoBank ? refOf(intoBank) : null)),
  );

  const generalLedger = (
    await company.call('GET', `/api/v1/accounting/ledgers/general-ledger?accountId=${bank?.id}&startDate=${today}&endDate=${today}`, undefined, ENGLISH)
  ).json<{ lines: Array<{ reference: string; description: string; descriptionKey: string | null; descriptionParams: NarrativeRef['params'] | null }> }>();
  const ledgerReversal = generalLedger.lines.find((line) => line.reference === reversal.entryNumber);
  check(
    'the general ledger hands the screen the message with the record',
    ledgerReversal?.description === 'Reversión: QA depósito' && ledgerReversal.descriptionKey === 'ledger.reversal.line',
    JSON.stringify(ledgerReversal),
  );

  const booksExport = await company.call('POST', '/api/v1/data-transfer/exports', { dataset: 'journal_entry_lines', format: 'csv' }, ENGLISH);
  check(
    'the journal\'s export carries the record — Spanish — whoever exports it',
    booksExport.statusCode === 200 && booksExport.body.includes('Reversión: QA depósito') && !booksExport.body.includes('Reversal: QA'),
    `HTTP ${booksExport.statusCode}`,
  );

  await app.close();
  if (failures.length) {
    console.error(`\n${failures.length} comprobación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nIdioma de los libros: todas las comprobaciones pasaron.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
