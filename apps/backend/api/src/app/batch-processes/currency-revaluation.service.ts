import { Injectable, Logger } from '@nestjs/common';
import { LessThanOrEqual, DataSource, EntityManager } from 'typeorm';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { ExchangeRate } from '../currencies/entities/exchange-rate.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import {
  CreateJournalEntryDto,
  CreateJournalEntryLineDto,
} from '../journal-entries/dto/create-journal-entry.dto';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { BadRequestError } from '../i18n/localized.exception';
import {
  AccountBalancesService,
  toIsoDate,
} from '../chart-of-accounts/account-balances.service';
import { convert, roundAmount, toCents } from '../common/money';

/**
 * Restates foreign-currency account balances at the closing rate — the unrealised FX adjustment.
 *
 * ## What was wrong
 *
 * The revaluation read the document-currency balance from
 * `account_balances.balance_in_foreign_currency`. Nothing ever wrote that column: the balance
 * worker's upsert listed `account_id`, `ledger_id`, `balance`, `version` and `last_updated_at`, and
 * nothing else. So the restated balance was always `0 × rate = 0`, the difference was always
 * `0 − carrying amount`, and every period close booked the **entire balance** of every
 * multicurrency account to exchange gain or loss. Since the close ran this before computing the
 * closing entry, the damage compounded.
 *
 * The document-currency balance now comes from the lines that carry it, and the two figures being
 * compared are finally the same account measured two ways.
 */
@Injectable()
export class CurrencyRevaluationService {
  private readonly logger = new Logger(CurrencyRevaluationService.name);

  constructor(
    private readonly journalEntriesService: JournalEntriesService,
    private readonly balances: AccountBalancesService,
    private readonly dataSource: DataSource,
  ) {}

  async run(
    periodEndDate: Date,
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
          'BATCH_PROCESSES.NO_ENCONTRARON_LIBROS_CONTABLES_PROCESAR_ORGANIZACION',
          { organizationId },
        );
      }

      for (const ledger of ledgersToProcess) {
        await this.runForLedger(
          periodEndDate,
          organizationId,
          ledger,
          transactionManager,
        );
      }
    };

    if (manager) await execute(manager);
    else await this.dataSource.transaction(execute);
  }

  private async runForLedger(
    periodEndDate: Date,
    organizationId: string,
    ledger: Ledger,
    manager: EntityManager,
  ): Promise<void> {
    this.logger.log(`Procesando revaluación para el libro: ${ledger.name}.`);

    const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
    if (!settings?.defaultForexGainLossAccountId) {
      this.logger.error(
        `Cuenta de ganancia/pérdida cambiaria no configurada en la organización ${organizationId}. Se omite el libro ${ledger.name}.`,
      );
      return;
    }
    const forexAccountId = settings.defaultForexGainLossAccountId;

    const generalJournal = await manager.findOneBy(Journal, {
      organizationId,
      code: 'GENERAL',
    });
    if (!generalJournal) {
      throw new BadRequestError(
        'BATCH_PROCESSES.DIARIO_GENERAL_GENERAL_NO_ENCONTRADO_ORGANIZACION',
        { organizationId },
      );
    }

    const revaluableAccounts = await manager.find(Account, {
      where: { organizationId, isMultiCurrency: true },
    });
    if (revaluableAccounts.length === 0) return;

    const accountIds = revaluableAccounts.map((account) => account.id);
    const scope = { organizationId, ledgerId: ledger.id, accountIds };

    const [carrying, documentCurrency] = await Promise.all([
      this.balances.balancesAsOf({ ...scope, asOf: periodEndDate }, manager),
      this.balances.foreignCurrencyBalancesAsOf(
        { ...scope, asOf: periodEndDate },
        manager,
      ),
    ]);

    const revaluationLines: CreateJournalEntryLineDto[] = [];
    let netAdjustmentCents = 0;

    for (const account of revaluableAccounts) {
      const documentBalance = documentCurrency.get(account.id) ?? 0;
      const carryingAmount = carrying.get(account.id) ?? 0;
      if (documentBalance === 0 && carryingAmount === 0) continue;

      if (!account.currency || account.currency === ledger.currency) {
        // Flagged multicurrency but held in the ledger's own currency: nothing to restate.
        continue;
      }

      const closingRate = await manager.findOne(ExchangeRate, {
        where: {
          fromCurrency: account.currency,
          toCurrency: ledger.currency,
          date: LessThanOrEqual(periodEndDate),
        },
        order: { date: 'DESC' },
      });
      if (!closingRate) {
        this.logger.warn(
          `Sin tasa de cierre de ${account.currency} a ${ledger.currency} al ${toIsoDate(periodEndDate)}; se omite la cuenta ${account.code}.`,
        );
        continue;
      }

      const revalued = convert(documentBalance, Number(closingRate.rate));
      const differenceCents = toCents(revalued) - toCents(carryingAmount);
      if (differenceCents === 0) continue;

      const amount = roundAmount(Math.abs(differenceCents) / 100);
      const debit = differenceCents > 0 ? amount : 0;
      const credit = differenceCents > 0 ? 0 : amount;

      revaluationLines.push({
        accountId: account.id,
        debit,
        credit,
        description: `Revaluación ${account.currency} al cierre — ${account.code}`,
        valuations: [{ ledgerId: ledger.id, debit, credit }],
      });
      netAdjustmentCents += differenceCents;
    }

    if (revaluationLines.length === 0) {
      this.logger.log(`Sin diferencias de cambio que registrar en ${ledger.name}.`);
      return;
    }

    // One entry per ledger with a single balancing line, rather than one entry per account. The
    // gain and loss on different currencies offset into a single net position, which is what an
    // unrealised FX adjustment is, and it leaves one reversible document instead of dozens.
    const netAmount = roundAmount(Math.abs(netAdjustmentCents) / 100);
    revaluationLines.push({
      accountId: forexAccountId,
      debit: netAdjustmentCents > 0 ? 0 : netAmount,
      credit: netAdjustmentCents > 0 ? netAmount : 0,
      description:
        netAdjustmentCents > 0
          ? 'Ganancia cambiaria no realizada'
          : 'Pérdida cambiaria no realizada',
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
      description: `Revaluación de moneda extranjera — libro ${ledger.name}`,
      journalId: generalJournal.id,
      lines: revaluationLines,
      // The adjustment is expressed in ledger currency; it is the restatement itself, so it
      // carries no rate of its own.
    };

    await this.journalEntriesService.createWithManager(
      manager,
      entryDto,
      organizationId,
      { actorUserId: null, systemReason: 'fx-revaluation' },
    );

    this.logger.log(
      `Revaluación registrada en ${ledger.name}: ${revaluationLines.length - 1} cuentas, neto ${roundAmount(netAdjustmentCents / 100)} ${ledger.currency}.`,
    );
  }
}
