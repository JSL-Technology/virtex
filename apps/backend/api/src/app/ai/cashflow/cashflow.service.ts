import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CashPositionRegistry } from '../../contracts/treasury/cash-position.contract';
import { BadRequestError, NotFoundError, ServiceUnavailableError } from '../../i18n/localized.exception';
import { EngineRunsService } from '../engine/engine-runs.service';
import { AiModelRun, AiModelRunTrigger } from '../entities/ai-model-run.entity';
import { AiCashflowForecast } from '../entities/ai-cashflow-forecast.entity';
import { AiCashflowItem, AiCashflowItemKind } from '../entities/ai-cashflow-item.entity';

/** A what-if, as the screen and the copilot express it. Everything optional; all of it bounded. */
export interface CashflowScenarioInput {
  /** New sales up or down, as a fraction: -0.2 is 20 % lower. */
  salesChange?: number;
  /** Days added to (or taken from) how late customers pay. */
  collectionDelayDays?: number;
  /** A new monthly expense, from the first of each month. */
  extraMonthlyExpense?: number;
  /** One payment out (or, negative, in). */
  oneOffAmount?: number;
  /** When, in days from today. */
  oneOffDay?: number;
}

export interface CashflowRunSummary {
  id: string;
  kind: string;
  status: string;
  createdAt: Date;
  finishedAt: Date | null;
  error: string | null;
}

/**
 * The projected cash flow: asking the engine for it, and reading what it wrote.
 *
 * The engine does the simulation (`apps/ai-engine/.../cashflow`); this service gives it the one
 * figure it cannot compute itself — today's cash, from the ledger, through treasury's registered
 * source — and reads the band, the headline figures and the per-document timing back. A scenario
 * is the same simulation with its inputs changed, written beside the projection, never over it.
 */
@Injectable()
export class CashflowService {
  constructor(
    private readonly runs: EngineRunsService,
    private readonly cash: CashPositionRegistry,
    @InjectRepository(AiModelRun) private readonly runRows: Repository<AiModelRun>,
    @InjectRepository(AiCashflowForecast) private readonly days: Repository<AiCashflowForecast>,
    @InjectRepository(AiCashflowItem) private readonly items: Repository<AiCashflowItem>,
  ) {}

  /** Queue a fresh projection from today's cash. */
  async refresh(organizationId: string, userId: string | null, trigger: AiModelRunTrigger = 'MANUAL', threshold = 0) {
    return summarise(await this.runs.request(organizationId, 'CASHFLOW', trigger, userId, await this.opening(organizationId, threshold)));
  }

  /** Queue a what-if. The scenario is validated here and bounded again in the engine. */
  async scenario(organizationId: string, userId: string, input: CashflowScenarioInput, threshold = 0) {
    const scenario = boundScenario(input);
    if (!Object.values(scenario).some((value) => value !== 0)) {
      throw new BadRequestError('ai.cashflow.scenario_empty');
    }
    return summarise(
      await this.runs.request(organizationId, 'SCENARIO', 'MANUAL', userId, {
        ...(await this.opening(organizationId, threshold)),
        scenario,
      }),
    );
  }

  /** The current projection: its band, headline figures, and the state of the latest run. */
  async overview(organizationId: string, reader: CashflowReader) {
    const [latest, succeeded] = await Promise.all([
      this.runs.latest(organizationId, 'CASHFLOW'),
      this.runs.latestSucceeded(organizationId, 'CASHFLOW'),
    ]);
    if (!succeeded) return { latest: latest && summarise(latest), projection: null };
    return { latest: latest && summarise(latest), projection: await this.projection(organizationId, succeeded, reader) };
  }

  /** A scenario run and, for comparison, the projection it changes. */
  async scenarioResult(organizationId: string, runId: string, reader: CashflowReader) {
    const run = await this.runRows.findOne({ where: { id: runId, organizationId, kind: 'SCENARIO' } });
    if (!run) throw new NotFoundError('ai.cashflow.scenario_not_found');
    const baseline = await this.runs.latestSucceeded(organizationId, 'CASHFLOW');
    return {
      run: summarise(run),
      scenario: run.status === 'SUCCEEDED' ? await this.projection(organizationId, run, reader) : null,
      baseline: baseline ? await this.projection(organizationId, baseline, reader) : null,
    };
  }

  /** Recent scenarios, newest first. */
  async scenarios(organizationId: string) {
    const rows = await this.runRows.find({
      where: { organizationId, kind: 'SCENARIO' },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    return rows.map((run) => ({ ...summarise(run), scenario: run.params?.['scenario'] ?? null, metrics: run.metrics ?? null }));
  }

  /** Open documents of the current projection, by when their money is likely to move. */
  async documents(
    organizationId: string,
    query: { kind: AiCashflowItemKind; sort?: 'amount' | 'risk' | 'expected'; limit?: number; offset?: number },
  ) {
    const run = await this.runs.latestSucceeded(organizationId, 'CASHFLOW');
    if (!run) return { total: 0, items: [] };
    const order: Record<string, Record<string, 'ASC' | 'DESC'>> = {
      amount: { amount: 'DESC' },
      // Least likely to arrive within a month first, the larger first among equals.
      risk: { pBy30: 'ASC', amount: 'DESC' },
      expected: { expectedDate: 'ASC', amount: 'DESC' },
    };
    const [items, total] = await this.items.findAndCount({
      where: { organizationId, runId: run.id, kind: query.kind },
      order: order[query.sort ?? 'amount'],
      take: Math.min(Math.max(query.limit ?? 50, 1), 200),
      skip: Math.max(query.offset ?? 0, 0),
    });
    return { total, items };
  }

  private async projection(organizationId: string, run: AiModelRun, reader: CashflowReader) {
    const days = await this.days.find({ where: { organizationId, runId: run.id }, order: { day: 'ASC' } });
    const projection = {
      runId: run.id,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      baseCurrency: (run.params?.['baseCurrency'] as string) ?? null,
      asOfDate: (run.params?.['asOfDate'] as string) ?? null,
      metrics: run.metrics ?? {},
      days: days.map((day) => ({
        day: day.day,
        p10: day.p10,
        p50: day.p50,
        p90: day.p90,
        inflow: day.inflow,
        outflow: day.outflow,
        components: day.components,
      })),
    };
    return reader.seesPayroll ? projection : withoutPayroll(projection);
  }

  private async opening(organizationId: string, threshold: number) {
    if (!this.cash.available()) throw new ServiceUnavailableError('ai.cashflow.cash_position_unavailable');
    const position = await this.cash.summary(organizationId);
    return {
      openingCash: position.total,
      baseCurrency: position.baseCurrency,
      asOfDate: position.asOfDate,
      threshold: Number.isFinite(threshold) ? threshold : 0,
    };
  }
}

/** Who reads a projection: whether payroll may be shown on its own line. */
export interface CashflowReader {
  seesPayroll: boolean;
}

/**
 * Payroll folded into the other spending. The total payroll of a small company is close to the pay
 * of each person in it, so a reader without `payroll:view` sees the same balance and the same money
 * out, without the line that says how much of it is wages.
 */
export function withoutPayroll<T extends { metrics: Record<string, unknown>; days: Array<{ components: unknown }> }>(projection: T): T {
  const fold = (components: unknown): unknown => {
    if (!components || typeof components !== 'object' || !('payroll' in components)) return components;
    const { payroll, ...rest } = components as Record<string, number>;
    return { ...rest, new_spending: round2(Number(rest['new_spending'] ?? 0) + Number(payroll ?? 0)) };
  };
  return {
    ...projection,
    metrics: { ...projection.metrics, byComponent: fold(projection.metrics['byComponent']) },
    days: projection.days.map((day) => ({ ...day, components: fold(day.components) })),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function boundScenario(input: CashflowScenarioInput): Required<CashflowScenarioInput> {
  const num = (value: unknown, min: number, max: number) => {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : 0;
  };
  return {
    salesChange: num(input.salesChange, -1, 5),
    collectionDelayDays: Math.round(num(input.collectionDelayDays, -60, 180)),
    extraMonthlyExpense: num(input.extraMonthlyExpense, 0, 1e12),
    oneOffAmount: num(input.oneOffAmount, -1e12, 1e12),
    oneOffDay: Math.round(num(input.oneOffDay, 0, 365)),
  };
}

function summarise(run: AiModelRun): CashflowRunSummary {
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
    error: run.error,
  };
}
