
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { MonthlyAccountBalance } from './entities/monthly-account-balance.entity';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { Organization } from '../organizations/entities/organization.entity';

@Injectable()
export class ReportingService {
  private readonly logger = new Logger(ReportingService.name);

  constructor(
    @InjectRepository(MonthlyAccountBalance)
    private readonly monthlyBalanceRepository: Repository<MonthlyAccountBalance>,
    private readonly dataSource: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleCron() {
    this.logger.log('Iniciando trabajo programado: Actualización de vistas materializadas para reportes.');
    const organizations = await this.dataSource.getRepository(Organization).find();
    for (const org of organizations) {
      await this.updateMaterializedViews(org.id);
    }
    this.logger.log('Trabajo de actualización de vistas materializadas finalizado.');
  }

  async updateMaterializedViews(organizationId: string): Promise<void> {
    this.logger.log(`Actualizando vistas para la organización: ${organizationId}`);
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      const latestBalance = await this.monthlyBalanceRepository.findOne({
        where: { organizationId },
        order: { year: 'DESC', month: 'DESC' },
      });

      const startDate = latestBalance ? new Date(latestBalance.year, latestBalance.month, 1) : new Date(2000, 0, 1);

      const movements = await queryRunner.manager.getRepository(JournalEntryLine)
        .createQueryBuilder('line')
        .leftJoin('line.journalEntry', 'entry')
        .select([
          'line.accountId AS accountId',
          'EXTRACT(YEAR FROM entry.date) AS year',
          'EXTRACT(MONTH FROM entry.date) AS month',
          'SUM(line.debit) AS totalDebit',
          'SUM(line.credit) AS totalCredit',
        ])
        .where('entry.organizationId = :organizationId', { organizationId })
        .andWhere('entry.date >= :startDate', { startDate })
        .groupBy('line.accountId, year, month')
        .getRawMany();

      for (const move of movements) {
        const balance = await this.calculateEndBalance(queryRunner, move.accountId, move.year, move.month);
        const netChange = parseFloat(move.totalDebit) - parseFloat(move.totalCredit);

        await queryRunner.manager.upsert(MonthlyAccountBalance, {
          accountId: move.accountId,
          year: move.year,
          month: move.month,
          organizationId,
          totalDebit: move.totalDebit,
          totalCredit: move.totalCredit,
          endBalance: balance,
          netChange: netChange,
        }, ['accountId', 'year', 'month', 'organizationId']);
      }
    } catch (error) {
      this.logger.error(`Fallo al actualizar vistas para la organización ${organizationId}`, error.stack);
    } finally {
      await queryRunner.release();
    }
  }

  private async calculateEndBalance(queryRunner, accountId, year, month): Promise<number> {
      const lastDayOfMonth = new Date(year, month, 0);
      const result = await queryRunner.manager.getRepository(JournalEntryLine)
          .createQueryBuilder('line')
          .leftJoin('line.journalEntry', 'entry')
          .select('SUM(line.debit - line.credit)', 'balance')
          .where('line.accountId = :accountId', { accountId })
          .andWhere('entry.date <= :lastDayOfMonth', { lastDayOfMonth })
          .getRawOne();
      return parseFloat(result.balance) || 0;
  }
}