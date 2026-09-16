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
import { BadRequestError } from '../../i18n/localized.exception';
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
  ): Promise<void> {
    const execute = async (transactionManager: EntityManager) => {
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

      for (const ledger of ledgersToProcess) {
        await this.runForLedger(periodEndDate, organizationId, ledger, transactionManager);
      }
    };

    if (manager) await execute(manager);
    else await this.dataSource.transaction(execute);
  }

  private async runForLedger(
    periodEndDate: Date | string,
    organizationId: string,
    ledger: Ledger,
    manager: EntityManager,
  ): Promise<void> {
    this.logger.log(`Procesando revaluación para el libro: ${ledger.name}.`);

    const periodEndIso = toIsoDate(periodEndDate);
    const rateType = await this.exchangeRateResolver.rateTypeFor(organizationId, manager);

    const settings = await this.orgSettings.getForOrg(organizationId, manager);
    if (!settings?.defaultForexGainLossAccountId) {
      this.logger.error(
        `Cuenta de ganancia/pérdida cambiaria no configurada en la organización ${organizationId}. Se omite el libro ${ledger.name}.`,
      );
      return;
    }
    const forexAccountId = settings.defaultForexGainLossAccountId;

    const generalJournal = await this.journalLookup.requireByCode(organizationId, 'GENERAL', manager);

    const revaluableAccounts = await manager.find(Account, {
      where: { organizationId, isMultiCurrency: true },
    });
    if (revaluableAccounts.length === 0) return;

    const accountIds = revaluableAccounts.map((account) => account.id);
    const scope = { organizationId, ledgerId: ledger.id, accountIds };

    const [carrying, documentCurrency] = await Promise.all([
      this.balances.balancesAsOf({ ...scope, asOf: periodEndDate }, manager),
      this.balances.foreignCurrencyBalancesAsOf({ ...scope, asOf: periodEndDate }, manager),
    ]);

    const revaluationLines: CreateJournalEntryLineDto[] = [];
    let netAdjustmentCents = 0;

    for (const account of revaluableAccounts) {
      const documentBalance = documentCurrency.get(account.id) ?? 0;
      const carryingAmount = carrying.get(account.id) ?? 0;
      if (documentBalance === 0 && carryingAmount === 0) continue;

      if (!account.currency || account.currency === ledger.currency) continue;

      let closingRate: number;
      try {
        closingRate = await this.exchangeRateResolver.rateFor(
          account.currency,
          ledger.currency,
          periodEndIso,
          manager,
          rateType,
        );
      } catch {
        this.logger.warn(
          `Sin tasa de cierre de ${account.currency} a ${ledger.currency} al ${periodEndIso}; se omite la cuenta ${account.code}.`,
        );
        continue;
      }

      const revalued = convert(documentBalance, closingRate);
      const differenceCents = toCents(revalued) - toCents(carryingAmount);
      if (differenceCents === 0) continue;

      const amount = roundAmount(Math.abs(differenceCents) / 100);
      const debit = differenceCents > 0 ? amount : 0;
      const credit = differenceCents > 0 ? 0 : amount;

      revaluationLines.push({
        accountId: account.id,
        debit,
        credit,
        description: await this.narrative.describe(
          manager,
          organizationId,
          'ledger.revaluation.line',
          { currency: account.currency, account: account.code },
        ),
        valuations: [{ ledgerId: ledger.id, debit, credit }],
      });
      netAdjustmentCents += differenceCents;
    }

    if (revaluationLines.length === 0) {
      this.logger.log(`Sin diferencias de cambio que registrar en ${ledger.name}.`);
      return;
    }

    const netAmount = roundAmount(Math.abs(netAdjustmentCents) / 100);
    revaluationLines.push({
      accountId: forexAccountId,
      debit: netAdjustmentCents > 0 ? 0 : netAmount,
      credit: netAdjustmentCents > 0 ? netAmount : 0,
      description: await this.narrative.describe(
        manager,
        organizationId,
        netAdjustmentCents > 0
          ? 'ledger.revaluation.unrealised_gain'
          : 'ledger.revaluation.unrealised_loss',
      ),
      valuations: [
        {
          ledgerId: ledger.id,
          debit: netAdjustmentCents > 0 ? 0 : netAmount,
          credit: netAdjustmentCents > 0 ? netAmount : 0,
        },
      ],
    });

    const entryDto: CreateJournalEntryDto = {
      date: toIsoDate(periodEndDate),
      description: await this.narrative.describe(
        manager,
        organizationId,
        'ledger.revaluation.entry',
        { ledger: ledger.name },
      ),
      journalId: generalJournal.id,
      lines: revaluationLines,
    };

    await this.posting.createWithManager(manager, entryDto, organizationId, {
      actorUserId: null,
      systemReason: 'fx-revaluation',
    });

    this.logger.log(
      `Revaluación registrada en ${ledger.name}: ${revaluationLines.length - 1} cuentas, neto ${roundAmount(netAdjustmentCents / 100)} ${ledger.currency}.`,
    );
  }
}
