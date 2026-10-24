import { Injectable, OnModuleInit } from '@nestjs/common';
import { CopilotToolRegistry, s } from '../contracts/copilot/copilot-tools.contract';
import { PERMISSIONS } from '../shared/permissions';
import { DashboardChartsService } from './dashboard-charts.service';

@Injectable()
export class DashboardCopilotTools implements OnModuleInit {
  constructor(
    private readonly registry: CopilotToolRegistry,
    private readonly charts: DashboardChartsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      {
        kind: 'read',
        name: 'business_summary',
        branchScope: 'none',
        description: 'Headline indicators shown on the home screen: sales, receivables, payables and cash, this month against the last.',
        permissions: [PERMISSIONS.DASHBOARD_VIEW],
        inputSchema: s.object({}),
        run: async (ctx) => this.charts.summary(ctx.organizationId),
      },
      {
        kind: 'read',
        name: 'sales_trend',
        branchScope: 'none',
        description: 'Monthly sales totals for the last N months.',
        permissions: [PERMISSIONS.DASHBOARD_VIEW],
        inputSchema: s.object({ months: s.integer('1-24') }),
        run: async (ctx, input) => this.charts.salesTrend(ctx.organizationId, Math.min(Math.max(Number(input['months'] ?? 12), 1), 24)),
      },
    );
  }
}
