import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { isFxTreatmentAllowedForType } from '@virtex/shared/types';
import {
  DataTransferContext,
  DataTransferDataset,
  DataTransferFileProblem,
} from '../contracts/data-transfer/data-transfer.contract';
import { DataTransferRegistry } from '../contracts/data-transfer/data-transfer.registry';
import { defaultFxTreatment } from '../contracts/accounting/fx-treatment.contract';
import { findCurrency } from '../currencies/currency-catalogue';
import { BadRequestError, isLocalizedError } from '../i18n/localized.exception';
import { PERMISSIONS } from '../shared/permissions';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { AccountImportRowDto } from './dto/account-import-row.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { AccountNature, AccountType } from './enums/account-enums';

/**
 * An account's name in the language the tenant keeps its books in.
 *
 * Names are stored per language (`{ es, en, pt }`); a spreadsheet cell takes one. The books
 * language decides, as it does on the statements; then Spanish, then whatever exists.
 */
export function accountNameIn(name: unknown, language: string | null | undefined): string {
  if (typeof name === 'string') return name;
  if (!name || typeof name !== 'object') return '';
  const names = name as Record<string, string>;
  return names[language ?? ''] ?? names['es'] ?? Object.values(names).find(Boolean) ?? '';
}

/** The balance an account of `type` normally carries. */
const normalNature = (type: AccountType): AccountNature =>
  type === AccountType.ASSET || type === AccountType.EXPENSE ? AccountNature.DEBIT : AccountNature.CREDIT;

/** The nature a row means: the one it states, or its type's — the opposite for a contra account. */
function natureOf(row: AccountImportRowDto): AccountNature {
  if (row.nature) return row.nature;
  const normal = normalNature(row.type);
  if (!row.isContraAccount) return normal;
  return normal === AccountNature.DEBIT ? AccountNature.CREDIT : AccountNature.DEBIT;
}

/** An account of the chart as the file checks see it. */
interface ChartAccount {
  id: string;
  code: string;
  type: AccountType;
  isPostable: boolean;
}

/**
 * The chart of accounts, exported and imported (QA A-13, FIN-COA-05).
 *
 * The export carries what an auditor or a migration needs, and the import takes the same columns,
 * so a chart exported here imports as it is — a group's second company, a statutory plan (Colombia's
 * PUC, Peru's PCGE), a migration from another system.
 *
 * «Importar» on the chart of accounts used to open this dataset while it was export-only, and the
 * separate preview/confirm importer it replaces had no screen; its preview did not check the
 * hierarchy, so a confirm could fail after the preview had said every row was fine. The file is now
 * checked as a whole before anything is written — the segment structure, a parent that is a heading
 * of the same type (in the file or in the chart), no loops, one account per role, the currency and
 * the foreign-currency treatment — and written all at once, parents first, through the same service
 * the form uses: a row is held to exactly the rules a person is.
 */
@Injectable()
export class ChartOfAccountsDataTransferProvider implements DataTransferDataset<AccountImportRowDto>, OnModuleInit {
  readonly id = 'chart_of_accounts';
  readonly labelKey = 'data_transfer.datasets.chart_of_accounts';
  readonly hintKey = 'data_transfer.hints.chart_of_accounts';
  readonly viewPermission = PERMISSIONS.CHART_OF_ACCOUNTS_VIEW;
  readonly columns = [
    { key: 'codigo', property: 'code', required: true, example: '6105' },
    { key: 'nombre', property: 'name', required: true, example: 'Gastos de viaje' },
    // The name in each language, for the readers of each (the books one is `nombre`).
    { key: 'nombre_es', property: 'nameEs', example: 'Gastos de viaje' },
    { key: 'nombre_en', property: 'nameEn', example: 'Travel expenses' },
    { key: 'nombre_pt', property: 'namePt', example: 'Despesas de viagem' },
    { key: 'tipo', property: 'type', required: true, example: 'EXPENSE' },
    { key: 'categoria', property: 'category', required: true, example: 'OPERATING_EXPENSE' },
    { key: 'naturaleza', property: 'nature', example: 'DEBIT' },
    { key: 'cuenta_padre', property: 'parentCode', example: '6100' },
    { key: 'admite_movimientos', property: 'isPostable', example: 'true' },
    { key: 'activa', property: 'isActive', example: 'true' },
    { key: 'contracuenta', property: 'isContraAccount', example: 'false' },
    { key: 'moneda', property: 'currency', example: '' },
    { key: 'tratamiento_cambiario', property: 'fxTreatment', example: 'HISTORICAL' },
    { key: 'rol', property: 'systemRole', example: '' },
    { key: 'codigo_agrupador', property: 'fiscalGroupingCode', example: '' },
    { key: 'descripcion', property: 'description', example: '' },
    // Restatement for inflation (FIN-AC-04): blank takes the default for the account.
    { key: 'reexpresion_inflacion', property: 'isInflationAdjustable', example: '' },
    { key: 'cuenta_reexpresion', property: 'inflationAdjustmentAccountCode', example: '' },
  ] as const;

  readonly import = {
    // Importing is creating: the permission a person needs to create an account by hand.
    createPermission: PERMISSIONS.CHART_OF_ACCOUNTS_CREATE,
    dto: AccountImportRowDto,
    uniqueBy: 'codigo',
    exists: (code: string, context: DataTransferContext) => this.exists(code, context),
    check: (row: AccountImportRowDto, context: DataTransferContext) => this.checkRow(row, context),
    checkFile: (rows: readonly AccountImportRowDto[], context: DataTransferContext) => this.checkFile(rows, context),
    createAll: (rows: readonly AccountImportRowDto[], context: DataTransferContext) => this.importAll(rows, context),
    templateExample: (context: DataTransferContext) => this.example(context),
  };

  constructor(
    private readonly registry: DataTransferRegistry,
    private readonly dataSource: DataSource,
    private readonly chart: ChartOfAccountsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this as DataTransferDataset);
  }

  async exportPage(
    organizationId: string,
    take: number,
    skip: number,
  ): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
    const [{ total }] = await this.dataSource.query(
      'SELECT COUNT(*)::int AS total FROM accounts WHERE organization_id = $1',
      [organizationId],
    );
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT a.code, a.name AS "nameMap", a.type, a.category, a.nature, p.code AS "parentCode",
              a."isPostable" AS "isPostable", a."isActive" AS "isActive",
              a.is_contra_account AS "isContraAccount", a.currency, a.fx_treatment AS "fxTreatment",
              a.system_role AS "systemRole", a.fiscal_grouping_code AS "fiscalGroupingCode",
              a.description AS "descriptionMap", o.books_language AS "booksLanguage",
              a.is_inflation_adjustable AS "isInflationAdjustable", r.code AS "inflationAdjustmentAccountCode"
         FROM accounts a
         JOIN organizations o ON o.id = a.organization_id
         LEFT JOIN accounts p ON p.id = a.parent_id
         LEFT JOIN accounts r ON r.id = a.inflation_adjustment_account_id
        WHERE a.organization_id = $1
        ORDER BY a.code
        LIMIT $2 OFFSET $3`,
      [organizationId, take, skip],
    );
    return {
      rows: rows.map((row) => {
        const language = row['booksLanguage'] as string | null;
        const names = (row['nameMap'] && typeof row['nameMap'] === 'object' ? row['nameMap'] : {}) as Record<string, string>;
        return {
          ...row,
          // The books' name: the record. Each language beside it, as the account has it.
          name: accountNameIn(row['nameMap'], language),
          nameEs: names['es'] ?? '',
          nameEn: names['en'] ?? '',
          namePt: names['pt'] ?? '',
          description: accountNameIn(row['descriptionMap'], language),
        };
      }),
      total: Number(total),
    };
  }

  // ── Import: one row ─────────────────────────────────────────────────────────────────────────

  private async exists(code: string, context: DataTransferContext): Promise<boolean> {
    const rows = await this.dataSource.query(`SELECT 1 FROM accounts WHERE organization_id = $1 AND code = $2 LIMIT 1`, [
      context.organizationId,
      code,
    ]);
    return rows.length > 0;
  }

  /** What one row can be judged on alone, with the messages the account form gives. */
  private async checkRow(row: AccountImportRowDto, context: DataTransferContext): Promise<void> {
    ChartOfAccountsService.assertCategoryFitsType(row.type, row.category);
    if (row.nature && row.nature !== natureOf({ ...row, nature: undefined })) {
      throw new BadRequestError(
        row.isContraAccount ? 'chart_of_accounts.contra_account_needs_opposite_nature' : 'chart_of_accounts.nature_does_not_match_type',
      );
    }
    if (row.currency && !findCurrency(row.currency)) {
      throw new BadRequestError('chart_of_accounts.currency_unknown', { currency: row.currency });
    }
    if (row.fxTreatment && !isFxTreatmentAllowedForType(row.type, row.fxTreatment)) {
      throw new BadRequestError('chart_of_accounts.revalued_only_balance_sheet', { type: row.type });
    }
    if (row.parentCode === row.code) {
      throw new BadRequestError('chart_of_accounts.parent_cannot_be_descendant');
    }
    if (row.systemRole) {
      const [holder] = await this.dataSource.query(
        `SELECT code FROM accounts WHERE organization_id = $1 AND system_role = $2 LIMIT 1`,
        [context.organizationId, row.systemRole],
      );
      if (holder) {
        throw new BadRequestError('chart_of_accounts.import.role_taken', { role: row.systemRole, code: holder.code });
      }
    }
  }

  // ── Import: the file as a whole ─────────────────────────────────────────────────────────────

  /**
   * What only the whole file can say: the parents, which may be other rows; whether an account is
   * a heading, which another row hanging from it decides; loops; a role named twice.
   */
  private async checkFile(rows: readonly AccountImportRowDto[], context: DataTransferContext): Promise<DataTransferFileProblem[]> {
    const [{ segments }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS segments FROM account_segment_definitions WHERE organization_id = $1`,
      [context.organizationId],
    );
    if (segments === 0) return [{ key: 'chart_of_accounts.account_segment_structure_has_not_configured' }];

    const chart = await this.chartOf(context.organizationId);
    const file = this.fileOf(rows);
    const problems: DataTransferFileProblem[] = [];

    rows.forEach((row, index) => {
      const supplied = row.code.split('-').length;
      if (supplied !== segments) {
        problems.push({
          index,
          column: 'codigo',
          key: 'chart_of_accounts.number_segments_supplied_length_does_not',
          params: { length: supplied, length2: segments },
        });
      }
      if (row.isPostable === true && file.parents.has(row.code)) {
        problems.push({ index, column: 'admite_movimientos', key: 'chart_of_accounts.account_with_subaccounts_cannot_post', params: { code: row.code } });
      }

      if (row.parentCode) {
        const inFile = file.byCode.get(row.parentCode);
        const parent = inFile
          ? { code: inFile.code, type: inFile.type, isPostable: file.postable(inFile) }
          : chart.get(row.parentCode);
        if (!parent) {
          problems.push({ index, column: 'cuenta_padre', key: 'chart_of_accounts.import.parent_account_code_neither_chart_nor', params: { code: row.parentCode } });
        } else if (parent.type !== row.type) {
          problems.push({
            index,
            column: 'cuenta_padre',
            key: 'chart_of_accounts.child_type_differs_from_parent',
            params: { code: row.code, type: row.type, parent: parent.code, parentType: parent.type },
          });
        } else if (parent.isPostable) {
          problems.push({ index, column: 'cuenta_padre', key: 'chart_of_accounts.parent_takes_postings', params: { code: row.code, parent: parent.code } });
        }
      }

      // The currency and the treatment of the account as it will be: a heading has neither.
      const isPostable = file.postable(row);
      const fxTreatment = row.fxTreatment ?? defaultFxTreatment(row.type, row.systemRole, isPostable);
      try {
        ChartOfAccountsService.assertCurrencySettings({ code: row.code, type: row.type, isPostable }, fxTreatment, row.currency ?? null);
      } catch (error) {
        if (!isLocalizedError(error)) throw error;
        problems.push({ index, column: row.currency ? 'moneda' : 'tratamiento_cambiario', key: error.messageKey, params: error.params ?? {} });
      }
    });

    // The account a row's restatement goes to exists, in the file or in the chart, and the row is
    // one that is restated at all; the rest of the rules are the form's, applied as the file commits.
    rows.forEach((row, index) => {
      const target = row.inflationAdjustmentAccountCode;
      if (!target) return;
      if (row.isInflationAdjustable === false) {
        problems.push({ index, column: 'cuenta_reexpresion', key: 'chart_of_accounts.restatement_account_needs_restated', params: { code: row.code } });
      } else if (!file.byCode.has(target) && !chart.has(target)) {
        problems.push({ index, column: 'cuenta_reexpresion', key: 'chart_of_accounts.restatement_account_not_found' });
      }
    });

    const roles = new Map<string, number>();
    rows.forEach((row, index) => {
      if (!row.systemRole) return;
      const first = roles.get(row.systemRole);
      if (first === undefined) roles.set(row.systemRole, index);
      else problems.push({ index, column: 'rol', key: 'chart_of_accounts.import.role_repeated', params: { role: row.systemRole, first: first + 2 } });
    });

    // A loop among the file's own rows: following the parents from a row comes back to it.
    rows.forEach((row, index) => {
      let current = row.parentCode ? file.byCode.get(row.parentCode) : undefined;
      for (let steps = 0; current && steps < rows.length; steps++) {
        if (current.code === row.code) {
          problems.push({ index, column: 'cuenta_padre', key: 'chart_of_accounts.parent_cannot_be_descendant' });
          return;
        }
        current = current.parentCode ? file.byCode.get(current.parentCode) : undefined;
      }
    });

    return problems;
  }

  /**
   * Writes the file in one transaction, parents before their sub-accounts, through the service the
   * form uses. A refusal now — another writer took a code or a role since the check — undoes it all.
   */
  private async importAll(rows: readonly AccountImportRowDto[], context: DataTransferContext): Promise<void> {
    const file = this.fileOf(rows);
    await this.dataSource.transaction(async (manager) => {
      const ids = new Map<string, string>(
        [...(await this.chartOf(context.organizationId, manager)).values()].map((account) => [account.code, account.id]),
      );
      for (const row of this.parentsFirst(rows, file)) {
        const parentId = row.parentCode ? ids.get(row.parentCode) : null;
        if (row.parentCode && !parentId) {
          throw new BadRequestError('chart_of_accounts.import.parent_account_code_neither_chart_nor', { code: row.parentCode });
        }
        const created = await this.chart.create(
          {
            segments: row.code.split('-').map((segment) => segment.trim()),
            name: row.name,
            translations: { es: row.nameEs ?? '', en: row.nameEn ?? '', pt: row.namePt ?? '' },
            description: row.description,
            type: row.type,
            category: row.category,
            nature: natureOf(row),
            isContraAccount: row.isContraAccount ?? false,
            parentId: parentId ?? null,
            isPostable: file.postable(row),
            isActive: row.isActive ?? true,
            currency: row.currency ?? null,
            fxTreatment: row.fxTreatment,
            systemRole: row.systemRole,
            fiscalGroupingCode: row.fiscalGroupingCode,
            isInflationAdjustable: row.isInflationAdjustable,
          } as CreateAccountDto,
          context.organizationId,
          manager,
        );
        ids.set(row.code, created.id);
      }
      // Restatement accounts last: a row may name one the file creates after it.
      for (const row of rows) {
        if (!row.inflationAdjustmentAccountCode) continue;
        const targetId = ids.get(row.inflationAdjustmentAccountCode);
        if (!targetId) throw new BadRequestError('chart_of_accounts.restatement_account_not_found');
        await this.chart.linkRestatementAccount(context.organizationId, ids.get(row.code) as string, targetId, manager);
      }
    });
  }

  /**
   * The template's example row in the company's own chart: the next free code after the last
   * operating-expense account of the heading that holds most of them, under that heading — not a
   * code that may not fit the company's segments, under a heading it may not have. The example is
   * an operating expense («Gastos de viaje»), so it follows one.
   */
  private async example(context: DataTransferContext): Promise<Record<string, string>> {
    const [last] = await this.dataSource.query(
      `WITH operating AS (
         SELECT c.code, c.parent_id FROM accounts c
          WHERE c.organization_id = $1 AND c."isPostable" AND c.type = 'EXPENSE' AND c.category = 'OPERATING_EXPENSE'
       ),
       heading AS (
         -- The heading with most of them; on a tie, the first by code — never an id's order.
         SELECT o.parent_id FROM operating o JOIN accounts h ON h.id = o.parent_id
          GROUP BY o.parent_id, h.code ORDER BY count(*) DESC, h.code LIMIT 1
       )
       SELECT max(o.code) AS code, p.code AS "parentCode"
         FROM operating o JOIN heading h ON h.parent_id = o.parent_id JOIN accounts p ON p.id = o.parent_id
        GROUP BY p.code`,
      [context.organizationId],
    );
    if (!last?.code || !/^\d+$/.test(last.code)) return {};
    const next = String(Number(last.code) + 1).padStart(last.code.length, '0');
    if (next.length !== last.code.length || (await this.exists(next, context))) return {};
    return { code: next, parentCode: last.parentCode };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────────────────────

  /** The company's accounts by code. */
  private async chartOf(organizationId: string, manager = this.dataSource.manager): Promise<Map<string, ChartAccount>> {
    const accounts: ChartAccount[] = await manager.query(
      `SELECT id, code, type, "isPostable" AS "isPostable" FROM accounts WHERE organization_id = $1`,
      [organizationId],
    );
    return new Map(accounts.map((account) => [account.code, account]));
  }

  /**
   * The file's rows by code, the codes other rows hang from, and whether a row takes postings: as
   * it says, or — when it does not say — unless another row hangs from it.
   */
  private fileOf(rows: readonly AccountImportRowDto[]) {
    const byCode = new Map(rows.map((row) => [row.code, row]));
    const parents = new Set(rows.map((row) => row.parentCode).filter((code): code is string => !!code));
    return {
      byCode,
      parents,
      postable: (row: AccountImportRowDto): boolean => row.isPostable ?? !parents.has(row.code),
    };
  }

  /** The rows in an order where each parent in the file comes before the rows that hang from it. */
  private parentsFirst(rows: readonly AccountImportRowDto[], file: ReturnType<ChartOfAccountsDataTransferProvider['fileOf']>): AccountImportRowDto[] {
    const ordered: AccountImportRowDto[] = [];
    const placed = new Set<string>();
    const place = (row: AccountImportRowDto, path: Set<string>): void => {
      if (placed.has(row.code)) return;
      // The file check refuses loops; this only keeps a defect there from becoming endless here.
      if (path.has(row.code)) throw new BadRequestError('chart_of_accounts.parent_cannot_be_descendant');
      const parent = row.parentCode ? file.byCode.get(row.parentCode) : undefined;
      if (parent) place(parent, new Set([...path, row.code]));
      placed.add(row.code);
      ordered.push(row);
    };
    for (const row of rows) place(row, new Set());
    return ordered;
  }
}
