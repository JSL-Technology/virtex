
import { Injectable, BadRequestException, Logger, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { DataSource, Between, In, Not } from 'typeorm';
import { FiscalYear, FiscalYearStatus } from './entities/fiscal-year.entity';
import { JournalEntry, JournalEntryStatus, JournalEntryType } from '../journal-entries/entities/journal-entry.entity';
import { Account, AccountType } from '../chart-of-accounts/entities/account.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { YearEndCloseDto } from './dto/year-end-close.dto';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from './entities/ledger.entity';
import { AccountBalance } from '../chart-of-accounts/entities/account-balance.entity';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { AccountingPeriod, PeriodStatus } from './entities/accounting-period.entity';

@Injectable()
export class YearEndCloseService {
  private readonly logger = new Logger(YearEndCloseService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly journalEntriesService: JournalEntriesService,
  ) {}

  async closeFiscalYear(dto: YearEndCloseDto, organizationId: string): Promise<FiscalYear> {
    this.logger.log(`Iniciando cierre de año fiscal ${dto.fiscalYearId} para organización ${organizationId}.`);

    return this.dataSource.transaction(async (manager) => {
      const fiscalYearRepo = manager.getRepository(FiscalYear);
      const journalEntryRepo = manager.getRepository(JournalEntry);
      const accountRepo = manager.getRepository(Account);
      const balanceRepo = manager.getRepository(AccountBalance);
      const periodRepo = manager.getRepository(AccountingPeriod);

      const fiscalYear = await fiscalYearRepo.findOneBy({ id: dto.fiscalYearId, organizationId });
      if (!fiscalYear) throw new NotFoundException('Año fiscal no encontrado.');
      if (fiscalYear.status !== FiscalYearStatus.OPEN) throw new BadRequestException('El año fiscal no está abierto.');




      const periodsInYear = await periodRepo.find({
          where: {
              organizationId,
              startDate: Between(fiscalYear.startDate, fiscalYear.endDate),
          }
      });
      
      const openPeriods = periodsInYear.filter(p => p.status !== PeriodStatus.CLOSED);
      if(openPeriods.length > 0) {
          throw new BadRequestException(`No se puede cerrar el año fiscal. Los siguientes períodos aún están abiertos: ${openPeriods.map(p => p.name).join(', ')}`);
      }
      
      const draftEntries = await journalEntryRepo.count({
        where: {
          organizationId,
          status: In([JournalEntryStatus.DRAFT, JournalEntryStatus.PENDING_APPROVAL]),
          date: Between(fiscalYear.startDate, fiscalYear.endDate),
        },
      });
      if (draftEntries > 0) {
        throw new BadRequestException(`Existen ${draftEntries} asientos en borrador o pendientes de aprobación. Deben ser contabilizados o eliminados.`);
      }



      
      const defaultLedger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!defaultLedger) throw new BadRequestException('No se ha configurado un libro contable por defecto para la organización.');
      
      const incomeStatementAccounts = await accountRepo.find({
        where: { organizationId, type: In([AccountType.REVENUE, AccountType.EXPENSE]) },
        relations: ['balances'],
      });


      
      let netIncome = 0;
      const closingLines = incomeStatementAccounts.map(account => {
        const balanceRecord = account.balances.find(b => b.ledgerId === defaultLedger.id);
        const balance = balanceRecord ? Number(balanceRecord.balance) : 0;
        
        netIncome += (account.type === AccountType.REVENUE ? balance : -balance);

        const debit = balance > 0 ? balance : 0;
        const credit = balance < 0 ? Math.abs(balance) : 0;

        return {
          accountId: account.id,
          debit: debit,
          credit: credit,
          description: `Cierre de fin de año: ${account.name}`,
          valuations: [{ ledgerId: defaultLedger.id, debit: debit, credit: credit }]
        };
      }).filter(line => line.debit > 0 || line.credit > 0);

      if (closingLines.length > 0) {
          const retainedDebit = netIncome < 0 ? Math.abs(netIncome) : 0;
          const retainedCredit = netIncome > 0 ? netIncome : 0;
          
          closingLines.push({
            accountId: dto.retainedEarningsAccountId,
            debit: retainedDebit,
            credit: retainedCredit,
            description: 'Traspaso de resultado del ejercicio',
            valuations: [{ ledgerId: defaultLedger.id, debit: retainedDebit, credit: retainedCredit }]
          });
          
          const closingJournal = await manager.findOneBy(Journal, { organizationId, code: 'CIERRE-ANUAL' });
          if (!closingJournal) throw new BadRequestException('Diario de Cierre Anual (CIERRE-ANUAL) no encontrado.');
          
          if (!manager.queryRunner) throw new InternalServerErrorException('No se pudo obtener el Query Runner de la transacción.');
          
          const closingEntryDto: CreateJournalEntryDto = {
            date: fiscalYear.endDate.toISOString(),
            description: `Asiento de Cierre - Año Fiscal ${fiscalYear.startDate.getFullYear()}`,
            journalId: closingJournal.id,
            lines: closingLines,
            entryType: JournalEntryType.CLOSING_ENTRY,
          };

          const closingEntry = await this.journalEntriesService.createWithQueryRunner(manager.queryRunner, closingEntryDto, organizationId);
          fiscalYear.closingJournalEntryId = closingEntry.id;
      }
      
      fiscalYear.status = FiscalYearStatus.CLOSED;
      await fiscalYearRepo.save(fiscalYear);
      
      const nextYearStartDate = new Date(fiscalYear.endDate);
      nextYearStartDate.setDate(nextYearStartDate.getDate() + 1);
      
      const nextYear = fiscalYearRepo.create({
        organizationId,
        startDate: nextYearStartDate,
        endDate: new Date(nextYearStartDate.getFullYear(), 11, 31),
        status: FiscalYearStatus.OPEN,
      });
      await fiscalYearRepo.save(nextYear);
      
      const openingBalanceJournal = await manager.findOneBy(Journal, { organizationId, code: 'APERTURA' });
      if (!openingBalanceJournal) throw new BadRequestException('Diario de Apertura (APERTURA) no encontrado.');
      
      const balanceSheetAccountsBalances = await balanceRepo.createQueryBuilder("balance")
          .innerJoin("balance.account", "account")
          .where("balance.ledgerId = :ledgerId", { ledgerId: defaultLedger.id })
          .andWhere("account.organizationId = :organizationId", { organizationId })
          .andWhere("account.type IN (:...types)", { types: [AccountType.ASSET, AccountType.LIABILITY, AccountType.EQUITY] })
          .andWhere("balance.balance != 0")
          .getMany();
      
      if (balanceSheetAccountsBalances.length > 0) {
        const openingBalanceLines = balanceSheetAccountsBalances.map(bal => {
            const balanceValue = Number(bal.balance);
            const debit = balanceValue > 0 ? balanceValue : 0;
            const credit = balanceValue < 0 ? Math.abs(balanceValue) : 0;
            return {
                accountId: bal.accountId,
                debit: debit,
                credit: credit,
                description: 'Saldo de apertura del ejercicio anterior',
                valuations: [{ ledgerId: defaultLedger.id, debit: debit, credit: credit }]
            };
        });

        if (!manager.queryRunner) throw new InternalServerErrorException('No se pudo obtener el Query Runner de la transacción para el asiento de apertura.');

        const openingEntryDto: CreateJournalEntryDto = {
          date: nextYear.startDate.toISOString(),
          description: `Asiento de Apertura - Año Fiscal ${nextYear.startDate.getFullYear()}`,
          journalId: openingBalanceJournal.id,
          lines: openingBalanceLines,
          entryType: JournalEntryType.OPENING_BALANCE,
        };

        await this.journalEntriesService.createWithQueryRunner(manager.queryRunner, openingEntryDto, organizationId);
      }

      return fiscalYear;
    });
  }
}