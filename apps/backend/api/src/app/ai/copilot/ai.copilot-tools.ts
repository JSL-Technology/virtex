import { Injectable, OnModuleInit } from '@nestjs/common';
import { CopilotToolRegistry, opt, s } from '../../contracts/copilot/copilot-tools.contract';
import { AI_PERMISSIONS } from '../../shared/ai.permissions';
import { ForecastingService } from '../forecasting/forecasting.service';
import { AnomaliesService } from '../anomalies/anomalies.service';

/** The AI module's own findings, as copilot tools: forecasts, stock risks, anomalies, lead times. */
@Injectable()
export class AiCopilotTools implements OnModuleInit {
  constructor(
    private readonly registry: CopilotToolRegistry,
    private readonly forecasting: ForecastingService,
    private readonly anomalies: AnomaliesService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      {
        kind: 'read',
        name: 'inventory_forecast',
        description:
          'Demand forecast and stock position per product and warehouse from the nightly AI run: on hand, ' +
          'average daily demand, units forecast for the next 30 days (P50 and P90), days of cover, projected ' +
          'stockout date, lead time, reorder point and suggested order quantity, with a status (STOCKOUT_RISK, ' +
          'REORDER, OVERSTOCK, DEAD_STOCK, OK). Use for "what will run out", "what should I buy", "best sellers next month".',
        permissions: [AI_PERMISSIONS.AI_FORECASTS_VIEW],
        feature: 'ai_forecasting',
        inputSchema: s.object({
          status: s.nullable(s.enum(['STOCKOUT_RISK', 'REORDER', 'OVERSTOCK', 'DEAD_STOCK', 'OK'])),
          search: s.nullable(s.string('Product name or SKU fragment')),
          sort: s.enum(['risk', 'top_sellers'], 'risk = most urgent first; top_sellers = highest 30-day forecast first'),
          limit: s.integer('1-50'),
        }),
        run: async (ctx, input) =>
          this.forecasting.insights(ctx.organizationId, {
            status: opt(input, 'status'),
            search: opt(input, 'search'),
            sort: (opt<string>(input, 'sort') as 'risk' | 'top_sellers') ?? 'risk',
            limit: Math.min(Math.max(Number(opt(input, 'limit') ?? 20), 1), 50),
          }),
      },
      {
        kind: 'read',
        name: 'forecast_summary',
        description: 'How many products are in each stock status, and when the last forecast ran and how accurate it was (median WAPE).',
        permissions: [AI_PERMISSIONS.AI_FORECASTS_VIEW],
        feature: 'ai_forecasting',
        inputSchema: s.object({}),
        run: async (ctx) => this.forecasting.summary(ctx.organizationId),
      },
      {
        kind: 'read',
        name: 'top_sellers_by_branch',
        description: 'The products projected to sell the most units in the next 30 days, per branch.',
        permissions: [AI_PERMISSIONS.AI_FORECASTS_VIEW],
        feature: 'ai_forecasting',
        inputSchema: s.object({ per_branch: s.integer('1-20') }),
        run: async (ctx, input) =>
          this.forecasting.topByBranch(ctx.organizationId, Math.min(Math.max(Number(input['per_branch'] ?? 5), 1), 20)),
      },
      {
        kind: 'read',
        name: 'supplier_lead_times',
        description: "Each supplier's measured delivery time over the last year: median and P90 days from order to receipt, and the share delivered by the promised date.",
        permissions: [AI_PERMISSIONS.AI_FORECASTS_VIEW],
        feature: 'ai_forecasting',
        inputSchema: s.object({}),
        run: async (ctx) => (await this.forecasting.supplierLeadTimes(ctx.organizationId)).slice(0, 50),
      },
      {
        kind: 'read',
        name: 'anomalies',
        description:
          'Unusual transactions the AI flagged (duplicate bills or receipts, sales below cost, overpayments, purchase ' +
          'order/receipt/bill mismatches, unusual prices or discounts, edited issued documents, off-hours activity…), ' +
          'with severity, evidence and status.',
        permissions: [AI_PERMISSIONS.AI_ANOMALIES_VIEW],
        feature: 'ai_anomalies',
        inputSchema: s.object({
          status: s.nullable(s.enum(['OPEN', 'CONFIRMED', 'DISMISSED'])),
          severity: s.nullable(s.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])),
          category: s.nullable(s.enum(['sales', 'purchases', 'inventory', 'cash', 'security'])),
          limit: s.integer('1-30'),
        }),
        run: async (ctx, input) =>
          this.anomalies.list(ctx.organizationId, {
            status: opt(input, 'status'),
            severity: opt(input, 'severity'),
            category: opt(input, 'category'),
            limit: Math.min(Math.max(Number(opt(input, 'limit') ?? 15), 1), 30),
          }),
      },
    );
  }
}
