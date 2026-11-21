/**
 * Executable proof that a company can import a chart of accounts through the product (FIN-COA-05),
 * map its accounts between ledgers only over its own accounts (FIN-AC-05), and reprovision its
 * bookkeeping without changing a healthy one (FIN-AC-06).
 *
 * ## What this exists to stop from happening again
 *
 * «Importar» on the chart of accounts opened a dataset that only exported, and the preview/confirm
 * importer beside it had no screen at all; its preview did not look at the hierarchy, so a confirm
 * could fail after the preview had called every row fine, and a spreadsheet's «false» was a
 * non-empty string — true.
 *
 * This drives the REAL HTTP API of a freshly provisioned QA company — sign-in, the datasets list,
 * the template, a validation that refuses, a commit that writes, the tree and the export — and then
 * asks the database what the chart holds. Run it as the application role too
 * (`DB_USERNAME=virtex_app`): every write here goes through row-level security.
 */
import { DataSource } from 'typeorm';
import { bootApplication, qaCompanySession } from './support/qa-company-session';

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};



const HEADER =
  'codigo,nombre,tipo,categoria,naturaleza,cuenta_padre,admite_movimientos,activa,contracuenta,moneda,tratamiento_cambiario,rol,codigo_agrupador,descripcion';

/** A CSV file with one row per account, only the columns given filled. */
function csv(rows: Array<Partial<Record<string, string>>>): string {
  const keys = HEADER.split(',');
  return [HEADER, ...rows.map((row) => keys.map((key) => row[key] ?? '').join(','))].join('\n');
}

/** A CSV the API wrote, as lines: without the byte-order mark and the `sep=` line Excel reads. */
function csvLines(body: string): string[] {
  const lines = body.replace(/^\uFEFF/, '').split(/\r?\n/);
  return /^sep=/.test(lines[0] ?? '') ? lines.slice(1) : lines;
}

/** A multipart body carrying `content` as the `file` field, as the browser sends it. */
function multipart(fileName: string, content: string): { payload: string; headers: Record<string, string> } {
  const boundary = `----virtex-verify-${Date.now()}`;
  const payload = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
    'Content-Type: text/csv',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function main() {
  const app = await bootApplication();
  const ds = app.get(DataSource);
  const company = await qaCompanySession(app, 'Plan');
  const organizationId = company.organizationId;
  check('a company is provisioned', Boolean(organizationId), organizationId);
  check('its owner signs in', company.signedIn);
  const upload = (mode: 'validate' | 'commit', content: string) => {
    const body = multipart('plan.csv', content);
    return company.call('POST', `/api/v1/data-transfer/imports?dataset=chart_of_accounts&mode=${mode}`, body.payload, body.headers);
  };
  const chart = company.query;
  const count = async () => Number((await chart(`SELECT count(*)::int AS n FROM accounts WHERE organization_id = $1`, [organizationId]))[0].n);

  // ── The dataset is offered for import, with its hint ─────────────────────────────────────
  const datasets = await company.call('GET', '/api/v1/data-transfer/datasets');
  const offered = (JSON.parse(datasets.body) as Array<{ id: string; importable: boolean; hintKey: string | null }>).find(
    (dataset) => dataset.id === 'chart_of_accounts',
  );
  check(
    'the chart of accounts is offered for import, with what to know first',
    offered?.importable === true && offered.hintKey === 'data_transfer.hints.chart_of_accounts',
    JSON.stringify(offered),
  );

  // The template's example row: a free code under one of the company's own headings.
  const template = await company.call('GET', '/api/v1/data-transfer/datasets/chart_of_accounts/template');
  const [headingRow] = await chart(
    `SELECT p.code FROM accounts p JOIN accounts c ON c.parent_id = p.id
      WHERE p.organization_id = $1 AND p.type = 'EXPENSE' AND NOT p."isPostable"
      GROUP BY p.id, p.code ORDER BY count(c.id) DESC, p.code LIMIT 1`,
    [organizationId],
  );
  const [templateHeader = '', exampleLine = ''] = csvLines(template.body);
  check(
    'the template’s example hangs from a heading of the company’s own chart',
    template.statusCode === 200 && templateHeader.replace(/;/g, ',') === HEADER && exampleLine.split(';')[5] === headingRow?.code,
    exampleLine,
  );

  // A heading and two accounts under it, plus a contra account; cells as a person types them.
  const [expenses] = await chart(
    `SELECT code FROM accounts WHERE organization_id = $1 AND type = 'EXPENSE' AND NOT "isPostable" AND parent_id IS NULL ORDER BY code LIMIT 1`,
    [organizationId],
  );
  const [assets] = await chart(
    `SELECT code FROM accounts WHERE organization_id = $1 AND type = 'ASSET' AND NOT "isPostable" AND parent_id IS NULL ORDER BY code LIMIT 1`,
    [organizationId],
  );
  const branch = [
    { codigo: '5961', nombre: 'QA Viáticos nacionales', tipo: 'expense', categoria: 'OPERATING_EXPENSE', cuenta_padre: '5960', admite_movimientos: 'sí' },
    { codigo: '5962', nombre: 'QA Viáticos al exterior', tipo: 'EXPENSE', categoria: 'OPERATING_EXPENSE', cuenta_padre: '5960', activa: 'No' },
    { codigo: '5960', nombre: 'QA Viáticos', tipo: 'EXPENSE', categoria: 'OPERATING_EXPENSE', cuenta_padre: expenses.code, admite_movimientos: 'false' },
    { codigo: '1990', nombre: 'QA Deterioro acumulado', tipo: 'ASSET', categoria: 'NON_CURRENT_ASSET', cuenta_padre: assets.code, contracuenta: 'si' },
  ];

  // ── Validation refuses, by line and column, and writes nothing ───────────────────────────
  const before = await count();
  const refused = await upload(
    'validate',
    csv([...branch, { codigo: '5963', nombre: 'QA Ingreso mal puesto', tipo: 'REVENUE', categoria: 'OPERATING_REVENUE', cuenta_padre: '5960' }]),
  );
  const refusal = JSON.parse(refused.body) as { status: string; problems: Array<{ row: number; column?: string; key: string }> };
  check(
    'a revenue account under an expense heading is refused, naming the line and the column',
    refused.statusCode === 200 &&
      refusal.status === 'FAILED' &&
      refusal.problems.some((p) => p.row === 6 && p.column === 'cuenta_padre' && p.key === 'chart_of_accounts.child_type_differs_from_parent'),
    JSON.stringify(refusal.problems),
  );
  check('and nothing is written', (await count()) === before);

  // ── The good file, validated and committed ──────────────────────────────────────────────
  const valid = JSON.parse((await upload('validate', csv(branch))).body) as { status: string; problems: unknown[] };
  check('the file validates', valid.status === 'VALIDATED', JSON.stringify(valid.problems));
  const committed = JSON.parse((await upload('commit', csv(branch))).body) as { status: string; importedRows: number };
  check('and commits whole', committed.status === 'COMPLETED' && committed.importedRows === 4, JSON.stringify(committed));

  const imported = await chart<{ code: string; parent: string | null; isPostable: boolean; isActive: boolean; nature: string; contra: boolean }>(
    `SELECT a.code, p.code AS parent, a."isPostable" AS "isPostable", a."isActive" AS "isActive", a.nature, a.is_contra_account AS contra
       FROM accounts a LEFT JOIN accounts p ON p.id = a.parent_id
      WHERE a.organization_id = $1 AND a.code IN ('5960', '5961', '5962', '1990') ORDER BY a.code`,
    [organizationId],
  );
  const by = new Map(imported.map((row) => [row.code, row]));
  check(
    'the heading is a heading — «false» was read as no — and its accounts hang from it',
    by.get('5960')?.isPostable === false && by.get('5961')?.parent === '5960' && by.get('5961')?.isPostable === true && by.get('5962')?.parent === '5960',
    JSON.stringify(imported),
  );
  check('«No» left an account inactive', by.get('5962')?.isActive === false);
  check('the contra account carries the nature its type does not', by.get('1990')?.contra === true && by.get('1990')?.nature === 'CREDIT');

  // ── The tree and the export see it ──────────────────────────────────────────────────────
  const [heading] = await chart(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '5960'`, [organizationId]);
  const children = await company.call('GET', `/api/v1/chart-of-accounts/tree/children/${heading.id}`);
  const childCodes = (JSON.parse(children.body) as Array<{ code: string }>).map((child) => child.code);
  check('the tree answers with the imported sub-accounts', children.statusCode === 200 && childCodes.join(',') === '5961,5962', childCodes.join(','));

  const exported = await company.call('POST', '/api/v1/data-transfer/exports', { dataset: 'chart_of_accounts', format: 'csv' });
  const [exportedHeader = ''] = csvLines(exported.body);
  check(
    'the export writes the same columns the import reads, imported accounts included',
    exported.statusCode === 200 && exportedHeader.replace(/;/g, ',') === HEADER && exported.body.includes('5961'),
    exportedHeader,
  );

  // ── FIN-AC-05: a ledger mapping names the company's own accounts ─────────────────────────
  const local = await company.call('POST', '/api/v1/accounting/ledgers', { name: 'QA Libro local', currency: 'DOP' });
  const localLedger = JSON.parse(local.body) as { id?: string };
  const [primary] = await chart<{ id: string }>(`SELECT id FROM ledgers WHERE organization_id = $1 AND is_default`, [organizationId]);
  const [ownAccount] = await chart<{ id: string }>(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '5961'`, [organizationId]);
  // An account of another company: any one outside this tenant, read with the owner's connection.
  const [foreignAccount] = await ds.query(`SELECT id FROM accounts WHERE organization_id <> $1 LIMIT 1`, [organizationId]);
  const mapping = (sourceAccountId: string, multiplier = 1) =>
    company.call('POST', '/api/v1/accounting/ledger-mappings', { sourceLedgerId: primary.id, targetLedgerId: localLedger.id, mappings: [{ sourceAccountId, parentAccountId: ownAccount.id, multiplier }] });
  if (foreignAccount) {
    const refusedMapping = await mapping(foreignAccount.id);
    check(
      'a mapping rule over another company’s account is refused, naming the rule',
      refusedMapping.statusCode === 400 && JSON.parse(refusedMapping.body).messageKey === 'accounting.ledger_mapping_account_not_found',
      `${refusedMapping.statusCode} ${refusedMapping.body.slice(0, 140)}`,
    );
  }
  const negative = await mapping(ownAccount.id, -1);
  check('and so is a negative factor, which would make every posting on the account fail', negative.statusCode === 400, String(negative.statusCode));
  const accepted = await mapping(ownAccount.id, 0.5);
  check('a rule over its own account is stored', accepted.statusCode === 201 || accepted.statusCode === 200, `${local.statusCode} · ${accepted.statusCode} ${accepted.body.slice(0, 100)}`);

  // ── FIN-AC-06: reprovisioning a healthy company changes nothing and leaves no gap ─────────
  const shape = async () =>
    JSON.stringify(
      await chart(
        `SELECT (SELECT count(*)::int FROM journals WHERE organization_id = $1) AS journals,
                (SELECT count(*)::int FROM accounting_periods WHERE organization_id = $1) AS periods,
                (SELECT count(*)::int FROM ledgers WHERE organization_id = $1) AS ledgers,
                (SELECT count(*)::int FROM ledger_mapping_rules WHERE organization_id = $1) AS rules`,
        [organizationId],
      ),
    );
  const beforeReprovision = await shape();
  const reprovision = await company.call('POST', '/api/v1/accounting/reprovision');
  check(
    'reprovisioning a healthy company leaves no invoicing gap and changes nothing',
    reprovision.statusCode === 200 && JSON.stringify(JSON.parse(reprovision.body).gaps) === '[]' && (await shape()) === beforeReprovision,
    `${reprovision.statusCode} ${reprovision.body.slice(0, 120)} · ${beforeReprovision}`,
  );

  await app.close();
  if (failures.length > 0) {
    console.error(`\n${failures.length} comprobación(es) fallaron:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('\nUN PLAN DE CUENTAS SE IMPORTA ENTERO, CON SU JERARQUÍA, O NO SE IMPORTA');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
