
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not } from 'typeorm';
import { InflationIndex } from './entities/inflation-index.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { OrgSettingsService } from '../organizations/services/org-settings.service';
import { Journal } from '../journal-entries/entities/journal.entity';
import { CreateJournalEntryLineDto, CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { Ledger } from './entities/ledger.entity';
import { BadRequestError, InternalServerError, NotFoundError } from '../i18n/localized.exception';
import { AccountBalancesService } from '../chart-of-accounts/account-balances.service';
import { roundAmount, toCents } from '../common/money';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';
import { I18nService } from '../i18n/i18n.service';

@Injectable()
export class InflationAdjustmentService {
  private readonly logger = new Logger(InflationAdjustmentService.name);

  constructor(
    @InjectRepository(InflationIndex)
    private readonly inflationIndexRepository: Repository<InflationIndex>,
    private readonly journalEntriesService: JournalEntriesService,
    private readonly accountBalances: AccountBalancesService,
    private readonly orgSettings: OrgSettingsService,
    private readonly dataSource: DataSource,
    /** Narratives in the tenant's books language; see `LedgerNarrativeService`. */
    private readonly narrative: LedgerNarrativeService = new LedgerNarrativeService(
      new I18nService(),
    ),
  ) {}

  async runAdjustment(
    year: number,
    month: number,
    organizationId: string,
    actorUserId: string,
  ): Promise<void> {
    this.logger.log(`Iniciando ajuste por inflación para ${year}-${month}, Org: ${organizationId}`);

    const inflationIndex = await this.inflationIndexRepository.findOneBy({ year, month, organizationId });
    if (!inflationIndex) {
      throw new NotFoundError('accounting.no_inflation_index_found_year_month', { year, month });
    }

    const settings = await this.orgSettings.getForOrg(organizationId);
    if (!settings?.defaultInflationAdjustmentAccountId) {
        throw new BadRequestError('accounting.inflation_adjustment_account_not_configured');
    }

    const defaultLedger = await this.dataSource.getRepository(Ledger).findOneBy({ organizationId, isDefault: true });
    if (!defaultLedger) {
        throw new BadRequestError('accounting.no_default_ledger_has_configured_organization');
    }
    
    const accountsToAdjust = await this.dataSource.manager.find(Account, {
        where: { organizationId, isInflationAdjustable: true },
    });

    if (accountsToAdjust.length === 0) {
        this.logger.log('No hay cuentas marcadas para ajuste por inflación.');
        return;
    }

    await this.dataSource.transaction(async manager => {
        const adjustmentJournal = await manager.findOneBy(Journal, { organizationId, code: 'AJU-INF' });
        if (!adjustmentJournal) {
            throw new BadRequestError('accounting.inflation_adjustment_journal_aju_inf_not');
        }

        // The last day of the month being adjusted, in UTC. `new Date(year, month, 0)` builds a
        // *local* date, so on any server west of Greenwich the cut-off slipped into the previous
        // month and the adjustment was computed over the wrong balances.
        const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

        const balances = await this.accountBalances.balancesAsOf(
            {
                organizationId,
                ledgerId: defaultLedger.id,
                accountIds: accountsToAdjust.map((account) => account.id),
                asOf: periodEnd,
            },
            manager,
        );

        // `2026-03`, not `2026-3`: the month is padded so the narrative reads and sorts the way
        // every other period label in the product does.
        const period = `${year}-${String(month).padStart(2, '0')}`;
        const words = await this.narrative.describeAll(manager, organizationId, {
            line: { key: 'ledger.inflation.line', params: { period } },
            counterpart: { key: 'ledger.inflation.counterpart', params: { period } },
            header: { key: 'ledger.inflation.entry', params: { period } },
        });

        let totalAdjustmentCents = 0;
        const lines: CreateJournalEntryLineDto[] = [];

        for (const account of accountsToAdjust) {
            const currentBalance = balances.get(account.id) ?? 0;
            if (toCents(currentBalance) === 0) continue;

            const adjustmentAmount = roundAmount(currentBalance * Number(inflationIndex.rate));
            if (toCents(adjustmentAmount) === 0) continue;
            totalAdjustmentCents += toCents(adjustmentAmount);

            const debit = adjustmentAmount > 0 ? adjustmentAmount : 0;
            const credit = adjustmentAmount < 0 ? Math.abs(adjustmentAmount) : 0;

            lines.push({
                accountId: account.id,
                debit: debit,
                credit: credit,
                description: words.line,
                valuations: [{
                    ledgerId: defaultLedger.id,
                    debit: debit,
                    credit: credit
                }]
            });
        }

        if (lines.length === 0) {
            this.logger.log('No se generaron líneas de ajuste (saldos en cero).');
            return;
        }

        if (settings.defaultInflationAdjustmentAccountId) {
          const totalAdjustment = roundAmount(totalAdjustmentCents / 100);
          const contraDebit = totalAdjustment < 0 ? Math.abs(totalAdjustment) : 0;
          const contraCredit = totalAdjustment > 0 ? totalAdjustment : 0;

          lines.push({
              accountId: settings.defaultInflationAdjustmentAccountId,
              debit: contraDebit,
              credit: contraCredit,
              description: words.counterpart,
              valuations: [{
                  ledgerId: defaultLedger.id,
                  debit: contraDebit,
                  credit: contraCredit
              }]
          });
        } else {
            throw new InternalServerError('accounting.inflation_adjustment_account_disappeared_mid_transaction');
        }

        const entryDto: CreateJournalEntryDto = {
            date: periodEnd,
            description: words.header,
            lines,
            journalId: adjustmentJournal.id,
        };

        await this.journalEntriesService.createWithManager(manager, entryDto, organizationId, {
            actorUserId,
            systemReason: 'inflation-adjustment',
        });

        this.logger.log(`Ajuste por inflación completado. Se generó un asiento con ${lines.length} líneas.`);
    });
  }
}