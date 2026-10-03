import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DataTransferDataset } from '../contracts/data-transfer/data-transfer.contract';
import { DataTransferRegistry } from '../contracts/data-transfer/data-transfer.registry';
import { PERMISSIONS } from '../shared/permissions';

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

/**
 * The chart of accounts — EXPORT ONLY (QA A-13: «Exportar» in the chart of accounts did nothing).
 *
 * Code, name, type, category, nature, parent and whether it takes postings: the shape an auditor
 * or a migration expects. Accounts are created from their own form, where the segment structure,
 * the parent's type and the system roles are enforced.
 */
@Injectable()
export class ChartOfAccountsDataTransferProvider implements DataTransferDataset, OnModuleInit {
  readonly id = 'chart_of_accounts';
  readonly labelKey = 'data_transfer.datasets.chart_of_accounts';
  readonly viewPermission = PERMISSIONS.CHART_OF_ACCOUNTS_VIEW;
  readonly columns = [
    { key: 'codigo', property: 'code' },
    { key: 'nombre', property: 'name' },
    { key: 'tipo', property: 'type' },
    { key: 'categoria', property: 'category' },
    { key: 'naturaleza', property: 'nature' },
    { key: 'cuenta_padre', property: 'parentCode' },
    { key: 'admite_movimientos', property: 'isPostable' },
    { key: 'activa', property: 'isActive' },
    { key: 'moneda', property: 'currency' },
  ] as const;

  constructor(
    private readonly registry: DataTransferRegistry,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
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
              a."isPostable" AS "isPostable", a."isActive" AS "isActive", a.currency,
              o.books_language AS "booksLanguage"
         FROM accounts a
         JOIN organizations o ON o.id = a.organization_id
         LEFT JOIN accounts p ON p.id = a.parent_id
        WHERE a.organization_id = $1
        ORDER BY a.code
        LIMIT $2 OFFSET $3`,
      [organizationId, take, skip],
    );
    return {
      rows: rows.map((row) => ({ ...row, name: accountNameIn(row['nameMap'], row['booksLanguage'] as string | null) })),
      total: Number(total),
    };
  }
}
