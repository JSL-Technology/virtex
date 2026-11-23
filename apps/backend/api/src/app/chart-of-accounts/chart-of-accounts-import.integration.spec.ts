import { DataSource } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { ChartOfAccountsDataTransferProvider } from './chart-of-accounts-data-transfer.provider';
import { AccountImportRowDto } from './dto/account-import-row.dto';
import { Account } from './entities/account.entity';
import { AccountHistory } from './entities/account-history.entity';
import { DataTransferRegistry } from '../contracts/data-transfer/data-transfer.registry';
import { DataTransferContext } from '../contracts/data-transfer/data-transfer.contract';
import { BadRequestError } from '../i18n/localized.exception';
import { JournalQueryService } from '../journal-entries/services/journal-query.service';
import { PERMISSIONS } from '../shared/permissions';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * A chart of accounts imported from a file (FIN-COA-05): a group's second company, a statutory
 * plan, a migration from another system.
 *
 * «Importar» on the chart opened a dataset that only exported, and the preview/confirm importer
 * beside it had no screen; its preview never looked at the hierarchy, so a file it had called fine
 * could fail on confirm. Here the dataset's own pieces, against the migrated schema: the row as the
 * platform builds it from a cell of text, the checks of each row and of the file as a whole, and the
 * write. The whole path over HTTP — upload, template, export — is `verify:chart-import`.
 */
describeWithDb('importing a chart of accounts', () => {
  jest.setTimeout(60_000);

  let ds: DataSource;
  let organizationId: string;
  let chart: ChartOfAccountsService;
  let provider: ChartOfAccountsDataTransferProvider;
  let context: DataTransferContext;

  /**
   * A row as the platform builds it from a file: every cell is text, converted with the options the
   * import uses (`DataTransferService.import`). Returns the row, or the properties it was refused on.
   */
  const row = async (cells: Record<string, string>): Promise<AccountImportRowDto> => {
    const dto = plainToInstance(AccountImportRowDto, cells, { enableImplicitConversion: true });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) throw new Error(`refused on ${errors.map((error) => error.property).join(', ')}`);
    return dto;
  };
  const expense = (code: string, parentCode: string, extra: Record<string, string> = {}) =>
    row({ code, name: `QA ${code}`, type: 'EXPENSE', category: 'OPERATING_EXPENSE', ...(parentCode ? { parentCode } : {}), ...extra });
  /** What a row is refused for on its own: null, or the message key. */
  const refusalOf = (dto: AccountImportRowDto) =>
    provider.import.check(dto, context).then(
      () => null,
      (error) => (error as { messageKey: string }).messageKey,
    );
  const accountsCount = async () =>
    Number((await ds.query(`SELECT count(*)::int AS n FROM accounts WHERE organization_id = $1`, [organizationId]))[0].n);
  const account = async (code: string) =>
    (
      await ds.query(
        `SELECT a.code, a."isPostable" AS "isPostable", a."isActive" AS "isActive", a.nature, a.fx_treatment AS "fxTreatment",
                a.currency, a.is_contra_account AS "isContraAccount", a.system_role AS "systemRole", p.code AS "parentCode"
           FROM accounts a LEFT JOIN accounts p ON p.id = a.parent_id
          WHERE a.organization_id = $1 AND a.code = $2`,
        [organizationId, code],
      )
    )[0];

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'coa-import');
    context = { organizationId, userId: null };
    await ds.query(`INSERT INTO account_segment_definitions (organization_id, name, "order", length, "isRequired") VALUES ($1, 'Cuenta', 1, 4, true)`, [
      organizationId,
    ]);
    await ds.query(`INSERT INTO organization_settings (organization_id, base_currency) VALUES ($1, 'DOP')`, [organizationId]);
    // The chart the company already has: an expense heading with one account, and its cash.
    const insert = async (code: string, type: string, category: string, nature: string, isPostable: boolean, parent: string | null, role: string | null = null) =>
      (
        await ds.query(
          `INSERT INTO accounts (organization_id, code, name, type, category, nature, "isPostable", version, parent_id, system_role)
           VALUES ($1, $2, '{"es":"Cuenta"}'::jsonb, $3, $4, $5, $6, 1, $7, $8) RETURNING id`,
          [organizationId, code, type, category, nature, isPostable, parent, role],
        )
      )[0].id as string;
    const expenses = await insert('6000', 'EXPENSE', 'OPERATING_EXPENSE', 'DEBIT', false, null);
    await insert('6010', 'EXPENSE', 'OPERATING_EXPENSE', 'DEBIT', true, expenses);
    const assets = await insert('1000', 'ASSET', 'CURRENT_ASSET', 'DEBIT', false, null);
    await insert('1010', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, assets, 'CASH');

    chart = new ChartOfAccountsService(
      ds.getRepository(Account),
      ds.getRepository(AccountHistory),
      ds,
      // Only blocking an account for posting writes to the audit trail; nothing here does.
      { record: jest.fn() } as never,
      new JournalQueryService(ds),
      { add: jest.fn() } as never,
    );
    provider = new ChartOfAccountsDataTransferProvider(new DataTransferRegistry(), ds, chart);
  });

  afterAll(async () => {
    await dropTestOrganization(ds, organizationId);
  });

  it('asks the permission a person needs to create an account by hand, and is one account per code', async () => {
    expect(provider.import.createPermission).toBe(PERMISSIONS.CHART_OF_ACCOUNTS_CREATE);
    expect(provider.import.uniqueBy).toBe('codigo');
    await expect(provider.import.exists('6010', context)).resolves.toBe(true);
    await expect(provider.import.exists('6011', context)).resolves.toBe(false);
  });

  it('reads yes/no cells as people type them — «false» is not true — and codes in any case', async () => {
    await expect(expense('6200', '6000', { isPostable: 'false' })).resolves.toMatchObject({ isPostable: false });
    await expect(expense('6210', '6000', { isPostable: 'Sí', isActive: 'No' })).resolves.toMatchObject({ isPostable: true, isActive: false });
    await expect(row({ code: '1090', name: 'Depreciación', type: 'asset', category: 'non_current_asset', isContraAccount: 'si' })).resolves.toMatchObject({
      type: 'ASSET',
      category: 'NON_CURRENT_ASSET',
      isContraAccount: true,
    });
    await expect(expense('6220', '6000', { isPostable: 'quizás' })).rejects.toThrow('refused on isPostable');
    await expect(expense('6230', '6000', { type: 'GASTO' })).rejects.toThrow('refused on type');
  });

  it('refuses a row that cannot stand alone, with the message the account form gives', async () => {
    expect(await refusalOf(await expense('6301', '6000', { category: 'CURRENT_ASSET' }))).toBe('chart_of_accounts.category_does_not_match_type');
    expect(await refusalOf(await expense('6302', '6000', { nature: 'CREDIT' }))).toBe('chart_of_accounts.nature_does_not_match_type');
    expect(await refusalOf(await expense('6303', '6000', { nature: 'DEBIT', isContraAccount: 'true' }))).toBe(
      'chart_of_accounts.contra_account_needs_opposite_nature',
    );
    expect(await refusalOf(await expense('6304', '6000', { currency: 'ZZZ' }))).toBe('chart_of_accounts.currency_unknown');
    expect(await refusalOf(await expense('6305', '6000', { fxTreatment: 'REVALUED' }))).toBe('chart_of_accounts.revalued_only_balance_sheet');
    expect(await refusalOf(await expense('6306', '6306'))).toBe('chart_of_accounts.parent_cannot_be_descendant');
    expect(
      await refusalOf(await row({ code: '1011', name: 'Otra caja', type: 'ASSET', category: 'CURRENT_ASSET', parentCode: '1000', systemRole: 'CASH' })),
    ).toBe('chart_of_accounts.import.role_taken');
    expect(await refusalOf(await expense('6307', '6000'))).toBeNull();
  });

  it('refuses what only the whole file shows: the hierarchy, the segments, a loop, a role named twice', async () => {
    const file = await Promise.all([
      // Revenue under the expense heading, and a sub-account under an account that takes postings.
      row({ code: '4400', name: 'Ingreso', type: 'REVENUE', category: 'OPERATING_REVENUE', parentCode: '6000' }),
      expense('6401', '6010'),
      // A parent nobody has, and a code with two segments in a one-segment chart.
      expense('6402', '6999'),
      expense('64-03', '6000'),
      // A heading said to take postings while another row hangs from it.
      expense('6410', '6000', { isPostable: 'true' }),
      expense('6411', '6410'),
      // A heading with a currency of its own.
      expense('6420', '6000', { currency: 'USD' }),
      expense('6421', '6420'),
      // A loop among the file's own rows.
      expense('6430', '6431'),
      expense('6431', '6430'),
      // One role on two rows.
      row({ code: '1020', name: 'Banco A', type: 'ASSET', category: 'CURRENT_ASSET', parentCode: '1000', systemRole: 'BANK' }),
      row({ code: '1021', name: 'Banco B', type: 'ASSET', category: 'CURRENT_ASSET', parentCode: '1000', systemRole: 'BANK' }),
    ]);

    const problems = await provider.import.checkFile(file, context);

    expect(problems.map(({ index, column, key }) => ({ index, column, key }))).toEqual(
      expect.arrayContaining([
        { index: 0, column: 'cuenta_padre', key: 'chart_of_accounts.child_type_differs_from_parent' },
        { index: 1, column: 'cuenta_padre', key: 'chart_of_accounts.parent_takes_postings' },
        { index: 2, column: 'cuenta_padre', key: 'chart_of_accounts.import.parent_account_code_neither_chart_nor' },
        { index: 3, column: 'codigo', key: 'chart_of_accounts.number_segments_supplied_length_does_not' },
        { index: 4, column: 'admite_movimientos', key: 'chart_of_accounts.account_with_subaccounts_cannot_post' },
        { index: 6, column: 'moneda', key: 'chart_of_accounts.summary_account_has_no_currency' },
        { index: 8, column: 'cuenta_padre', key: 'chart_of_accounts.parent_cannot_be_descendant' },
        { index: 9, column: 'cuenta_padre', key: 'chart_of_accounts.parent_cannot_be_descendant' },
        { index: 11, column: 'rol', key: 'chart_of_accounts.import.role_repeated' },
      ]),
    );
    expect(problems.find((problem) => problem.index === 11)?.params).toEqual({ role: 'BANK', first: 12 });
  });

  it('a company without a segment structure is told so, before any row is judged', async () => {
    const other = await createTestOrganization(ds, 'coa-import-bare');
    try {
      await expect(provider.import.checkFile([await expense('6001', '')], { organizationId: other, userId: null })).resolves.toEqual([
        { key: 'chart_of_accounts.account_segment_structure_has_not_configured' },
      ]);
    } finally {
      await ds.query(`DELETE FROM organizations WHERE id = $1`, [other]);
    }
  });

  it('writes a branch whole, parents first, whatever order the file lists it in', async () => {
    const file = await Promise.all([
      expense('6110', '6100'),
      expense('6100', '6000', { name: 'Gastos de viaje' }),
      row({ code: '1090', name: 'Depreciación acumulada', type: 'ASSET', category: 'NON_CURRENT_ASSET', isContraAccount: 'sí' }),
    ]);
    expect(await provider.import.checkFile(file, context)).toEqual([]);

    await provider.import.createAll(file, context);

    // 6100 is a heading because 6110 hangs from it; the nature and the treatment come from the type.
    await expect(account('6100')).resolves.toMatchObject({ isPostable: false, parentCode: '6000', nature: 'DEBIT', fxTreatment: 'HISTORICAL' });
    await expect(account('6110')).resolves.toMatchObject({ isPostable: true, parentCode: '6100', isActive: true });
    // A contra account: the nature its type does not normally carry, at the root.
    await expect(account('1090')).resolves.toMatchObject({ isContraAccount: true, nature: 'CREDIT', parentCode: null });
  });

  it('writes all of it or none of it: a refusal while writing undoes the rows already written', async () => {
    const before = await accountsCount();
    const file = await Promise.all([expense('6500', '6000'), expense('6510', '6500')]);
    const create = jest.spyOn(chart, 'create');
    const original = ChartOfAccountsService.prototype.create;
    let calls = 0;
    create.mockImplementation(async function (this: ChartOfAccountsService, ...args: Parameters<ChartOfAccountsService['create']>) {
      calls += 1;
      // Another writer took the second code between the check and the write.
      if (calls === 2) throw new BadRequestError('chart_of_accounts.account_code_full_code_already_exists', { fullCode: '6510' });
      return original.apply(this, args);
    });
    try {
      await expect(provider.import.createAll(file, context)).rejects.toMatchObject({
        messageKey: 'chart_of_accounts.account_code_full_code_already_exists',
      });
    } finally {
      create.mockRestore();
    }
    expect(calls).toBe(2);
    expect(await accountsCount()).toBe(before);
    await expect(account('6500')).resolves.toBeUndefined();
  });

  it('exports the columns it imports, so an exported chart imports as it is', async () => {
    const { rows } = await provider.exportPage(organizationId, 100, 0);
    const cash = rows.find((exported) => exported['code'] === '1010');
    expect(cash).toMatchObject({ type: 'ASSET', parentCode: '1000', isPostable: true, systemRole: 'CASH', fxTreatment: 'HISTORICAL', isContraAccount: false });
    for (const column of provider.columns) expect(cash).toHaveProperty(column.property);
  });

  it('gives the template an example from the company’s own chart: a free code under one of its headings', async () => {
    // 6000 holds most operating expenses; its last one is whatever this suite has added.
    const [{ last }] = await ds.query(
      `SELECT max(c.code) AS last FROM accounts c JOIN accounts p ON p.id = c.parent_id
        WHERE p.organization_id = $1 AND p.code = '6000' AND c."isPostable" AND c.category = 'OPERATING_EXPENSE'`,
      [organizationId],
    );
    const example = await provider.import.templateExample(context);
    expect(example).toEqual({ code: String(Number(last) + 1), parentCode: '6000' });
    await expect(account(example.code)).resolves.toBeUndefined();
  });

  /**
   * The chart in every language (books bilingual): the books keep their name — the record — and
   * the other languages carry theirs for whoever reads the screen in one of them.
   */
  const names = async (code: string) =>
    (await ds.query(`SELECT name FROM accounts WHERE organization_id = $1 AND code = $2`, [organizationId, code]))[0]?.name;

  it('keeps the books name apart from its translations, and a blank removes one', async () => {
    // An edit is recorded in the account's history under the person who made it.
    const [{ id: editor }] = await ds.query(`INSERT INTO users ("firstName", "lastName", email) VALUES ('QA', 'Idiomas', $1) RETURNING id`, [
      `qa-coa-translations-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
    ]);
    const created = await chart.create(
      {
        segments: ['6020'],
        name: 'Viáticos',
        // The books language is `name`'s: a Spanish «translation» does not overwrite it.
        translations: { en: ' Travel allowances ', pt: 'Diárias', es: 'Otro nombre' },
        type: 'EXPENSE',
        category: 'OPERATING_EXPENSE',
        nature: 'DEBIT',
        isPostable: true,
      } as never,
      organizationId,
    );
    await expect(names('6020')).resolves.toEqual({ es: 'Viáticos', en: 'Travel allowances', pt: 'Diárias' });

    // Renaming in the books keeps the translations; a blank one goes; one sent changes.
    await chart.update(created.id, { name: 'Viáticos de ventas', translations: { pt: '', en: 'Sales travel allowances' }, reasonForChange: 'QA' } as never, organizationId, editor);
    await expect(names('6020')).resolves.toEqual({ es: 'Viáticos de ventas', en: 'Sales travel allowances' });
    // Only a translation: the books name stays.
    await chart.update(created.id, { translations: { pt: 'Diárias de vendas' }, reasonForChange: 'QA' } as never, organizationId, editor);
    await expect(names('6020')).resolves.toEqual({ es: 'Viáticos de ventas', en: 'Sales travel allowances', pt: 'Diárias de vendas' });
    await ds.query(`DELETE FROM account_history WHERE changed_by_user_id = $1`, [editor]);
    await ds.query(`DELETE FROM users WHERE id = $1`, [editor]);
  });

  it('refuses a translation in a language the product does not speak, or one too long', async () => {
    const { CreateAccountDto } = await import('./dto/create-account.dto');
    const refused = async (translations: unknown) =>
      (await validate(plainToInstance(CreateAccountDto, { segments: ['6030'], name: 'x', type: 'EXPENSE', category: 'OPERATING_EXPENSE', nature: 'DEBIT', translations }))).map((error) => error.property);
    await expect(refused({ fr: 'Frais' })).resolves.toEqual(['translations']);
    await expect(refused({ en: 'x'.repeat(256) })).resolves.toEqual(['translations']);
    await expect(refused(['Banks'])).resolves.toEqual(['translations']);
    await expect(refused({ en: 'Travel', pt: '' })).resolves.toEqual([]);
  });

  it('imports and exports the name in every language beside the books one', async () => {
    const file = [await expense('6040', '6000', { name: 'Combustible', nameEn: 'Fuel', namePt: 'Combustível', nameEs: 'ignorado: es el de los libros' })];
    expect(await provider.import.checkFile(file, context)).toEqual([]);
    await provider.import.createAll(file, context);
    await expect(names('6040')).resolves.toEqual({ es: 'Combustible', en: 'Fuel', pt: 'Combustível' });

    const { rows } = await provider.exportPage(organizationId, 200, 0);
    expect(rows.find((exported) => exported['code'] === '6040')).toMatchObject({ name: 'Combustible', nameEs: 'Combustible', nameEn: 'Fuel', namePt: 'Combustível' });
    expect(provider.columns.map((column) => column.key)).toEqual(expect.arrayContaining(['nombre', 'nombre_es', 'nombre_en', 'nombre_pt']));
  });
});
