import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EngineRunsService } from '../engine/engine-runs.service';
import { AiModelRun } from '../entities/ai-model-run.entity';
import { AiReport } from '../entities/ai-report.entity';
import { ReportBrief, ReportBuilder, ReportsService } from '../reports/reports.service';

const money = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;
const percent = (value: unknown) => Math.round(Number(value ?? 0) * 100);

/** The figures of one projection the comparison talks about. */
function headline(metrics: Record<string, unknown>) {
  return {
    expectedBalanceAtEnd: money(metrics['endP50']),
    pessimisticBalanceAtEnd: money(metrics['endP10']),
    tightestExpectedBalance: money(metrics['lowestP50']),
    tightestDate: (metrics['lowestP50Date'] as string) ?? null,
    shortfallChancePercent: percent(metrics['shortfallProbability']),
    firstLikelyShortfallDate: (metrics['firstLikelyShortfallDate'] as string) ?? null,
    expectedInflow: money(metrics['expectedInflow']),
    expectedOutflow: money(metrics['expectedOutflow']),
  };
}

/**
 * «¿Qué pasa si…?», in words: what a scenario changes against the projection it was run beside.
 *
 * Both projections are the engine's — the scenario is the same simulation with its inputs changed —
 * so this only puts the two side by side, with the differences already computed (the writer may
 * not compute one), and the inputs the person changed, stated as they changed them.
 */
@Injectable()
export class ScenarioComparisonBuilder implements ReportBuilder, OnModuleInit {
  readonly kind = 'SCENARIO_COMPARISON' as const;

  constructor(
    private readonly reports: ReportsService,
    private readonly runs: EngineRunsService,
    @InjectRepository(AiModelRun) private readonly runRows: Repository<AiModelRun>,
  ) {}

  onModuleInit(): void {
    this.reports.register(this);
  }

  async build(organizationId: string, report: AiReport): Promise<ReportBrief> {
    if (!report.sourceRunId) throw new Error('A scenario comparison needs its scenario run.');
    const scenario = await this.runRows.findOne({ where: { id: report.sourceRunId, organizationId, kind: 'SCENARIO' } });
    if (!scenario || scenario.status !== 'SUCCEEDED') throw new Error('The scenario has not finished.');
    const baseline = await this.runs.latestSucceeded(organizationId, 'CASHFLOW');
    if (!baseline) throw new Error('There is no projection to compare the scenario with.');

    const withScenario = headline((scenario.metrics ?? {}) as Record<string, unknown>);
    const asProjected = headline((baseline.metrics ?? {}) as Record<string, unknown>);
    const inputs = (scenario.params?.['scenario'] ?? {}) as Record<string, number>;
    const diff = (key: keyof typeof withScenario) => money(Number(withScenario[key]) - Number(asProjected[key]));

    return {
      sourceRunId: scenario.id,
      instructions:
        'Explain in plain words what this scenario does to the company\'s cash compared with the current projection: ' +
        'the expected balance at the end, the tightest moment, and the chance of falling short — using the differences ' +
        'given. Then say what the company could do to prepare if this scenario happened. Keep it to two or three sections.',
      facts: {
        currency: scenario.params?.['baseCurrency'] ?? null,
        horizonDays: (scenario.metrics as Record<string, unknown> | null)?.['horizonDays'] ?? null,
        scenarioInputs: {
          salesChangePercent: percent(inputs['salesChange']),
          customersPayLaterByDays: Number(inputs['collectionDelayDays'] ?? 0),
          newMonthlyExpense: money(inputs['extraMonthlyExpense']),
          oneOffPayment: money(inputs['oneOffAmount']),
          oneOffPaymentInDays: Number(inputs['oneOffDay'] ?? 0),
        },
        currentProjection: asProjected,
        withScenario,
        differences: {
          expectedBalanceAtEnd: diff('expectedBalanceAtEnd'),
          pessimisticBalanceAtEnd: diff('pessimisticBalanceAtEnd'),
          tightestExpectedBalance: diff('tightestExpectedBalance'),
          shortfallChancePercentagePoints: withScenario.shortfallChancePercent - asProjected.shortfallChancePercent,
          expectedInflow: diff('expectedInflow'),
          expectedOutflow: diff('expectedOutflow'),
        },
      },
    };
  }
}
