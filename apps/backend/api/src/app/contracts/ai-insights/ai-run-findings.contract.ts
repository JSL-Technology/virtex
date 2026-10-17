/**
 * What a finished AI run found that someone should hear about, announced once per run.
 *
 * Emitted by the AI module after it has claimed the run (`ai_model_runs.notified_at`), so however
 * many API replicas notice the same run finishing, exactly one announces it. Listened to by the
 * notifications module, which decides who is told; neither imports the other.
 *
 * Only what is actionable is carried: products about to run out before a reorder could arrive, and
 * new anomalies serious enough to look at today. A run that found neither is never announced.
 */
export const AI_RUN_FINDINGS = 'ai.run.findings';

export interface AiRunFindingsEvent {
  organizationId: string;
  runId: string;
  kind: 'FORECAST' | 'ANOMALY' | 'CASHFLOW';
  /** FORECAST: product × warehouse rows at risk of stocking out within their lead time. */
  stockouts?: {
    count: number;
    /** The earliest projected stockout, ISO date. */
    earliestDate: string | null;
    /** Up to three product names, most urgent first. */
    products: string[];
  };
  /** ANOMALY: findings that appeared in this run, still open, at HIGH severity or above. */
  anomalies?: {
    count: number;
    critical: number;
  };
  /** CASHFLOW: the projection gives a real chance of the balance falling below the threshold. */
  cashflow?: {
    /** 0–1. */
    probability: number;
    /** The first day the shortfall becomes likely (≥ 10 % of paths), ISO date. */
    date: string | null;
    lowestExpected: number;
    currency: string | null;
  };
}
