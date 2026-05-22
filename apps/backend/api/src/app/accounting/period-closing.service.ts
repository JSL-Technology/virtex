
import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource, MoreThan, Between, IsNull } from 'typeorm';
import {
  AccountingPeriod,
  ModuleSlug,
  PeriodStatus,
} from './entities/accounting-period.entity';
import {
  Account,
  AccountType,
} from '../chart-of-accounts/entities/account.entity';
import {
  JournalEntry,
  JournalEntryStatus,
  JournalEntryType,
} from '../journal-entries/entities/journal-entry.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from './entities/ledger.entity';
import { LockAccountInPeriodDto } from './dto/lock-account-period.dto';
import { AccountPeriodLock } from './entities/account-period-lock.entity';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { AccountBalance } from '../chart-of-accounts/entities/account-balance.entity';
import { ReopenPeriodDto } from './dto/reopen-period.dto';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';
import { ClosingAutomationService } from './closing-automation.service';

@Injectable()
export class PeriodClosingService {
  private readonly logger = new Logger(PeriodClosingService.name);

  constructor(
    @InjectRepository(AccountingPeriod)
    private readonly periodRepository: Repository<AccountingPeriod>,
    @InjectRepository(OrganizationSettings)
    private readonly orgSettingsRepository: Repository<OrganizationSettings>,
    private readonly journalEntriesService: JournalEntriesService,
    private readonly dataSource: DataSource,
    @InjectRepository(AccountPeriodLock)
    private readonly accountLockRepository: Repository<AccountPeriodLock>,
    private readonly auditTrailService: AuditTrailService,
    private readonly closingAutomationService: ClosingAutomationService,
  ) {}

  async closePeriod(
    periodId: string,
    organizationId: string,
  ): Promise<AccountingPeriod> {
    this.logger.log(
      `Iniciando proceso de cierre para período ${periodId} en organización ${organizationId}.`,
    );

    return this.dataSource.transaction(async (manager) => {
      const period = await manager.findOneBy(AccountingPeriod, {
        id: periodId,
        organizationId,
      });
      if (!period) {
        throw new NotFoundException(
          'El período contable especificado no fue encontrado.',
        );
      }
      if (period.status === PeriodStatus.CLOSED) {
        throw new BadRequestException('El período ya se encuentra cerrado.');
      }
      

      await this.closingAutomationService.runPreClosingTasks(period, organizationId, manager);
      
      const defaultLedger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!defaultLedger) {
          throw new BadRequestException('No se ha configurado un libro contable por defecto para la organización.');
      }

      const draftEntriesCount = await manager.count(JournalEntry, {
        where: {
          organizationId,
          status: In([JournalEntryStatus.DRAFT, JournalEntryStatus.PENDING_APPROVAL]),
          date: Between(period.startDate, period.endDate),
        },
      });
      if (draftEntriesCount > 0) {
        throw new BadRequestException(
          `No se puede cerrar el período. Existen ${draftEntriesCount} asientos contables en borrador o pendientes de aprobación.`,
        );
      }

      const settings = await manager.findOneBy(OrganizationSettings, {
        organizationId,
      });
      if (!settings || !settings.defaultRetainedEarningsAccountId) {
        throw new BadRequestException(
          'La cuenta de Resultados del Ejercicio (Ganancias Retenidas) no está configurada para la organización.',
        );
      }

      const closingJournal = await manager.findOneBy(Journal, { organizationId, code: 'CIERRE' });
      if (!closingJournal) {
          throw new BadRequestException('Diario de Cierre (CIERRE) no encontrado. Por favor, cree un diario con este código.');
      }
      
      const incomeStatementAccounts = await manager.find(Account, {
        where: {
          organizationId,
          type: In([AccountType.REVENUE, AccountType.EXPENSE]),
        },
        relations: ['balances'],
      });

      if (incomeStatementAccounts.length > 0) {
        const closingEntryLines = incomeStatementAccounts.map((account) => {
          const balanceRecord = account.balances.find(b => b.ledgerId === defaultLedger.id);
          const balance = balanceRecord ? Number(balanceRecord.balance) : 0;
          
          const debit = account.type === AccountType.REVENUE ? balance : 0;
          const credit = account.type === AccountType.EXPENSE ? balance : 0;

          return {
            accountId: account.id,
            debit: debit,
            credit: credit,
            description: `Cierre de período: ${account.name}`,
            valuations: [{
                ledgerId: defaultLedger.id,
                debit: debit,
                credit: credit
            }]
          };
        }).filter(line => line.debit > 0 || line.credit > 0);

        const netIncome = closingEntryLines.reduce(
          (sum, line) => {
              const account = incomeStatementAccounts.find(a => a.id === line.accountId);
              if(account?.type === AccountType.REVENUE) return sum + line.debit;
              if(account?.type === AccountType.EXPENSE) return sum - line.credit;
              return sum;
          }, 0);
        
        if (closingEntryLines.length > 0) {
            const retainedDebit = netIncome < 0 ? Math.abs(netIncome) : 0;
            const retainedCredit = netIncome > 0 ? netIncome : 0;

            closingEntryLines.push({
              accountId: settings.defaultRetainedEarningsAccountId,
              debit: retainedDebit,
              credit: retainedCredit,
              description: 'Traspaso de resultado del período',
              valuations: [{
                  ledgerId: defaultLedger.id,
                  debit: retainedDebit,
                  credit: retainedCredit
              }]
            });

            this.logger.log(
              `Generando asiento de cierre con un resultado neto de: ${netIncome.toFixed(2)}`,
            );

            if (!manager.queryRunner) {
              throw new InternalServerErrorException(
                'No se pudo obtener el Query Runner de la transacción para crear el asiento de cierre.',
              );
            }
            
            const entryDto: CreateJournalEntryDto = {
                date: period.endDate.toISOString(),
                description: `Asiento de Cierre - Período ${period.name}`,
                lines: closingEntryLines,
                journalId: closingJournal.id,
                entryType: JournalEntryType.CLOSING_ENTRY,
            };

            await this.journalEntriesService.createWithQueryRunner(manager.queryRunner, entryDto, organizationId);
        } else {
            this.logger.log(
              `No hay cuentas de resultados con saldo para cerrar en el período ${period.name}.`,
            );
        }
      }

      period.status = PeriodStatus.CLOSED;
      const closedPeriod = await manager.save(period);

      this.logger.log(
        `Período ${period.name} (ID: ${periodId}) cerrado exitosamente.`,
      );
      
      const nextPeriod = await manager.findOne(AccountingPeriod, {
        where: {
          organizationId,
          startDate: MoreThan(closedPeriod.endDate)
        },
        order: { startDate: 'ASC' }
      });

      if (nextPeriod) {
        this.logger.log(`Iniciando generación de asiento de apertura para el siguiente período: ${nextPeriod.name}`);

        const openingJournal = await manager.findOneBy(Journal, { organizationId, code: 'APERTURA' });
        if (!openingJournal) {
          throw new BadRequestException('Diario de Apertura (APERTURA) no encontrado.');
        }

        const balanceSheetAccountsBalances = await manager.getRepository(AccountBalance).createQueryBuilder("balance")
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
              description: `Saldo de apertura desde período ${closedPeriod.name}`,
              valuations: [{ ledgerId: defaultLedger.id, debit, credit }]
            };
          });
          
          if (!manager.queryRunner) {
            throw new InternalServerErrorException('No se pudo obtener QueryRunner para el asiento de apertura.');
          }

          const openingEntryDto: CreateJournalEntryDto = {
            date: nextPeriod.startDate.toISOString(),
            description: `Asiento de Apertura - Período ${nextPeriod.name}`,
            journalId: openingJournal.id,
            lines: openingBalanceLines,
            entryType: JournalEntryType.OPENING_BALANCE,
          };

          await this.journalEntriesService.createWithQueryRunner(manager.queryRunner, openingEntryDto, organizationId);
          this.logger.log(`Asiento de apertura para el período ${nextPeriod.name} creado exitosamente.`);
        }
      } else {
        this.logger.log(`No se encontró un período siguiente para crear el asiento de apertura.`);
      }

      return closedPeriod;
    });
  }

  async reopenPeriod(dto: ReopenPeriodDto, organizationId: string, userId: string): Promise<AccountingPeriod> {
    const { periodId, reason } = dto;
    this.logger.log(`Iniciando solicitud de reapertura para el período ${periodId} por el usuario ${userId}. Razón: ${reason}`);

    return this.dataSource.transaction(async manager => {
        const periodToReopen = await manager.findOneBy(AccountingPeriod, { id: periodId, organizationId });
        if (!periodToReopen) throw new NotFoundException('Período a reabrir no encontrado.');
        if (periodToReopen.status !== PeriodStatus.CLOSED) throw new BadRequestException('El período no está cerrado.');

        const nextPeriod = await manager.findOne(AccountingPeriod, {
            where: { organizationId, startDate: MoreThan(periodToReopen.endDate) },
            order: { startDate: 'ASC' }
        });
        if (nextPeriod && nextPeriod.status === PeriodStatus.CLOSED) {
            throw new ForbiddenException('No se puede reabrir este período porque el período siguiente ya está cerrado.');
        }
        
        const journalRepo = manager.getRepository(JournalEntry);
        const reopeningJournal = await manager.findOneBy(Journal, { organizationId, code: 'REAPERTURA' });
        if (!reopeningJournal) {
          throw new BadRequestException('Diario de Reapertura (REAPERTURA) no encontrado.');
        }

        const closingEntry = await journalRepo.findOne({
            where: {
                organizationId,
                entryType: JournalEntryType.CLOSING_ENTRY,
                date: periodToReopen.endDate,
                reversesEntryId: IsNull()
            }
        });

        if (closingEntry) {
            await this.journalEntriesService.createSystemReversal(closingEntry.id, organizationId, {
                reversalDate: periodToReopen.endDate.toISOString(),
                reason: `Reapertura de período: ${reason}`,
                journalId: reopeningJournal.id
            }, manager);
            this.logger.log(`Asiento de cierre ${closingEntry.id} revertido.`);
        }

        if (nextPeriod) {
            const openingEntry = await journalRepo.findOne({
                where: {
                    organizationId,
                    entryType: JournalEntryType.OPENING_BALANCE,
                    date: nextPeriod.startDate,
                }
            });
            if (openingEntry) {
                 await this.journalEntriesService.createSystemReversal(openingEntry.id, organizationId, {
                    reversalDate: nextPeriod.startDate.toISOString(),
                    reason: `Reapertura de período anterior: ${reason}`,
                    journalId: reopeningJournal.id
                }, manager);
                this.logger.log(`Asiento de apertura ${openingEntry.id} del siguiente período revertido.`);
            }
        }
        
        periodToReopen.status = PeriodStatus.OPEN;
        const reopenedPeriod = await manager.save(periodToReopen);
        
        await this.auditTrailService.record(
            userId,
            'accounting_periods',
            periodId,
            ActionType.UPDATE,
            { status: PeriodStatus.OPEN, reason },
            { status: PeriodStatus.CLOSED },
        );

        this.logger.log(`Período ${periodId} reabierto exitosamente.`);
        return reopenedPeriod;
    });
  }

  private getModuleStatusColumn(module: ModuleSlug): keyof AccountingPeriod {
    switch (module) {
      case ModuleSlug.GL:
        return 'generalLedgerStatus';
      case ModuleSlug.AP:
        return 'accountsPayableStatus';
      case ModuleSlug.AR:
        return 'accountsReceivableStatus';
      case ModuleSlug.INVENTORY:
        return 'inventoryStatus';
      default:
        throw new BadRequestException(`Módulo desconocido: ${module}`);
    }
  }

  async closeModulePeriod(
    periodId: string,
    module: ModuleSlug,
    organizationId: string,
  ): Promise<AccountingPeriod> {
    const period = await this.periodRepository.findOneBy({
      id: periodId,
      organizationId,
    });
    if (!period) throw new NotFoundException('Período no encontrado.');

    const statusColumn = this.getModuleStatusColumn(module);
    (period as any)[statusColumn] = PeriodStatus.CLOSED;

    return this.periodRepository.save(period);
  }

  async reopenModulePeriod(
    periodId: string,
    module: ModuleSlug,
    organizationId: string,
  ): Promise<AccountingPeriod> {
    const period = await this.periodRepository.findOneBy({
      id: periodId,
      organizationId,
    });
    if (!period) throw new NotFoundException('Período no encontrado.');
    if (period.status === PeriodStatus.CLOSED) {
      throw new BadRequestException(
        'No se puede reabrir un módulo si el período contable general está cerrado.',
      );
    }

    const statusColumn = this.getModuleStatusColumn(module);
    (period as any)[statusColumn] = PeriodStatus.OPEN;

    return this.periodRepository.save(period);
  }

  async lockAccountInPeriod(dto: LockAccountInPeriodDto, organizationId: string): Promise<AccountPeriodLock> {
    const lock = this.accountLockRepository.create({
      ...dto,
      organizationId,
      isLocked: true,
    });
    return this.accountLockRepository.save(lock);
  }

  async unlockAccountInPeriod(dto: LockAccountInPeriodDto, organizationId: string): Promise<{ message: string }> {
    const result = await this.accountLockRepository.delete({
      ...dto,
      organizationId,
    });
    if (result.affected === 0) {
      throw new NotFoundException('No se encontró un bloqueo para la cuenta y período especificados.');
    }
    return { message: 'El bloqueo de la cuenta para el período ha sido removido.' };
  }
}