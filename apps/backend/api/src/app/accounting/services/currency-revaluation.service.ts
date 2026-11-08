import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Account } from '../../chart-of-accounts/entities/account.entity';
import { ExchangeRateResolver } from '../../currencies/exchange-rate-resolver.service';
import { AccountingPostingPort } from '../../journal-entries/accounting-posting.port';
import { OrgSettingsService } from '../../organizations/services/org-settings.service';
import { JournalLookupService } from '../../journal-entries/services/journal-lookup.service';
import {
  CreateJournalEntryDto,
  CreateJournalEntryLineDto,
} from '../../journal-entries/dto/create-journal-entry.dto';
import { Ledger } from '../entities/ledger.entity';
import { BadRequestError, UnprocessableEntityError } from '../../i18n/localized.exception';
import {
  AccountBalancesService,
  toIsoDate,
} from '../../chart-of-accounts/account-balances.service';
import { convert, roundAmount, toCents } from '../../common/money';
import { LedgerNarrativeService } from '../../journal-entries/ledger-narrative.service';
import { I18nService } from '../../i18n/i18n.service';

/**
 * Restates foreign-currency account balances at the closing rate — the unrealised FX adjustment.
 *
 * Belongs to the accounting domain: it reads the ledger's current balances and posts an
 * adjusting entry to it. Moved here from `batch-processes/` which was a technical folder with
 * no domain boundary. The service now injects `AccountingPostingPort` instead of the full
 * `JournalEntriesService`.
 *
 * ## What was wrong
 *
 * The revaluation read the document-currency balance from
 * `account_balances.balance_in_foreign_currency`. Nothing ever wrote that column: the balance
 * worker's upsert listed `account_id`, `ledger_id`, `balance`, `version` and `last_updated_at`,
 * and nothing else. So the restated balance was always `0 × rate = 0`, the difference was
 * always `0 − carrying amount`, and every period close booked the **entire balance** of every
 * multicurrency account to exchange gain or loss.
 *
 * The document-currency balance now comes from the lines that carry it, and the two figures
 * being compared are finally the same account measured two ways.
 */
@Injectable()
export class CurrencyRevaluationService {
  private readonly logger = new Logger(CurrencyRevaluationService.name);

  constructor(
    private readonly posting: AccountingPostingPort,
    private readonly balances: AccountBalancesService,
    private readonly exchangeRateResolver: ExchangeRateResolver,
    private readonly dataSource: DataSource,
    private readonly orgSettings: OrgSettingsService,
    private readonly journalLookup: JournalLookupService,
    /** Narratives in the tenant's books language; see `LedgerNarrativeService`. */
    private readonly narrative: LedgerNarrativeService = new LedgerNarrativeService(
      new I18nService(),
    ),
  ) {}

  async run(
    periodEndDate: Date | string,
    organizationId: string,
    ledgerId?: string,
    manager?: EntityManager,
  ): Promise<RevaluationResult[]> {
    const execute = async (transactionManager: EntityManager): Promise<RevaluationResult[]> => {
      this.logger.log(
        `Iniciando revaluación de moneda para la organización ${organizationId} al ${toIsoDate(periodEndDate)}${ledgerId ? ` para el libro ${ledgerId}` : ''}.`,
      );

      const ledgersToProcess = await transactionManager.find(Ledger, {
        where: { organizationId, ...(ledgerId && { id: ledgerId }) },
      });

      if (ledgersToProcess.length === 0) {
        throw new BadRequestError(
          'accounting.revaluation.no_ledgers_found',
          { organizationId },
        );
      }

      const results: RevaluationResult[] = [];
      for (const ledger of ledgersToProcess) {
        results.push(await this.runForLedger(periodEndDate, organizationId, ledger, transactionManager));
      }
      return results;
    };

    return manager ? execute(manager) : this.dataSource.transaction(execute);
  }

  /**
   * Restate the ledger's open foreign-currency MONETARY positions at the period-end rate.
   *
   * ## What it used to do (audit 2026-11-07, FINB-01, FIN-AC-03)
   *
   * It revalued only accounts with `isMultiCurrency` AND a single designated `currency`. The API
   * could not set that currency and the provisioned charts flag no account, so it never found
   * anything — and the period close recorded the task as performed. A missing forex account or a
   * missing closing rate was logged and skipped, also silently.
   *
   * ## What it does now
   *
   *  - Positions are read per (account, currency) from the lines that state a currency, so one
   *    receivable holding peso and dollar invoices is restated per currency.
   *  - Only monetary accounts are restated (IAS 21.23): bank and cash, receivables and payables,
   *    customer advances, intercompany balances — by the role the organization settings give them
   *    or the bank accounts that post to them — plus any account flagged `isMultiCurrency`.
   *    Inventory or a fixed asset bought in dollars stays at its historical rate.
   *  - Each adjustment line carries the currency and no foreign amount: it moves the carrying
   *    amount only, so the next revaluation restates just what changed since.
   *  - A position that needs restating without a closing rate, or with no forex account
   *    configured, STOPS the close with a message naming what is missing.
   */
  private async runForLedger(
    periodEndDate: Date | string,
    organizationId: string,
    ledger: Ledger,
    manager: EntityManager,
  ): Promise<RevaluationResult> {
    const periodEndIso = toIsoDate(periodEndDate);
    const ledgerCurrency = (ledger.currency ?? '').toUpperCase();
    const monetaryAccountIds = await this.monetaryAccountIds(organizationId, manager);
    if (monetaryAccountIds.length === 0) return { ledgerId: ledger.id, positions: 0, adjusted: 0 };

    const positions = (
      await this.balances.foreignPositionsAsOf(
        { organizationId, ledgerId: ledger.id, accountIds: monetaryAccountIds, asOf: periodEndDate },
        manager,
      )
    ).filter((position) => position.currencyCode !== ledgerCurrency && (position.documentBalance !== 0 || position.carryingAmount !== 0));
    if (positions.length === 0) return { ledgerId: ledger.id, positions: 0, adjusted: 0 };

    const rateType = await this.exchangeRateResolver.rateTypeFor(organizationId, manager);
    const rates = new Map<string, number>();
    const missingRates: string[] = [];
    for (const currency of new Set(positions.map((position) => position.currencyCode))) {
      try {
        rates.set(currency, await this.exchangeRateResolver.rateFor(currency, ledgerCurrency, periodEndIso, manager, rateType));
      } catch {
        missingRates.push(currency);
      }
    }
    if (missingRates.length) {
      throw new UnprocessableEntityError('accounting.revaluation.closing_rate_missing', {
        currencies: missingRates.sort().join(', '),
        ledgerCurrency,
        date: periodEndIso,
      });
    }

    const codes = new Map(
      (await manager.find(Account, { where: { organizationId }, select: { id: true, code: true } })).map((a) => [a.id, a.code]),
    );
    const revaluationLines: CreateJournalEntryLineDto[] = [];
    let netAdjustmentCents = 0;
    for (const position of positions) {
      const closingRate = rates.get(position.currencyCode) as number;
      const differenceCents = toCents(convert(position.documentBalance, closingRate)) - toCents(position.carryingAmount);
      if (differenceCents === 0) continue;
      const amount = roundAmount(Math.abs(differenceCents) / 100);
      const debit = differenceCents > 0 ? amount : 0;
      const credit = differenceCents > 0 ? 0 : amount;
      revaluationLines.push({
        accountId: position.accountId,
        debit,
        credit,
        description: await this.narrative.describe(manager, organizationId, 'ledger.revaluation.line', {
          currency: position.currencyCode,
          account: codes.get(position.accountId) ?? position.accountId,
        }),
        valuations: [{ ledgerId: ledger.id, debit, credit }],
        // A translation adjustment: the carrying amount moves, the document amount does not.
        currencyCode: position.currencyCode,
        foreignCurrencyDebit: 0,
        foreignCurrencyCredit: 0,
        exchangeRate: closingRate,
      });
      netAdjustmentCents += differenceCents;
    }
    if (revaluationLines.length === 0) {
      return { ledgerId: ledger.id, positions: positions.length, adjusted: 0 };
    }

    const settings = await this.orgSettings.getForOrg(organizationId, manager);
    if (!settings?.defaultForexGainLossAccountId) {
      throw new UnprocessableEntityError('accounting.revaluation.forex_account_missing', { ledger: ledger.name });
    }
    const netAmount = roundAmount(Math.abs(netAdjustmentCents) / 100);
    const gain = netAdjustmentCents > 0;
    revaluationLines.push({
      accountId: settings.defaultForexGainLossAccountId,
      debit: gain ? 0 : netAmount,
      credit: gain ? netAmount : 0,
      description: await this.narrative.describe(
        manager,
        organizationId,
        gain ? 'ledger.revaluation.unrealised_gain' : 'ledger.revaluation.unrealised_loss',
      ),
      valuations: [{ ledgerId: ledger.id, debit: gain ? 0 : netAmount, credit: gain ? netAmount : 0 }],
    });

    const generalJournal = await this.journalLookup.requireByCode(organizationId, 'GENERAL', manager);
    await this.posting.createWithManager(
      manager,
      {
        date: periodEndIso,
        description: await this.narrative.describe(manager, organizationId, 'ledger.revaluation.entry', { ledger: ledger.name }),
        journalId: generalJournal.id,
        lines: revaluationLines,
      } as CreateJournalEntryDto,
      organizationId,
      { actorUserId: null, systemReason: 'fx-revaluation' },
    );
    this.logger.log(
      `Revaluación registrada en ${ledger.name}: ${revaluationLines.length - 1} posiciones, neto ${roundAmount(netAdjustmentCents / 100)} ${ledgerCurrency}.`,
    );
    return { ledgerId: ledger.id, positions: positions.length, adjusted: revaluationLines.length - 1 };
  }

  /** Monetary accounts: by role in the organization settings, the bank accounts' ledgers, and flagged ones. */
  private async monetaryAccountIds(organizationId: string, manager: EntityManager): Promise<string[]> {
    const settings = await this.orgSettings.getForOrg(organizationId, manager);
    const byRole = [
      settings?.defaultAccountsReceivableId,
      settings?.defaultAccountsPayableId,
      settings?.defaultCustomerAdvancesAccountId,
      settings?.defaultCashId,
      settings?.defaultBankId,
      settings?.defaultIntercompanyReceivableAccountId,
      settings?.defaultIntercompanyPayableAccountId,
    ];
    const banks: Array<{ id: string }> = await manager.query(
      `SELECT DISTINCT gl_account_id AS id FROM bank_accounts WHERE organization_id = $1 AND gl_account_id IS NOT NULL`,
      [organizationId],
    );
    const flagged = await manager.find(Account, { where: { organizationId, isMultiCurrency: true }, select: { id: true } });
    return [...new Set([...byRole, ...banks.map((b) => b.id), ...flagged.map((a) => a.id)].filter((id): id is string => Boolean(id)))];
  }
}

export interface RevaluationResult {
  ledgerId: string;
  /** Open foreign-currency positions found on monetary accounts. */
  positions: number;
  /** How many of them needed an adjustment and got one. */
  adjusted: number;
}
