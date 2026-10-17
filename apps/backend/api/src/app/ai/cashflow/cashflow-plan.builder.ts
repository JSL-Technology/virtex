import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { EngineRunsService } from '../engine/engine-runs.service';
import { AiCashflowItem } from '../entities/ai-cashflow-item.entity';
import { AiReport } from '../entities/ai-report.entity';
import { ReportBrief, ReportBuilder, ReportsService } from '../reports/reports.service';

const money = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;
const percent = (value: unknown) => Math.round(Number(value ?? 0) * 100);

/**
 * The cash plan: the projection's figures, and the documents that move them, for the model to turn
 * into what to do this month. Percentages are given as whole percents, already computed, because
 * the writer may not compute one itself.
 */
@Injectable()
export class CashflowPlanBuilder implements ReportBuilder, OnModuleInit {
  readonly kind = 'CASHFLOW_PLAN' as const;

  constructor(
    private readonly reports: ReportsService,
    private readonly runs: EngineRunsService,
    @InjectRepository(AiCashflowItem) private readonly items: Repository<AiCashflowItem>,
  ) {}

  onModuleInit(): void {
    this.reports.register(this);
  }

  async build(organizationId: string, _report: AiReport): Promise<ReportBrief> {
    const run = await this.runs.latestSucceeded(organizationId, 'CASHFLOW');
    if (!run) throw new Error('There is no cash-flow projection to write a plan from.');
    const m = (run.metrics ?? {}) as Record<string, unknown>;
    const atRisk = await this.items.find({
      where: { organizationId, runId: run.id, kind: 'RECEIVABLE', pBy30: LessThan(0.5) },
      order: { amount: 'DESC' },
      take: 8,
    });
    const upcoming = await this.items.find({
      where: { organizationId, runId: run.id, kind: 'PAYABLE' },
      order: { dueDate: 'ASC' },
      take: 8,
    });
    const byComponent = (m['byComponent'] ?? {}) as Record<string, number>;
    return {
      sourceRunId: run.id,
      instructions:
        'Write the cash plan for the next weeks: where the balance is heading, the moment it is tightest and how ' +
        'likely a shortfall is, which collections and payments decide it, and what to do about it (chase specific ' +
        'customers, time specific payments, arrange financing) — most urgent first.',
      facts: {
        asOfDate: run.params?.['asOfDate'] ?? null,
        currency: run.params?.['baseCurrency'] ?? null,
        horizonDays: m['horizonDays'] ?? null,
        cashToday: money(m['openingCash']),
        minimumBalanceAllowed: money(m['threshold']),
        expectedBalanceAtEnd: money(m['endP50']),
        pessimisticBalanceAtEnd: money(m['endP10']),
        tightestExpectedBalance: money(m['lowestP50']),
        tightestDate: m['lowestP50Date'] ?? null,
        worstPlausibleBalance: money(m['lowestP10']),
        shortfallChancePercent: percent(m['shortfallProbability']),
        firstDateShortfallBecomesLikely: m['firstLikelyShortfallDate'] ?? null,
        expectedMoneyIn: money(m['expectedInflow']),
        expectedMoneyOut: money(m['expectedOutflow']),
        expectedFromOpenInvoices: money(byComponent['receivables']),
        expectedFromSalesNotYetInvoiced: money(byComponent['new_sales']),
        expectedToOpenBills: money(-Number(byComponent['payables'] ?? 0)),
        expectedToSpendingNotYetBilled: money(-Number(byComponent['new_spending'] ?? 0)),
        expectedPayroll: money(-Number(byComponent['payroll'] ?? 0)),
        receivablesUnlikelyWithinAMonth: atRisk.map((item) => ({
          customer: item.partyName,
          invoice: item.number,
          amount: money(item.amount),
          dueDate: item.dueDate,
          chanceCollectedWithin30DaysPercent: percent(item.pBy30),
          doubtful: item.doubtful,
        })),
        nextBillsToPay: upcoming.map((item) => ({
          supplier: item.partyName,
          bill: item.number,
          amount: money(item.amount),
          dueDate: item.dueDate,
        })),
      },
    };
  }
}
