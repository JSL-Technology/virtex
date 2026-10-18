import { createHash } from 'crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  DataTransferContext,
  DataTransferDataset,
  DataTransferFileProblem,
} from '../contracts/data-transfer/data-transfer.contract';
import { DataTransferRegistry } from '../contracts/data-transfer/data-transfer.registry';
import { PERMISSIONS } from '../shared/permissions';
import { BadRequestError } from '../i18n/localized.exception';
import { fromCents, toCents } from '../common/money';
import { OpeningBalanceRowDto } from './dto/opening-balance-row.dto';
import { JournalEntriesService } from './journal-entries.service';
import { JournalEntryType } from './entities/journal-entry.entity';
import { JournalLookupService } from './services/journal-lookup.service';
import { LedgerNarrativeService } from './ledger-narrative.service';
import { accountNameIn } from '../chart-of-accounts/chart-of-accounts-data-transfer.provider';

/** Recorded on the entry, so the books say where an opening balance came from. */
const SYSTEM_REASON = 'opening-balances-import';

/** Where the balance of an account a subledger owns comes from instead, in the person's words. */
const SUBLEDGER_REFUSAL = {
  receivables: 'data_transfer.opening_balances.subledger_receivables',
  payables: 'data_transfer.opening_balances.subledger_payables',
  inventory: 'data_transfer.opening_balances.subledger_inventory',
  bank: 'data_transfer.opening_balances.subledger_bank',
} as const;

interface AccountRow {
  id: string;
  code: string;
  isPostable: boolean;
  isActive: boolean;
  blocked: boolean;
  /** Why the balance of this account must not be typed in here, when it must not. */
  subledger: keyof typeof SUBLEDGER_REFUSAL | null;
}

/**
 * The trial balance a company brings from its previous system, as ONE opening entry.
 *
 * Each row is an account and the side its balance sits on; the file is posted as a single
 * `OPENING_BALANCE` entry in the general journal, so the closing process and every comparative
 * report can tell it from the period's transactions.
 *
 * The rows only mean something together, so the file is checked and committed as a whole:
 *
 * - every row carries the same date, and debits equal credits to the cent — a difference is never
 *   pushed to an equity account to make it balance, because that hides the error it is;
 * - the accounts must be postable, active and not blocked, exactly as for a manual entry;
 * - receivables, payables, inventory and bank accounts are refused. Their balances come from
 *   their own records — open invoices, open supplier bills, stock on hand, the bank account's
 *   opening balance — and typing a figure here as well would count it twice and break the
 *   tie-out of each subledger to its control account;
 * - the same file cannot be posted twice: the entry's idempotency key is the file's content.
 */
@Injectable()
export class OpeningBalancesDataTransferProvider implements DataTransferDataset<OpeningBalanceRowDto>, OnModuleInit {
  readonly id = 'opening_balances';
  readonly labelKey = 'data_transfer.datasets.opening_balances';
  readonly hintKey = 'data_transfer.hints.opening_balances';
  readonly viewPermission = PERMISSIONS.JOURNAL_ENTRIES_VIEW;
  readonly columns = [
    { key: 'fecha', property: 'date', required: true, example: '2026-01-01' },
    { key: 'cuenta', property: 'accountCode', required: true, example: '1101' },
    { key: 'nombre_cuenta', property: 'accountName' },
    { key: 'debito', property: 'debit', example: '150000.00' },
    { key: 'credito', property: 'credit', example: '0' },
    { key: 'detalle', property: 'description', example: 'Saldo según balance al 31/12' },
  ] as const;

  readonly import = {
    createPermission: PERMISSIONS.JOURNAL_ENTRIES_CREATE,
    dto: OpeningBalanceRowDto,
    check: (dto: OpeningBalanceRowDto, context: DataTransferContext) => this.checkRow(dto, context),
    checkFile: (dtos: readonly OpeningBalanceRowDto[], context: DataTransferContext) => this.checkFile(dtos, context),
    createAll: (dtos: readonly OpeningBalanceRowDto[], context: DataTransferContext) => this.post(dtos, context),
  };

  constructor(
    private readonly registry: DataTransferRegistry,
    private readonly dataSource: DataSource,
    private readonly journalEntries: JournalEntriesService,
    private readonly journals: JournalLookupService,
    private readonly narrative: LedgerNarrativeService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this as DataTransferDataset);
  }

  /** The opening entries already in the books, one row per line — the same shape the import takes. */
  async exportPage(organizationId: string, take: number, skip: number) {
    const [{ total }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total
         FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
        WHERE e.organization_id = $1 AND e."entryType" = $2`,
      [organizationId, JournalEntryType.OPENING_BALANCE],
    );
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT e.date::text AS "date", a.code AS "accountCode", a.name AS "accountNameMap",
              l.debit::float8 AS "debit", l.credit::float8 AS "credit", l.description AS "description",
              o.books_language AS "booksLanguage"
         FROM journal_entry_lines l
         JOIN journal_entries e ON e.id = l.journal_entry_id
         JOIN organizations o ON o.id = e.organization_id
         LEFT JOIN accounts a ON a.id = l.account_id
        WHERE e.organization_id = $1 AND e."entryType" = $2
        ORDER BY e.date, e.id, a.code, l.id
        LIMIT $3 OFFSET $4`,
      [organizationId, JournalEntryType.OPENING_BALANCE, take, skip],
    );
    return {
      rows: rows.map((row) => ({
        ...row,
        accountName: accountNameIn(row['accountNameMap'], row['booksLanguage'] as string | null),
      })),
      total: Number(total),
    };
  }

  // ── Checks ──────────────────────────────────────────────────────────────────────────────────

  private async checkRow(dto: OpeningBalanceRowDto, context: DataTransferContext): Promise<void> {
    const debit = toCents(dto.debit ?? 0);
    const credit = toCents(dto.credit ?? 0);
    if ((debit > 0) === (credit > 0)) {
      throw new BadRequestError('data_transfer.opening_balances.one_side');
    }
    const account = (await this.accounts(this.dataSource.manager, context.organizationId, [dto.accountCode])).get(
      dto.accountCode,
    );
    this.assertUsable(account, dto.accountCode);
  }

  private async checkFile(
    dtos: readonly OpeningBalanceRowDto[],
    context: DataTransferContext,
  ): Promise<DataTransferFileProblem[]> {
    const problems: DataTransferFileProblem[] = [];
    const date = dtos[0]?.date;
    dtos.forEach((dto, index) => {
      if (dto.date !== date) {
        problems.push({ index, column: 'fecha', key: 'data_transfer.opening_balances.one_date', params: { date } });
      }
    });

    const debits = dtos.reduce((sum, dto) => sum + toCents(dto.debit ?? 0), 0);
    const credits = dtos.reduce((sum, dto) => sum + toCents(dto.credit ?? 0), 0);
    if (debits !== credits) {
      problems.push({
        key: 'data_transfer.opening_balances.unbalanced',
        params: { debits: fromCents(debits), credits: fromCents(credits), difference: fromCents(debits - credits) },
      });
    }

    const [posted] = await this.dataSource.query(
      `SELECT entry_number AS "entryNumber" FROM journal_entries WHERE organization_id = $1 AND idempotency_key = $2`,
      [context.organizationId, this.keyOf(dtos)],
    );
    if (posted) {
      problems.push({
        key: 'data_transfer.opening_balances.already_posted',
        params: { entry: posted.entryNumber ?? '' },
      });
    }
    return problems;
  }

  private assertUsable(account: AccountRow | undefined, code: string): asserts account is AccountRow {
    if (!account) throw new BadRequestError('data_transfer.opening_balances.unknown_account', { code });
    if (!account.isPostable || !account.isActive || account.blocked) {
      throw new BadRequestError('data_transfer.opening_balances.account_not_postable', { code });
    }
    if (account.subledger) throw new BadRequestError(SUBLEDGER_REFUSAL[account.subledger], { code });
  }

  /** The tenant's accounts with these codes, and which of them a subledger owns. */
  private async accounts(manager: EntityManager, organizationId: string, codes: string[]): Promise<Map<string, AccountRow>> {
    const rows: AccountRow[] = await manager.query(
      `SELECT a.id, a.code, a."isPostable" AS "isPostable", a."isActive" AS "isActive",
              a.is_blocked_for_posting AS "blocked",
              CASE
                WHEN a.id = s.default_accounts_receivable_id THEN 'receivables'
                WHEN a.id = s.default_accounts_payable_id THEN 'payables'
                WHEN a.id = s.default_inventory_id THEN 'inventory'
                WHEN EXISTS (SELECT 1 FROM bank_accounts b
                              WHERE b.organization_id = a.organization_id AND b.gl_account_id = a.id) THEN 'bank'
              END AS "subledger"
         FROM accounts a
         LEFT JOIN organization_settings s ON s.organization_id = a.organization_id
        WHERE a.organization_id = $1 AND a.code = ANY($2)`,
      [organizationId, codes],
    );
    return new Map(rows.map((row) => [row.code, row]));
  }

  /** The same rows always give the same key, whatever order the file lists them in. */
  private keyOf(dtos: readonly OpeningBalanceRowDto[]): string {
    const canonical = dtos
      .map((dto) => [dto.date, dto.accountCode, toCents(dto.debit ?? 0), toCents(dto.credit ?? 0)].join('|'))
      .sort()
      .join('\n');
    return `opening-balances:${createHash('sha256').update(canonical).digest('hex').slice(0, 40)}`;
  }

  // ── Commit ──────────────────────────────────────────────────────────────────────────────────

  private async post(dtos: readonly OpeningBalanceRowDto[], context: DataTransferContext): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const codes = [...new Set(dtos.map((dto) => dto.accountCode))];
      const accounts = await this.accounts(manager, context.organizationId, codes);
      // Read again inside the transaction: the chart may have changed since the file was checked.
      for (const code of codes) this.assertUsable(accounts.get(code), code);

      const [settings] = await manager.query(
        `SELECT base_currency AS "baseCurrency" FROM organization_settings WHERE organization_id = $1`,
        [context.organizationId],
      );
      const journal = await this.journals.requireByCode(context.organizationId, 'GENERAL', manager);
      const words = await this.narrative.describeAll(manager, context.organizationId, {
        entry: { key: 'ledger.opening_balances.entry' },
        line: { key: 'ledger.opening_balances.line' },
      });

      await this.journalEntries.createWithManager(
        manager,
        {
          date: dtos[0].date,
          description: words.entry,
          journalId: journal.id,
          currencyCode: settings?.baseCurrency ?? 'USD',
          exchangeRate: 1,
          entryType: JournalEntryType.OPENING_BALANCE,
          lines: dtos.map((dto) => ({
            accountId: (accounts.get(dto.accountCode) as AccountRow).id,
            debit: dto.debit ?? 0,
            credit: dto.credit ?? 0,
            description: dto.description || words.line,
          })),
        },
        context.organizationId,
        { actorUserId: context.userId, systemReason: SYSTEM_REASON, idempotencyKey: this.keyOf(dtos) },
      );
    });
  }
}
