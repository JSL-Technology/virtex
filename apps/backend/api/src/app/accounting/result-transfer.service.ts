import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { Account, AccountType } from '../chart-of-accounts/entities/account.entity';
import {
  JournalEntry,
  JournalEntryType,
} from '../journal-entries/entities/journal-entry.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from './entities/ledger.entity';
import {
  CreateJournalEntryDto,
  CreateJournalEntryLineDto,
} from '../journal-entries/dto/create-journal-entry.dto';
import { BadRequestError } from '../i18n/localized.exception';
import {
  AccountBalancesService,
  closingSideFor,
} from '../chart-of-accounts/account-balances.service';
import { roundAmount, toCents } from '../common/money';
import { toIsoDate, type IsoDate } from '../common/dates';

/**
 * The entry that closes profit and loss into retained earnings.
 *
 * ## Why this is a fiscal-year operation and not a monthly one
 *
 * It used to run on **every** period close. A month closed, its revenue and expense accounts were
 * zeroed against retained earnings, and the entry stayed in the journal — where every report reads
 * from. The income statement sums the movement of those same accounts over a date range, so the
 * closing debit cancelled the sale's credit and the statement for a closed month read
 * `revenue 0 · expenses 0 · result 0`. A year-to-date statement spanning a closed month read zero
 * for that month too. The balance sheet still balanced, which is what made it hard to notice: the
 * result had genuinely moved to equity, it had simply also erased the report that explains it.
 *
 * Transferring the result is an annual act. A monthly close locks the period; it does not settle
 * the year. `YearEndCloseService` calls this once, for the whole fiscal year, and
 * `PeriodClosingService` no longer posts anything at all.
 *
 * ## Reports still have to ignore it
 *
 * Even annually, the closing entry would flatten the closed year's own income statement. So
 * `AccountBalancesService` can exclude `CLOSING_ENTRY` entries, and the income statement and net
 * income both ask it to. The trial balance and the general ledger deliberately do not: they are
 * books of record and the closing entry belongs in them.
 *
 * ## One sign convention
 *
 * `closingSideFor` turns a signed balance into the debit and credit that return it to zero,
 * whatever its sign. That is the whole of the arithmetic, and it is why a contra-revenue account
 * with a debit balance and an expense account with a credit refund balance need no special case —
 * the two independent implementations this replaces got exactly that wrong, in opposite directions.
 */
@Injectable()
export class ResultTransferService {
  private readonly logger = new Logger(ResultTransferService.name);

  constructor(
    private readonly journalEntriesService: JournalEntriesService,
    private readonly balances: AccountBalancesService,
  ) {}

  /**
   * Post the entry that moves the interval's result to retained earnings.
   *
   * @returns the entry, or null when there is nothing to close.
   */
  async transfer(
    manager: EntityManager,
    organizationId: string,
    range: { from: Date | string; to: Date | string; label: string },
    actorUserId: string | null,
  ): Promise<JournalEntry | null> {
    const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
    if (!settings?.defaultRetainedEarningsAccountId) {
      throw new BadRequestError(
        'ACCOUNTING.CUENTA_RESULTADOS_EJERCICIO_GANANCIAS_RETENIDAS_NO_ESTA',
      );
    }

    const closingJournal = await manager.findOneBy(Journal, {
      organizationId,
      code: 'CIERRE',
    });
    if (!closingJournal) {
      throw new BadRequestError('ACCOUNTING.DIARIO_CIERRE_CIERRE_NO_ENCONTRADO_FAVOR_CREE');
    }

    const defaultLedger = await manager.findOneBy(Ledger, {
      organizationId,
      isDefault: true,
    });
    if (!defaultLedger) {
      throw new BadRequestError(
        'ACCOUNTING.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION',
      );
    }

    const resultAccounts = await manager.find(Account, {
      where: {
        organizationId,
        type: In([AccountType.REVENUE, AccountType.EXPENSE]),
      },
      select: { id: true },
    });
    if (resultAccounts.length === 0) return null;

    // The interval's own movement, excluding any closing entry already in it — so re-running after
    // a reopen closes what is genuinely left rather than the original result all over again.
    const movements = await this.balances.movements(
      {
        organizationId,
        ledgerId: defaultLedger.id,
        accountIds: resultAccounts.map((a) => a.id),
        excludeClosingEntries: true,
        from: range.from,
        to: range.to,
      },
      manager,
    );

    const lines: CreateJournalEntryLineDto[] = [];
    let resultCents = 0;

    for (const movement of movements) {
      const signedBalance = roundAmount(movement.debit - movement.credit);
      if (toCents(signedBalance) === 0) continue;

      const { debit, credit } = closingSideFor(signedBalance);
      lines.push({
        accountId: movement.accountId,
        debit,
        credit,
        description: `Cierre de ${range.label}`,
        valuations: [{ ledgerId: defaultLedger.id, debit, credit }],
      });
      resultCents += toCents(signedBalance);
    }

    if (lines.length === 0) {
      this.logger.log(`${range.label}: sin resultados que cerrar.`);
      return null;
    }

    // `resultCents` is the sum of the signed profit-and-loss balances. Revenue is negative and
    // expense positive, so a profit is a negative sum; retained earnings takes the opposite side of
    // the lines above, which is exactly `closingSideFor` on the negated total. Computed in cents,
    // so the entry balances by construction rather than by a formula that has to agree with it.
    const retained = closingSideFor(-roundAmount(resultCents / 100));
    lines.push({
      accountId: settings.defaultRetainedEarningsAccountId,
      debit: retained.debit,
      credit: retained.credit,
      description: `Traspaso de resultado — ${range.label}`,
      valuations: [
        { ledgerId: defaultLedger.id, debit: retained.debit, credit: retained.credit },
      ],
    });

    const closingDate: IsoDate = toIsoDate(range.to);
    const entry = await this.journalEntriesService.createWithManager(
      manager,
      {
        date: closingDate,
        description: `Asiento de cierre — ${range.label}`,
        lines,
        journalId: closingJournal.id,
        entryType: JournalEntryType.CLOSING_ENTRY,
      } satisfies CreateJournalEntryDto,
      organizationId,
      { actorUserId, systemReason: 'result-transfer' },
    );

    this.logger.log(
      `Cierre de ${range.label}: ${lines.length - 1} cuentas de resultado, resultado neto ${roundAmount(-resultCents / 100)}, asiento ${entry.entryNumber}.`,
    );
    return entry;
  }
}
