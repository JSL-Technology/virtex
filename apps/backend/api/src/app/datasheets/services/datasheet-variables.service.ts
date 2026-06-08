
import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Sum } from 'typeorm';
import { VARIABLE_REGISTRY, ERPVariable } from './variable-registry';
import { User } from '../../users/entities/user.entity/user.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { Product } from '../../inventory/entities/product.entity';
import { JournalEntryLine } from '../../journal-entries/entities/journal-entry-line.entity';
import { OrganizationsService } from '../../organizations/organizations.service';
import { DashboardService } from '../../dashboard/dashboard.service';

@Injectable()
export class DatasheetVariablesService {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private organizationsService: OrganizationsService,
    private dashboardService: DashboardService,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(Product) private productRepo: Repository<Product>,
    @InjectRepository(JournalEntryLine) private journalRepo: Repository<JournalEntryLine>,
  ) {}

  getRegistry() {
    return VARIABLE_REGISTRY;
  }

  private async getSalesSum(orgId: string, startDate?: Date, endDate?: Date): Promise<number> {
    const query = this.invoiceRepo.createQueryBuilder('invoice')
      .where('invoice.organizationId = :orgId', { orgId })
      .andWhere('invoice.status = :status', { status: 'paid' }); // Simplified

    if (startDate && endDate) {
      query.andWhere('invoice.createdAt BETWEEN :start AND :end', { start: startDate, end: endDate });
    }

    const result = await query.select('SUM(invoice.total)', 'sum').getRawOne();
    return parseFloat(result.sum || 0);
  }

  async resolveVariable(name: string, params: any[], user: User, bookId?: string): Promise<any> {
    // Check if book is in snapshot mode
    if (bookId) {
      const book = await this.invoiceRepo.manager.getRepository('DatasheetBook').findOne({ where: { id: bookId } }) as any;
      if (book?.mode === 'snapshot') {
        // In a real implementation, we'd look up the value in the last saved state of the sheet
        // This is a simplified logic for the spec
      }
    }

    // Handle IMPORTAR functions
    if (name.startsWith('IMPORTAR_')) {
      const parts = name.split('_');
      if (parts.length >= 3) {
        const module = parts[1].toLowerCase();
        const set = parts[2].toLowerCase();
        // Here we'd call the ImportService, but for brevity we use a simplified version
        // In a real impl, we'd inject DatasheetImportService (circular dep warning: use forwardRef)
        return [['Encabezado 1', 'Encabezado 2'], ['Dato 1', 'Dato 2']];
      }
    }

    const variable = VARIABLE_REGISTRY.find(v => v.nameEn === name || v.nameEs === name);
    if (!variable) return '#VARIABLE_NO_EXISTE';

    const cacheKey = `var:${user.organizationId}:${name}:${JSON.stringify(params)}`;
    const cachedValue = await this.cacheManager.get(cacheKey);
    if (cachedValue !== undefined) return cachedValue;

    let value: any = 0;
    const now = new Date();
    const orgId = user.organizationId;

    try {
      switch (variable.nameEn) {
        case 'TOTAL_SALES':
          value = await this.getSalesSum(orgId);
          break;
        case 'MONTH_SALES':
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          value = await this.getSalesSum(orgId, startOfMonth, now);
          break;
        case 'TODAY_SALES':
          const startOfDay = new Date(now.setHours(0,0,0,0));
          value = await this.getSalesSum(orgId, startOfDay, new Date());
          break;
        case 'INVENTORY_VALUE':
          const invResult = await this.productRepo.createQueryBuilder('product')
            .where('product.organizationId = :orgId', { orgId })
            .select('SUM(product.stock * product.cost)', 'total')
            .getRawOne();
          value = parseFloat(invResult.total || 0);
          break;
        case 'PRODUCT_COST':
          const product = await this.productRepo.findOne({ where: { reference: params[0], organizationId: orgId } });
          value = product ? product.cost : '#REF_NO_VALIDA';
          break;
        case 'EBITDA':
          const ebitdaData = await this.dashboardService.getEBITDA(orgId);
          value = ebitdaData.ebitda;
          break;
        case 'GROSS_MARGIN':
          const marginData = await this.dashboardService.getNetMargin(orgId);
          value = marginData.netMargin;
          break;
        case 'CURRENT_CASH_FLOW':
          const waterfall = await this.dashboardService.getConsolidatedCashFlowWaterfall(orgId);
          value = waterfall.endingBalance;
          break;
        case 'GOAL_FULFILLMENT':
          const sales = await this.getSalesSum(orgId, new Date(now.getFullYear(), now.getMonth(), 1), now);
          const goal = 1000000; // Mock goal from settings
          value = (sales / goal) * 100;
          break;
        case 'COMPANY_NAME':
          const org = await this.organizationsService.findOne(orgId);
          value = org.legalName;
          break;
        case 'TODAY_DATE':
          value = new Date().toISOString().split('T')[0];
          break;
        default:
          value = 0;
      }
    } catch (e) {
      value = '#ERROR';
    }

    await this.cacheManager.set(cacheKey, value, 300000);
    return value;
  }

  async resolveBatch(variables: { name: string, params: any[] }[], user: User) {
    const results: Record<string, any> = {};
    await Promise.all(
      variables.map(async (v) => {
        const key = `${v.name}${v.params.length ? '(' + v.params.join(',') + ')' : ''}`;
        results[key] = await this.resolveVariable(v.name, v.params, user);
      })
    );
    return results;
  }
}
