import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DataTransferDataset } from '../contracts/data-transfer/data-transfer.contract';
import { DataTransferRegistry } from '../contracts/data-transfer/data-transfer.registry';
import { PERMISSIONS } from '../shared/permissions';
import { accountNameIn } from '../chart-of-accounts/chart-of-accounts-data-transfer.provider';

/**
 * The journal, one row per line — EXPORT ONLY (QA A-13: «Exportar» in the daybook did nothing).
 *
 * Every line of every entry with its date, number, journal, account and amounts: what an auditor
 * asks for as "the general journal" and what reconciles against the trial balance. Entries are not
 * imported here — the journal-entry import validates balance and periods on its own screen.
 */
@Injectable()
export class JournalEntryLinesDataTransferProvider implements DataTransferDataset, OnModuleInit {
  readonly id = 'journal_entry_lines';
  readonly labelKey = 'data_transfer.datasets.journal_entry_lines';
  readonly viewPermission = PERMISSIONS.JOURNAL_ENTRIES_VIEW;
  readonly columns = [
    { key: 'fecha', property: 'date' },
    { key: 'asiento', property: 'entryNumber' },
    { key: 'diario', property: 'journalCode' },
    { key: 'estado', property: 'status' },
    { key: 'concepto', property: 'entryDescription' },
    { key: 'cuenta', property: 'accountCode' },
    { key: 'nombre_cuenta', property: 'accountName' },
    { key: 'detalle', property: 'lineDescription' },
    { key: 'debito', property: 'debit' },
    { key: 'credito', property: 'credit' },
    { key: 'moneda', property: 'currencyCode' },
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
      `SELECT COUNT(*)::int AS total
         FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
        WHERE e.organization_id = $1`,
      [organizationId],
    );
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT e.date::text AS "date", e.entry_number AS "entryNumber", j.code AS "journalCode",
              e.status AS "status", e.description AS "entryDescription",
              a.code AS "accountCode", a.name AS "accountNameMap", l.description AS "lineDescription",
              l.debit::float8 AS "debit", l.credit::float8 AS "credit", e.currency_code AS "currencyCode",
              o.books_language AS "booksLanguage"
         FROM journal_entry_lines l
         JOIN journal_entries e ON e.id = l.journal_entry_id
         JOIN organizations o ON o.id = e.organization_id
         LEFT JOIN journals j ON j.id = e.journal_id
         LEFT JOIN accounts a ON a.id = l.account_id
        WHERE e.organization_id = $1
        -- Debits before credits within an entry, as a journal is read; then by account.
        ORDER BY e.date, e.entry_number NULLS LAST, e.id, (l.debit > 0) DESC, a.code, l.id
        LIMIT $2 OFFSET $3`,
      [organizationId, take, skip],
    );
    return {
      rows: rows.map((row) => ({
        ...row,
        accountName: accountNameIn(row['accountNameMap'], row['booksLanguage'] as string | null),
      })),
      total: Number(total),
    };
  }
}
