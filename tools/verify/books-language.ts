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
 *    when the person exporting reads English.
 */
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
