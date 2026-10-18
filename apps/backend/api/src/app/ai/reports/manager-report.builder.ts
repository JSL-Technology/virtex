import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CopilotToolContext, CopilotToolRegistry } from '../../contracts/copilot/copilot-tools.contract';
import { EntitlementsPort } from '../../saas/contracts/entitlements.contract';
import { AiReport } from '../entities/ai-report.entity';
import { ReportBrief, ReportBuilder, ReportsService } from './reports.service';

/** A fact larger than this is left out rather than truncated into something misleading. */
const MAX_FACT_CHARS = 14_000;

/** `2026-09` → its first and last day, and the month before it. */
export function monthBounds(period: string): { start: string; end: string; previous: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) throw new Error(`Invalid report period "${period}"`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  const prev = month === 1 ? `${year - 1}-12` : `${year}-${pad(month - 1)}`;
  return { start: `${period}-01`, end: `${period}-${pad(last)}`, previous: prev };
}

/** The month a report run today is about: the one that just ended. */
export function previousMonth(today: Date = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

interface FactSource {
  key: string;
  tool: string;
  input: (bounds: ReturnType<typeof monthBounds>) => Record<string, unknown>;
}

/**
 * The facts of the manager's monthly report, gathered with the same read tools the copilot uses —
 * each owned by its domain (the income statement by financial reporting, ageing by receivables and
 * payables, the projection by the AI engine) — so the report and the screens cannot disagree, and
 * this module never imports those domains.
 *
 * Asked for by a person, the tools run as that person (their branches, their name on the access
 * audit of the financial statements); the one the scheduler writes on the 1st runs as no one, so it
 * covers the whole company. Reading either is gated by `ai_reports:view`, the manager's permission. A tool whose plan feature is off, or
 * that fails, is listed as unavailable so the writer says what it could not see rather than
 * guessing.
 */
@Injectable()
export class ManagerReportBuilder implements ReportBuilder, OnModuleInit {
  readonly kind = 'MANAGER_MONTHLY' as const;
  private readonly logger = new Logger(ManagerReportBuilder.name);

  static readonly SOURCES: FactSource[] = [
    { key: 'incomeStatement', tool: 'income_statement', input: (b) => ({ start_date: b.start, end_date: b.end }) },
    {
      key: 'incomeStatementPreviousMonth',
      tool: 'income_statement',
      input: (b) => {
        const prev = monthBounds(b.previous);
        return { start_date: prev.start, end_date: prev.end };
      },
    },
    { key: 'balanceSheet', tool: 'balance_sheet', input: (b) => ({ as_of: b.end }) },
    { key: 'salesTrend', tool: 'sales_trend', input: () => ({ months: 6 }) },
    { key: 'cashPosition', tool: 'cash_position', input: () => ({ as_of: null }) },
    { key: 'receivables', tool: 'receivables_aging', input: () => ({ as_of: null }) },
    { key: 'payables', tool: 'payables_aging', input: () => ({ as_of: null }) },
    { key: 'cashflowProjection', tool: 'cashflow_forecast', input: () => ({}) },
    { key: 'collections', tool: 'collections_worklist', input: () => ({ customer_id: null, action: null, limit: 10 }) },
    { key: 'openAnomalies', tool: 'anomalies', input: () => ({ status: 'OPEN', severity: null, category: null, limit: 10 }) },
    { key: 'demandForecast', tool: 'forecast_summary', input: () => ({}) },
  ];

  constructor(
    private readonly reports: ReportsService,
    private readonly tools: CopilotToolRegistry,
    private readonly entitlements: EntitlementsPort,
  ) {}

  onModuleInit(): void {
    this.reports.register(this);
  }

  async build(organizationId: string, report: AiReport): Promise<ReportBrief> {
    const period = report.period ?? previousMonth();
    const bounds = monthBounds(period);
    const ctx: CopilotToolContext = {
      organizationId,
      // The requester's scope when a person asked; none (the whole company) for the scheduled one.
      user: { id: report.requestedByUserId ?? '', organizationId, permissions: [], language: report.language },
    };

    const facts: Record<string, unknown> = { period, periodStart: bounds.start, periodEnd: bounds.end, previousPeriod: bounds.previous };
    const unavailable: string[] = [];
    const features = new Map<string, boolean>();
    for (const source of ManagerReportBuilder.SOURCES) {
      const tool = this.tools.get(source.tool);
      if (!tool || tool.kind !== 'read') {
        unavailable.push(source.key);
        continue;
      }
      if (tool.feature) {
        if (!features.has(tool.feature)) features.set(tool.feature, await this.entitlements.checkFeature(organizationId, tool.feature));
        if (!features.get(tool.feature)) {
          unavailable.push(source.key);
          continue;
        }
      }
      try {
        const value = await tool.run(ctx, source.input(bounds));
        if (JSON.stringify(value ?? null).length > MAX_FACT_CHARS) {
          unavailable.push(source.key);
          continue;
        }
        facts[source.key] = value;
      } catch (error) {
        this.logger.warn(`Informe ${report.id}: ${source.tool} no disponible (${(error as Error).message})`);
        unavailable.push(source.key);
      }
    }
    if (!facts['incomeStatement'] && !facts['salesTrend']) {
      throw new Error('Neither the income statement nor the sales trend could be read for this month.');
    }
    facts['unavailable'] = unavailable;

    return {
      instructions:
        `Write the monthly report for ${period} for the company's owner or manager. Cover, in this order and only where ` +
        'the facts allow: how the month went (sales, gross margin and result, compared with the previous month as the ' +
        'facts state both); where cash stands and where it is heading; who owes the company and whom it owes, and the ' +
        'collections that matter most; inventory and demand worth acting on; anomalies that need a look. End with the ' +
        'concrete actions for the coming month, most important first. If something listed under "unavailable" would ' +
        'have mattered, say briefly that it was not available rather than guessing.',
      facts,
    };
  }
}
