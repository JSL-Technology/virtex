import { Injectable, OnModuleInit } from '@nestjs/common';
import { CopilotToolContext, CopilotToolRegistry, s } from '../contracts/copilot/copilot-tools.contract';
import { PERMISSIONS } from '../shared/permissions';
import { FinancialReportingService } from './financial-reporting.service';
import { AccessAuditPort } from '../contracts/audit/access-audit.contract';

/**
 * The financial statements, as copilot tools. Reading one is an audited access on the screens
 * (`@AuditAccess`); the copilot reads them through here, so it records the same access.
 */
@Injectable()
export class FinancialReportingCopilotTools implements OnModuleInit {
  constructor(
    private readonly registry: CopilotToolRegistry,
    private readonly reports: FinancialReportingService,
    private readonly audit: AccessAuditPort,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      {
        kind: 'read',
        name: 'income_statement',
        branchScope: 'none',
        description:
          'Income statement (profit and loss) for a period: revenue, cost of sales, expenses and net income, by account. ' +
          'Use for "how much did I earn", "profit this month", "expenses by type". Compare periods by calling it twice.',
        permissions: [PERMISSIONS.REPORTS_VIEW_FINANCIAL],
        inputSchema: s.object({ start_date: s.string('YYYY-MM-DD'), end_date: s.string('YYYY-MM-DD') }),
        run: async (ctx, input) => {
          const start = String(input['start_date']);
          const end = String(input['end_date']);
          this.recordAccess(ctx, 'income_statement', { startDate: start, endDate: end });
          return this.reports.getIncomeStatement(ctx.organizationId, start, end);
        },
      },
      {
        kind: 'read',
        name: 'balance_sheet',
        branchScope: 'none',
        description: 'Balance sheet at a date: assets, liabilities and equity, by account.',
        permissions: [PERMISSIONS.REPORTS_VIEW_FINANCIAL],
        inputSchema: s.object({ as_of: s.string('YYYY-MM-DD') }),
        run: async (ctx, input) => {
          const asOf = String(input['as_of']);
          this.recordAccess(ctx, 'balance_sheet', { asOfDate: asOf });
          return this.reports.getBalanceSheet(ctx.organizationId, asOf);
        },
      },
    );
  }

  private recordAccess(ctx: CopilotToolContext, entity: string, identifiers: Record<string, unknown>): void {
    this.audit.recordRead({ userId: ctx.user.id, organizationId: ctx.organizationId, entity, via: 'copilot', identifiers });
  }
}
