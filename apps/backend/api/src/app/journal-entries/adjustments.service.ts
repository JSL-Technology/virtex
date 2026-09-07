
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { JournalEntriesService } from './journal-entries.service';
import { CreateReclassificationEntryDto } from './dto/reclassification-entry.dto';
import { JournalEntry, JournalEntryType } from './entities/journal-entry.entity';
import { CreatePeriodEndAdjustmentDto } from './dto/period-end-adjustment.dto';
import { CreateAuditAdjustmentDto } from './dto/audit-adjustment.dto';
import { FiscalYear, FiscalYearStatus } from '../accounting/entities/fiscal-year.entity';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { BadRequestError, InternalServerError, NotFoundError } from '../i18n/localized.exception';
import { CreateJournalEntryLineDto } from './dto/create-journal-entry.dto';
import { Account, AccountType } from '../chart-of-accounts/entities/account.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Journal } from './entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { closingSideFor } from '../chart-of-accounts/account-balances.service';
import { roundAmount, toCents } from '../common/money';
import { toIsoDate } from '../common/dates';

@Injectable()
export class AdjustmentsService {
  private readonly logger = new Logger(AdjustmentsService.name);

  constructor(
    private readonly journalEntriesService: JournalEntriesService,
    private readonly dataSource: DataSource,
  ) {}

  async createReclassification(
    dto: CreateReclassificationEntryDto,
    organizationId: string,
    actorUserId: string,
  ): Promise<JournalEntry> {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestError('JOURNAL_ENTRIES.CUENTA_ORIGEN_DESTINO_NO_PUEDEN_SER_MISMA');
    }




    const entryDto = {
      date: dto.date,
      description: `Reclasificación: ${dto.description}`,
      journalId: dto.journalId,
      lines: [
        {
          accountId: dto.fromAccountId,
          credit: dto.amount,
          debit: 0,
          description: `Transferencia a cta. relacionada con ${dto.toAccountId.substring(0,8)}`,
        },
        {
          accountId: dto.toAccountId,
          debit: dto.amount,
          credit: 0,
          description: `Transferencia desde cta. relacionada con ${dto.fromAccountId.substring(0,8)}`,
        },
      ],
    };

    return this.journalEntriesService.create(entryDto, organizationId, {
      actorUserId,
    });
  }

  async createPeriodEndAdjustment(dto: CreatePeriodEndAdjustmentDto, organizationId: string): Promise<{ adjustment: JournalEntry }> {
    return this.dataSource.transaction(async manager => {
        if (!manager.queryRunner) {
            throw new InternalServerError('JOURNAL_ENTRIES.NO_PUDO_OBTENER_QUERY_RUNNER_TRANSACCION');
        }
        

        const createWithManager = (d: CreateJournalEntryDto) => this.journalEntriesService.createWithQueryRunner(
          manager.queryRunner!,
          d,
          organizationId,
        );

        const adjustment = await createWithManager({
            date: dto.date,
            description: `Ajuste de fin de período (${dto.adjustmentType}): ${dto.description}`,
            journalId: dto.journalId,
            lines: dto.lines,
        });

        if (dto.reversesNextPeriod) {
            adjustment.reversesNextPeriod = true;
            await manager.save(adjustment);
        }
        
        return { adjustment };
    });
  }

  /**
   * An external audit's correction to a year that has already been closed.
   *
   * ## Why this could never run
   *
   * Two independent defects, both fatal.
   *
   * `fiscal_years.end_date` is a `date` column, which the driver returns as a **string** whatever
   * the TypeScript type says. The service called `adjustmentDate.toISOString()` on it, so every
   * single invocation answered 500 with `"2025-12-31".toISOString is not a function`. The same
   * class of bug is documented as fixed in treasury and reconciliation; here it was still live.
   *
   * And the design contradicted itself. The method required a fiscal year that was *not* open, and
   * then posted through `prepare` → `resolvePostingPeriod`, which refused every closed period with
   * no exception for this entry type. Even without the TypeError, the adjustment would have been
   * rejected every time. Audit adjustments — central to a year-end close and to every external
   * audit — did not exist operationally, and nothing tested them.
   *
   * ## What it does now
   *
   * Dates are `YYYY-MM-DD` throughout, via the helper the rest of the product uses. The posting
   * carries `AUDIT_ADJUSTMENT`, which is the one entry type `resolvePostingPeriod` admits into a
   * closed period — never into a locked (archived) year, which is refused above.
   *
   * And an adjustment that touches profit and loss is followed by its own transfer to retained
   * earnings. Without it, a closed year would end with a result its closing entry does not account
   * for: the balance sheet would still balance, but retained earnings would disagree with the
   * income statement of the year it came from, which is the disagreement an auditor is there to
   * remove rather than create.
   */
  async createAuditAdjustment(
    dto: CreateAuditAdjustmentDto,
    organizationId: string,
    /** Null when the proposer's account has since been deleted; the entry is then unattributed. */
    actorUserId: string | null,
  ): Promise<JournalEntry> {
    const { fiscalYearId, ...entryData } = dto;

    return this.dataSource.transaction(async (manager) => {
      const fiscalYear = await manager.findOneBy(FiscalYear, {
        id: fiscalYearId,
        organizationId,
      });

      if (!fiscalYear) {
        throw new NotFoundError('JOURNAL_ENTRIES.ANO_FISCAL_NO_ENCONTRADO');
      }
      if (fiscalYear.status === FiscalYearStatus.OPEN) {
        throw new BadRequestError(
          'JOURNAL_ENTRIES.AJUSTES_AUDITORIA_SOLO_PUEDEN_APLICARSE_ANOS_FISCALES',
        );
      }
      if (fiscalYear.status === FiscalYearStatus.LOCKED) {
        throw new BadRequestError('JOURNAL_ENTRIES.ANO_FISCAL_ESTA_ARCHIVADO_NO_PUEDE_MODIFICAR');
      }

      // A `date` column arrives as a string. `toIsoDate` accepts either and validates what it is
      // given, which is why it exists.
      const adjustmentDate = toIsoDate(fiscalYear.endDate);

      const entry = await this.journalEntriesService.createWithManager(
        manager,
        {
          ...entryData,
          date: adjustmentDate,
          entryType: JournalEntryType.AUDIT_ADJUSTMENT,
          affectsOpeningBalance: true,
        } as CreateJournalEntryDto,
        organizationId,
        { actorUserId, systemReason: 'audit-adjustment' },
      );

      await this.transferAdjustedResult(manager, organizationId, entry, adjustmentDate, actorUserId);

      this.logger.log(
        `Ajuste de auditoría ${entry.entryNumber} contabilizado en el ejercicio cerrado ` +
          `${fiscalYearId} (cierre ${toIsoDate(fiscalYear.endDate)}) con fecha ${adjustmentDate}.`,
      );
      return entry;
    });
  }

  /**
   * Move an audit adjustment's own effect on profit and loss to retained earnings.
   *
   * Only the adjustment's effect: the year's closing entry is already posted and still stands, so
   * re-running the ordinary result transfer would close the whole year a second time. What is
   * outstanding is exactly what this entry just added to the result accounts, and that is what is
   * transferred — in one entry, dated the same day, in the closing journal, so the closed year's
   * books stay internally consistent.
   *
   * Returns without doing anything when the adjustment is purely a balance-sheet reclassification,
   * which needs no transfer.
   */
  private async transferAdjustedResult(
    manager: EntityManager,
    organizationId: string,
    entry: JournalEntry,
    date: string,
    actorUserId: string | null,
  ): Promise<void> {
    const accountIds = [...new Set(entry.lines.map((line) => line.accountId))];
    const resultAccounts = await manager.find(Account, {
      where: {
        id: In(accountIds),
        organizationId,
        type: In([AccountType.REVENUE, AccountType.EXPENSE]),
      },
      select: { id: true },
    });
    if (resultAccounts.length === 0) return;

    const isResult = new Set(resultAccounts.map((account) => account.id));
    let resultCents = 0;
    for (const line of entry.lines) {
      if (!isResult.has(line.accountId)) continue;
      resultCents += toCents(line.debit) - toCents(line.credit);
    }
    if (resultCents === 0) return;

    const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
    if (!settings?.defaultRetainedEarningsAccountId) {
      throw new BadRequestError(
        'ACCOUNTING.CUENTA_RESULTADOS_EJERCICIO_GANANCIAS_RETENIDAS_NO_ESTA',
      );
    }

    const closingJournal = await manager.findOneBy(Journal, { organizationId, code: 'CIERRE' });
    if (!closingJournal) {
      throw new BadRequestError('ACCOUNTING.DIARIO_CIERRE_CIERRE_NO_ENCONTRADO_FAVOR_CREE');
    }

    const defaultLedger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
    if (!defaultLedger) {
      throw new BadRequestError(
        'ACCOUNTING.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION',
      );
    }

    // Each result line is closed by its opposite side, and retained earnings takes the net. In
    // cents, so the entry balances by construction rather than by two formulas agreeing.
    const lines: CreateJournalEntryLineDto[] = [];
    for (const line of entry.lines) {
      if (!isResult.has(line.accountId)) continue;
      const signed = roundAmount(line.debit - line.credit);
      if (toCents(signed) === 0) continue;
      const side = closingSideFor(signed);
      lines.push({
        accountId: line.accountId,
        debit: side.debit,
        credit: side.credit,
        description: 'Cierre del ajuste de auditoría',
        valuations: [{ ledgerId: defaultLedger.id, debit: side.debit, credit: side.credit }],
      });
    }

    const retained = closingSideFor(-roundAmount(resultCents / 100));
    lines.push({
      accountId: settings.defaultRetainedEarningsAccountId,
      debit: retained.debit,
      credit: retained.credit,
      description: `Traspaso del ajuste de auditoría ${entry.entryNumber ?? entry.id}`,
      valuations: [{ ledgerId: defaultLedger.id, debit: retained.debit, credit: retained.credit }],
    });

    await this.journalEntriesService.createWithManager(
      manager,
      {
        date,
        description: `Cierre del ajuste de auditoría ${entry.entryNumber ?? entry.id}`,
        journalId: closingJournal.id,
        lines,
        entryType: JournalEntryType.CLOSING_ENTRY,
      } as CreateJournalEntryDto,
      organizationId,
      {
        actorUserId,
        systemReason: 'audit-adjustment-result-transfer',
        // Typed `CLOSING_ENTRY` so every report that excludes closing entries excludes it too,
        // which means it earns no period exemption of its own — this grants it, on the strength of
        // the adjustment it completes.
        allowClosedPeriod: true,
        // One transfer per adjustment, whatever happens to the transaction that posts it.
        idempotencyKey: `audit-adjustment-close:${entry.id}`,
      },
    );
  }
}
