import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CloseReadinessRegistry } from '../../contracts/closing/close-readiness.contract';
import type { ClosingBlocker } from '../../contracts/closing-blockers/closing-blocker.contract';
import { I18nService } from '../../i18n/i18n.service';
import { preferenceLanguage } from '../../i18n/request-locale';
import { PERMISSIONS } from '../../shared/permissions';
import { ServiceUnavailableError } from '../../i18n/localized.exception';
import { MemberAccess } from '../../roles/contracts/member-access.contract';
import { AiReport } from '../entities/ai-report.entity';
import { ReportBrief, ReportBuilder, ReportsService } from '../reports/reports.service';

/** One thing to do before closing, as the assistant lists it. */
export interface CloseStep {
  id: string;
  /** The checklist line in the reader's language. */
  description: string;
  note: string | null;
  done: boolean;
  /** Pending items, when the line counts them. */
  pending: number | null;
  link: string | null;
  /** Lower first: what blocks closing outright, then what distorts the period's figures, then the manual steps. */
  priority: number;
}

export interface CloseAssistantView {
  period: { id: string; name: string; startDate: string; endDate: string; status: string };
  /** Share of steps done, 0–100. */
  progress: number;
  steps: CloseStep[];
  /** Findings of the anomaly run in the period that nobody has looked at, by severity. */
  openAnomalies: { critical: number; high: number; medium: number; low: number };
  /** Supplier bills that arrived by mail during the period and still wait for a person. */
  mailedBillsToReview: number;
  ready: boolean;
}

/**
 * Lines whose pending items keep the period from closing (or make its figures wrong) come first;
 * a manual step with no way to check it automatically comes last. Anything else, in between.
 */
const PRIORITY: Record<string, number> = {
  'unposted-journal-entries': 1,
  'pending-general-approvals': 2,
  'pending-accrual-reversals': 3,
  'currency-revaluation': 8,
  'fixed-assets-depreciation': 8,
};

/**
 * The close assistant: the period's checklist (the very one the closing screen computes), put in
 * the order to work through it, with what else in the period deserves a look before the books are
 * closed — findings nobody reviewed, bills that arrived by mail and wait. All of that is computed,
 * not written by a model. Asked for, the model then writes it as a short plan in the reader's
 * language (`CLOSE_ASSISTANT` report), from these facts only.
 */
@Injectable()
export class CloseAssistantService implements ReportBuilder, OnModuleInit {
  readonly kind = 'CLOSE_ASSISTANT' as const;
  readonly requestedAudience = 'REQUESTER' as const;
  readonly basePermissions: readonly string[] = [PERMISSIONS.ACCOUNTING_VIEW];

  constructor(
    private readonly readiness: CloseReadinessRegistry,
    private readonly reports: ReportsService,
    private readonly i18n: I18nService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.reports.register(this);
  }

  async view(organizationId: string, periodId: string, language: string): Promise<CloseAssistantView> {
    if (!this.readiness.available()) throw new ServiceUnavailableError('ai.close.unavailable');
    const { period, checklist } = await this.readiness.readiness(organizationId, periodId);
    const steps = checklist
      .map((item) => this.step(item, language))
      .sort((a, b) => Number(a.done) - Number(b.done) || a.priority - b.priority);
    const [anomalies, mailed] = await Promise.all([
      this.dataSource.query(
        `SELECT "severity", COUNT(*)::int AS "n" FROM "ai_anomalies"
          WHERE "organization_id" = $1 AND "status" = 'OPEN' AND "occurred_on" BETWEEN $2 AND $3
          GROUP BY "severity"`,
        [organizationId, period.startDate, period.endDate],
      ) as Promise<Array<{ severity: string; n: number }>>,
      this.dataSource.query(
        `SELECT COUNT(*)::int AS "n" FROM "inbound_messages"
          WHERE "organization_id" = $1 AND "purpose" = 'BILLS' AND "status" IN ('NEEDS_REVIEW', 'FAILED')
            AND "received_at"::date <= $2`,
        [organizationId, period.endDate],
      ) as Promise<Array<{ n: number }>>,
    ]);
    const bySeverity = Object.fromEntries(anomalies.map((row) => [row.severity, Number(row.n)]));
    const done = steps.filter((step) => step.done).length;
    return {
      period,
      progress: steps.length ? Math.round((done / steps.length) * 100) : 100,
      steps,
      openAnomalies: {
        critical: bySeverity['CRITICAL'] ?? 0,
        high: bySeverity['HIGH'] ?? 0,
        medium: bySeverity['MEDIUM'] ?? 0,
        low: bySeverity['LOW'] ?? 0,
      },
      mailedBillsToReview: Number(mailed[0]?.n ?? 0),
      ready: steps.every((step) => step.done || step.note !== null),
    };
  }

  private step(item: ClosingBlocker, requested: string): CloseStep {
    const language = preferenceLanguage(requested) ?? 'es';
    const pending = typeof item.details?.['pendingCount'] === 'number' ? item.details['pendingCount'] : null;
    return {
      id: item.id,
      description: this.i18n.translate(item.descriptionKey, language, item.params ?? {}),
      note: item.noteKey ? this.i18n.translate(item.noteKey, language, item.params ?? {}) : null,
      done: item.isCompleted,
      pending,
      link: item.resolutionLink ?? null,
      priority: PRIORITY[item.id] ?? (item.noteKey ? 8 : 5),
    };
  }

  /** The plan, written from the view: its facts are exactly what the screen shows. */
  async build(organizationId: string, report: AiReport, _access: MemberAccess | null): Promise<ReportBrief> {
    if (!report.sourceRunId) throw new Error('A close assistant report needs its period.');
    const view = await this.view(organizationId, report.sourceRunId, report.language);
    return {
      instructions:
        `Write the plan to close the accounting period ${view.period.name} (${view.period.startDate} to ${view.period.endDate}). ` +
        'Start with whether it can be closed now. Then the pending steps in the order given (they are already sorted by ' +
        'what to do first), saying for each what is pending and why it matters for the period\'s figures. Mention the open ' +
        'anomaly findings and the supplier bills waiting from e-mail if there are any: they may change the period. Say ' +
        'which steps are manual and must be confirmed by a person. Never say a step is done when the facts say it is not.',
      facts: {
        period: view.period,
        progressPercent: view.progress,
        canCloseNow: view.ready,
        steps: view.steps.map(({ description, note, done, pending }) => ({ description, note, done, pending })),
        openAnomalies: view.openAnomalies,
        mailedBillsToReview: view.mailedBillsToReview,
      },
      sourceRunId: view.period.id,
      requiredPermissions: [PERMISSIONS.ACCOUNTING_VIEW],
    };
  }
}
