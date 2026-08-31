
import { Injectable, Logger } from '@nestjs/common';
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
import { BadRequestError, ForbiddenError, InternalServerError, NotFoundError } from '../i18n/localized.exception';

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
        throw new NotFoundError('ACCOUNTING.PERIODO_CONTABLE_ESPECIFICADO_NO_FUE_ENCONTRADO');
      }
      if (period.status === PeriodStatus.CLOSED) {
        throw new BadRequestError('ACCOUNTING.PERIODO_YA_ENCUENTRA_CERRADO');
      }
      

      await this.closingAutomationService.runPreClosingTasks(period, organizationId, manager);
      
      const defaultLedger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!defaultLedger) {
          throw new BadRequestError('ACCOUNTING.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION');
      }

      const draftEntriesCount = await manager.count(JournalEntry, {
        where: {
          organizationId,
          status: In([JournalEntryStatus.DRAFT, JournalEntryStatus.PENDING_APPROVAL]),
          date: Between(period.startDate, period.endDate),
        },
      });
      if (draftEntriesCount > 0) {
        throw new BadRequestError('ACCOUNTING.NO_PUEDE_CERRAR_PERIODO_EXISTEN_ASIENTOS_CONTABLES', { draftEntriesCount });
      }

      const settings = await manager.findOneBy(OrganizationSettings, {
        organizationId,
      });
      if (!settings || !settings.defaultRetainedEarningsAccountId) {
        throw new BadRequestError('ACCOUNTING.CUENTA_RESULTADOS_EJERCICIO_GANANCIAS_RETENIDAS_NO_ESTA');
      }

      const closingJournal = await manager.findOneBy(Journal, { organizationId, code: 'CIERRE' });
      if (!closingJournal) {
          throw new BadRequestError('ACCOUNTING.DIARIO_CIERRE_CIERRE_NO_ENCONTRADO_FAVOR_CREE');
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
              throw new InternalServerError('ACCOUNTING.NO_PUDO_OBTENER_QUERY_RUNNER_TRANSACCION_CREAR');
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
          throw new BadRequestError('ACCOUNTING.DIARIO_APERTURA_APERTURA_NO_ENCONTRADO');
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
            throw new InternalServerError('ACCOUNTING.NO_PUDO_OBTENER_QUERYRUNNER_ASIENTO_APERTURA');
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
        if (!periodToReopen) throw new NotFoundError('ACCOUNTING.PERIODO_REABRIR_NO_ENCONTRADO');
        if (periodToReopen.status !== PeriodStatus.CLOSED) throw new BadRequestError('ACCOUNTING.PERIODO_NO_ESTA_CERRADO');

        const nextPeriod = await manager.findOne(AccountingPeriod, {
            where: { organizationId, startDate: MoreThan(periodToReopen.endDate) },
            order: { startDate: 'ASC' }
        });
        if (nextPeriod && nextPeriod.status === PeriodStatus.CLOSED) {
            throw new ForbiddenError('ACCOUNTING.NO_PUEDE_REABRIR_ESTE_PERIODO_PORQUE_PERIODO');
        }
        
        const journalRepo = manager.getRepository(JournalEntry);
        const reopeningJournal = await manager.findOneBy(Journal, { organizationId, code: 'REAPERTURA' });
        if (!reopeningJournal) {
          throw new BadRequestError('ACCOUNTING.DIARIO_REAPERTURA_REAPERTURA_NO_ENCONTRADO');
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
        throw new BadRequestError('ACCOUNTING.MODULO_DESCONOCIDO', { module });
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
    if (!period) throw new NotFoundError('ACCOUNTING.PERIODO_NO_ENCONTRADO');

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
    if (!period) throw new NotFoundError('ACCOUNTING.PERIODO_NO_ENCONTRADO');
    if (period.status === PeriodStatus.CLOSED) {
      throw new BadRequestError('ACCOUNTING.NO_PUEDE_REABRIR_MODULO_SI_PERIODO_CONTABLE');
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
      throw new NotFoundError('ACCOUNTING.NO_ENCONTRO_BLOQUEO_CUENTA_PERIODO_ESPECIFICADOS');
    }
    return { message: 'El bloqueo de la cuenta para el período ha sido removido.' };
  }
}