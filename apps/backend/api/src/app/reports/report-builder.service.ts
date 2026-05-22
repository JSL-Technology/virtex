
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ReportDefinitionDto,
  ReportRowDefinition,
  ReportRowType,
  ReportColumnDefinition,
} from './dto/report-builder.dto';
import { FinancialReportingService } from '../financial-reporting/financial-reporting.service';
import { Account } from '../chart-of-accounts/entities/account.entity';


interface ReportCell {
  value: number | null;
  displayValue: string;
}

interface ReportRowResult {
  rowDefinition: ReportRowDefinition;
  cells: { [columnId: string]: ReportCell };
}

@Injectable()
export class ReportBuilderService {
  private readonly logger = new Logger(ReportBuilderService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly financialReportingService: FinancialReportingService,
  ) {}

  async generateCustomReport(
    definition: ReportDefinitionDto,
    organizationId: string,
  ): Promise<any> {
    this.logger.log(`Iniciando generación de reporte personalizado "${definition.name}" para la organización ${organizationId}`);


    const rawDataCache = new Map<string, Map<string, number>>();
    

    const calculatedRows = new Map<string, { [columnId: string]: number | null }>();


    await this.fetchAllRequiredData(definition.columns, organizationId, rawDataCache);

    const reportResults: ReportRowResult[] = [];


    for (const rowDef of definition.rows) {
      const rowResult: ReportRowResult = {
        rowDefinition: rowDef,
        cells: {},
      };
      
      const rowValues: { [columnId: string]: number | null } = {};

      for (const colDef of definition.columns) {
        let cellValue: number | null = null;
        
        switch (rowDef.type) {
          case ReportRowType.ACCOUNT:
          case ReportRowType.GROUP:
            cellValue = this.getAccountBalance(rowDef, colDef, rawDataCache);
            break;
          
          case ReportRowType.FORMULA:
            cellValue = this.calculateFormula(rowDef, colDef, calculatedRows);
            break;
            
          case ReportRowType.HEADER:
          case ReportRowType.BLANK:
            cellValue = null;
            break;
        }

        rowResult.cells[colDef.id] = {
          value: cellValue,
          displayValue: this.formatValue(cellValue, rowDef.format),
        };
        rowValues[colDef.id] = cellValue;
      }
      
      reportResults.push(rowResult);
      calculatedRows.set(rowDef.id, rowValues);
    }
    
    this.logger.log(`Reporte "${definition.name}" generado exitosamente.`);
    return this.formatFinalReport(definition, reportResults);
  }

  private async fetchAllRequiredData(columns: ReportColumnDefinition[], organizationId: string, cache: Map<string, Map<string, number>>): Promise<void> {
    const accountRepo = this.dataSource.getRepository(Account);

    for (const colDef of columns) {
      const cacheKey = `${colDef.period.startDate}-${colDef.period.endDate}-${colDef.ledgerId}`;
      if (cache.has(cacheKey)) continue;

      const startDate = new Date(colDef.period.startDate);
      const endDate = new Date(colDef.period.endDate);


      const bs = await this.financialReportingService.getBalanceSheet(organizationId, endDate, {}, colDef.ledgerId);
      const is = await this.financialReportingService.getIncomeStatement(organizationId, startDate, endDate, {}, colDef.ledgerId);

      const balances = new Map<string, number>();


      [...bs.assets, ...bs.liabilities, ...bs.equity].forEach(acc => balances.set(acc.id, acc.balance));
      

      [...is.revenue.accounts, ...is.expenses.accounts].forEach(acc => balances.set(acc.id, acc.balance));


      const allAccounts = await accountRepo.find({ where: { organizationId }, relations: ['children'] });
      for (const account of allAccounts) {
        if (account.children && account.children.length > 0) {
          const groupBalance = account.children.reduce((sum, child) => sum + (balances.get(child.id) || 0), 0);
          balances.set(account.id, groupBalance);
        }
      }

      cache.set(cacheKey, balances);
    }
  }

  private getAccountBalance(rowDef: ReportRowDefinition, colDef: ReportColumnDefinition, cache: Map<string, Map<string, number>>): number | null {
    const cacheKey = `${colDef.period.startDate}-${colDef.period.endDate}-${colDef.ledgerId}`;
    const periodBalances = cache.get(cacheKey);

    if (!periodBalances || !rowDef.accountIds || rowDef.accountIds.length === 0) {
      return null;
    }
    

    const totalBalance = rowDef.accountIds.reduce((sum, accountId) => {
      return sum + (periodBalances.get(accountId) || 0);
    }, 0);

    return rowDef.invertSign ? -totalBalance : totalBalance;
  }

  private calculateFormula(rowDef: ReportRowDefinition, colDef: ReportColumnDefinition, calculatedRows: Map<string, { [key: string]: number | null }>): number | null {
    if (!rowDef.formula) return null;


    const expression = rowDef.formula.replace(/[a-zA-Z0-9_-]+/g, (match) => {
      const rowValue = calculatedRows.get(match)?.[colDef.id];
      return rowValue !== null && rowValue !== undefined ? `(${rowValue})` : '0';
    });

    try {




      return new Function(`return ${expression}`)();
    } catch (error) {
      this.logger.warn(`Error al evaluar la fórmula "${expression}" para la fila ${rowDef.id}`, error);
      return null;
    }
  }

  private formatValue(value: number | null, format: 'CURRENCY' | 'PERCENTAGE' | 'NUMBER' = 'NUMBER'): string {
    if (value === null || value === undefined) return '';

    switch (format) {
      case 'CURRENCY':
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
      case 'PERCENTAGE':
        return `${(value * 100).toFixed(2)}%`;
      case 'NUMBER':
      default:
        return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    }
  }

  private formatFinalReport(definition: ReportDefinitionDto, results: ReportRowResult[]): any {
    return {
      name: definition.name,
      columns: definition.columns.map(c => ({ id: c.id, header: c.header })),
      rows: results.map(r => ({
        id: r.rowDefinition.id,
        label: r.rowDefinition.label,
        type: r.rowDefinition.type,
        level: r.rowDefinition.level || 0,
        cells: definition.columns.map(c => ({
          columnId: c.id,
          value: r.cells[c.id]?.displayValue || '',
        })),
      })),
    };
  }
}