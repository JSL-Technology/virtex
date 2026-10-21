import { Injectable, OnModuleInit } from '@nestjs/common';
import { CopilotToolRegistry, opt, s } from '../../contracts/copilot/copilot-tools.contract';
import { AI_PERMISSIONS } from '../../shared/ai.permissions';
import { ForecastingService } from '../forecasting/forecasting.service';
import { AnomaliesService } from '../anomalies/anomalies.service';
import { HelpService } from '../help/help.service';
import { CashflowService } from '../cashflow/cashflow.service';
import { DataSource } from 'typeorm';
import { organizationFiscalIdentity } from '../../organizations/contracts/fiscal-identity.contract';

/** The AI module's own findings, as copilot tools: forecasts, stock risks, anomalies, lead times. */
@Injectable()
export class AiCopilotTools implements OnModuleInit {
  constructor(
    private readonly registry: CopilotToolRegistry,
    private readonly forecasting: ForecastingService,
    private readonly anomalies: AnomaliesService,
    private readonly help: HelpService,
    private readonly cashflow: CashflowService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      {
        kind: 'read',
        name: 'cashflow_forecast',
        branchScope: 'unscoped',
        externalText: true,
        description:
          'The projected cash balance for the next weeks from the nightly simulation: cash today, the expected balance ' +
          'at the end and at its tightest (with the date), the worst plausible balance (P10), the probability of falling ' +
          'below the threshold, expected money in and out by component, and the documents that drive the low point. ' +
          'Also weekly points of the band. Use for "will I have enough cash", "cash flow", "when will I be short".',
        permissions: [AI_PERMISSIONS.AI_CASHFLOW_VIEW],
        feature: 'ai_cashflow',
        inputSchema: s.object({}),
        run: async (ctx) => {
          const { latest, projection } = await this.cashflow.overview(ctx.organizationId);
          if (!projection) return { available: false, latestRun: latest };
          return {
            available: true,
            asOfDate: projection.asOfDate,
            currency: projection.baseCurrency,
            metrics: projection.metrics,
            weekly: projection.days.filter((_, index) => index % 7 === 0 || index === projection.days.length - 1),
          };
        },
      },
      {
        kind: 'read',
        name: 'expected_collections',
        branchScope: 'unscoped',
        externalText: true,
        description:
          'Open customer invoices (or supplier bills) of the cash-flow projection with the chance each is collected ' +
          '(paid) within 7 and 30 days and its likely date. sort=risk lists the least likely to arrive first — the ' +
          'collection priorities.',
        permissions: [AI_PERMISSIONS.AI_CASHFLOW_VIEW],
        feature: 'ai_cashflow',
        inputSchema: s.object({
          kind: s.enum(['RECEIVABLE', 'PAYABLE']),
          sort: s.enum(['risk', 'amount', 'expected']),
          limit: s.integer('1-50'),
        }),
        run: async (ctx, input) =>
          this.cashflow.documents(ctx.organizationId, {
            kind: input['kind'] === 'PAYABLE' ? 'PAYABLE' : 'RECEIVABLE',
            sort: (['risk', 'amount', 'expected'] as const).find((value) => value === input['sort']) ?? 'risk',
            limit: Math.min(Math.max(Number(input['limit'] ?? 20), 1), 50),
          }),
      },
      {
        kind: 'read',
        name: 'search_help',
        branchScope: 'none',
        description:
          "Search the product's in-app help articles for how to do something in the ERP or what a screen or rule " +
          "means (e.g. registering a supplier bill from a photo, the company's fiscal document rules, the assistant, " +
          "credits). Search with keywords in the person's language; only articles for the company's market are " +
          'returned. Each passage says its language: if it is not the person\'s, translate what you use. Answer from ' +
          'the passages returned and name the article; if nothing relevant comes back, say the help does not cover ' +
          'it rather than guessing.',
        permissions: [AI_PERMISSIONS.AI_COPILOT_USE],
        inputSchema: s.object({ query: s.string('Keywords in the person\'s language, e.g. "supplier bill photo"') }),
        run: async (ctx, input) => {
          const identity = await organizationFiscalIdentity(this.dataSource.manager, ctx.organizationId);
          return {
            results: await this.help.search(String(input['query'] ?? ''), { language: ctx.user.language, country: identity?.country }, 4),
          };
        },
      },
      {
        kind: 'read',
        name: 'inventory_forecast',
        branchScope: 'unscoped',
        externalText: true,
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
        branchScope: 'unscoped',
        description: 'How many products are in each stock status, and when the last forecast ran and how accurate it was (median WAPE).',
        permissions: [AI_PERMISSIONS.AI_FORECASTS_VIEW],
        feature: 'ai_forecasting',
        inputSchema: s.object({}),
        run: async (ctx) => this.forecasting.summary(ctx.organizationId),
      },
      {
        kind: 'read',
        name: 'top_sellers_by_branch',
        branchScope: 'unscoped',
        externalText: true,
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
        branchScope: 'unscoped',
        externalText: true,
        description: "Each supplier's measured delivery time over the last year: median and P90 days from order to receipt, and the share delivered by the promised date.",
        permissions: [AI_PERMISSIONS.AI_FORECASTS_VIEW],
        feature: 'ai_forecasting',
        inputSchema: s.object({}),
        run: async (ctx) => (await this.forecasting.supplierLeadTimes(ctx.organizationId)).slice(0, 50),
      },
      {
        kind: 'read',
        name: 'anomalies',
        branchScope: 'unscoped',
        externalText: true,
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
