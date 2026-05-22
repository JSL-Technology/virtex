
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Budget } from './entities/budget.entity';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { BudgetLine } from './entities/budget-line.entity';

@Injectable()
export class BudgetsService {
  constructor(
    @InjectRepository(Budget)
    private budgetRepository: Repository<Budget>,
    @InjectRepository(JournalEntryLine)
    private journalEntryLineRepository: Repository<JournalEntryLine>,
  ) {}

  create(createBudgetDto: CreateBudgetDto, organizationId: string): Promise<Budget> {
    const { lines, ...budgetData } = createBudgetDto;
    const budgetLines = lines.map(lineDto => {
        const line = new BudgetLine();

        line.accountId = lineDto.accountId;
        line.amount = lineDto.amount;
        line.dimensions = lineDto.dimensions; 
        return line;
    });

    const newBudget = this.budgetRepository.create({ 
        ...budgetData, 
        organizationId,
        lines: budgetLines 
    });
    return this.budgetRepository.save(newBudget);
  }

  findAll(organizationId: string): Promise<Budget[]> {
    return this.budgetRepository.find({ where: { organizationId } });
  }

  async findOne(id: string, organizationId: string): Promise<Budget> {
    const budget = await this.budgetRepository.findOne({ 
        where: { id, organizationId },
        relations: ['lines']
    });
    if (!budget) {
      throw new NotFoundException(`Presupuesto con ID "${id}" no encontrado.`);
    }
    return budget;
  }

  async update(id: string, updateBudgetDto: UpdateBudgetDto, organizationId: string): Promise<Budget> {
      const budget = await this.findOne(id, organizationId);
      const { lines, ...budgetData } = updateBudgetDto;
      
      Object.assign(budget, budgetData);

      if (lines) {
          budget.lines = lines.map(lineDto => {
              const line = new BudgetLine();

              line.accountId = lineDto.accountId;
              line.amount = lineDto.amount;
              line.dimensions = lineDto.dimensions;
              return line;
          });
      }
      
      return this.budgetRepository.save(budget);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const result = await this.budgetRepository.delete({ id, organizationId });
    if (result.affected === 0) {
        throw new NotFoundException(`Presupuesto con ID "${id}" no encontrado.`);
    }
  }

  async getBudgetVsActualReport(budgetId: string, organizationId: string, startDate: Date, endDate: Date) {
      const budget = await this.findOne(budgetId, organizationId);
      const accountIds = [...new Set(budget.lines.map(line => line.accountId))];

      if (accountIds.length === 0) {
          return { budget, lines: [] };
      }

      const actualsQuery = this.journalEntryLineRepository.createQueryBuilder('line')
          .leftJoin('line.journalEntry', 'entry')
          .where('entry.organizationId = :organizationId', { organizationId })
          .andWhere('entry.date BETWEEN :startDate AND :endDate', { startDate, endDate })
          .andWhere('line.accountId IN (:...accountIds)', { accountIds })
          .select([
              'line.accountId AS "accountId"',
              'line.dimensions AS "dimensions"',
              'SUM(line.debit) - SUM(line.credit) AS "actualAmount"'
          ])
          .groupBy('line.accountId, line.dimensions');
      
      const actuals = await actualsQuery.getRawMany();
      
      const actualsMap = new Map<string, number>();
      for (const a of actuals) {
          const key = `${a.accountId}-${JSON.stringify(a.dimensions || {})}`;
          actualsMap.set(key, parseFloat(a.actualAmount));
      }

      const reportLines = budget.lines.map(line => {
          const key = `${line.accountId}-${JSON.stringify(line.dimensions || {})}`;
          const actual = actualsMap.get(key) || 0;
          return { ...line, actualAmount: actual, difference: line.amount - actual };
      });

      return { budget, lines: reportLines };
  }
}