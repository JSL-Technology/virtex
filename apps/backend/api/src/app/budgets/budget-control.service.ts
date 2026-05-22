
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Budget } from './entities/budget.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { BudgetLine } from './entities/budget-line.entity';
import { startOfMonth, endOfMonth } from 'date-fns';

interface BudgetCheckResult {
  isExceeded: boolean;
  message: string;
  budgetName?: string;
  budgetedAmount?: number;
  actualAmount?: number;
  variance?: number;
}

@Injectable()
export class BudgetControlService {
  private readonly logger = new Logger(BudgetControlService.name);

  constructor(
    @InjectRepository(Budget)
    private budgetRepository: Repository<Budget>,
    @InjectRepository(JournalEntryLine)
    private journalEntryLineRepository: Repository<JournalEntryLine>,
  ) {}

  async checkBudget(
    organizationId: string,
    accountId: string,
    amount: number,
    transactionDate: Date,
    dimensions?: Record<string, string>,
  ): Promise<BudgetCheckResult> {
    const periodStr = `${transactionDate.getFullYear()}-${String(transactionDate.getMonth() + 1).padStart(2, '0')}`;
    
    const budget = await this.budgetRepository.findOne({
      where: { organizationId, period: periodStr },
      relations: ['lines', 'lines.account'],
    });

    if (!budget) return { isExceeded: false, message: 'No se encontró un presupuesto activo para el período actual.' };
    

    let budgetLine = this.findMatchingBudgetLine(budget.lines, accountId, dimensions);

    if (!budgetLine) {
        this.logger.log(`No se encontró línea de presupuesto dimensional para la cuenta ${accountId}. Verificando a nivel de cuenta.`);
        budgetLine = this.findMatchingBudgetLine(budget.lines, accountId);
    }

    if (!budgetLine) return { isExceeded: false, message: 'La cuenta y/o sus dimensiones no están presupuestadas.' };

    const startDate = startOfMonth(transactionDate);
    const endDate = endOfMonth(transactionDate);


    const actualsQuery = this.journalEntryLineRepository.createQueryBuilder('line')
      .leftJoin('line.journalEntry', 'entry')
      .where('entry.organizationId = :organizationId', { organizationId })
      .andWhere('entry.date BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('line.accountId = :accountId', { accountId });
      

    if (budgetLine.dimensions) {
        for (const dimKey in budgetLine.dimensions) {
            actualsQuery.andWhere(`line.dimensions ->> :dimKey = :dimValue`, {
                dimKey,
                dimValue: budgetLine.dimensions[dimKey],
            });
        }
    } else {

        actualsQuery.andWhere('line.dimensions IS NULL OR line.dimensions::text = \'{}\'');
    }

    const actuals = await actualsQuery
      .select('SUM(line.debit - line.credit)', 'actual')
      .getRawOne();
      
    const currentActual = parseFloat(actuals.actual) || 0;
    const budgetedAmount = Number(budgetLine.amount);

    if ((currentActual + amount) > budgetedAmount) {
      return {
        isExceeded: true,

        message: `El monto propuesto de ${amount.toFixed(2)} excede el presupuesto de ${budgetedAmount.toFixed(2)} para la cuenta ${budgetLine.account?.code || budgetLine.accountId}. Gasto actual: ${currentActual.toFixed(2)}.`,

        budgetName: budget.name,
        budgetedAmount,
        actualAmount: currentActual,
        variance: budgetedAmount - currentActual,
      };
    }

    return { isExceeded: false, message: 'Dentro del presupuesto.' };
  }

  private findMatchingBudgetLine(lines: BudgetLine[], accountId: string, dimensions?: Record<string, string>): BudgetLine | undefined {
      if (!dimensions || Object.keys(dimensions).length === 0) {
          return lines.find(l => l.accountId === accountId && (!l.dimensions || Object.keys(l.dimensions).length === 0));
      }
      
      return lines.find(line => {
          if (line.accountId !== accountId || !line.dimensions) return false;
          
          const lineDimKeys = Object.keys(line.dimensions);
          const txDimKeys = Object.keys(dimensions);
          
          if (lineDimKeys.length !== txDimKeys.length) return false;
          
          return lineDimKeys.every(key => dimensions[key] === line.dimensions![key]);
      });
  }
}