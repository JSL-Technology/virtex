import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { LanguageCode, matchLanguage } from '@virteex/shared/types';
import { AI_RUN_FINDINGS, AiRunFindingsEvent } from '../../contracts/ai-insights/ai-run-findings.contract';
import { AI_REPORT_READY, AiReportReadyEvent } from '../../contracts/ai-insights/ai-report-ready.contract';
import { AI_PERMISSIONS } from '../../shared/ai.permissions';
import { runAsTenantJob } from '../../shared/tenancy/tenant-job';
import { NotificationsService } from '../notifications.service';
import { holdsAll, loadMembersAccess } from '../../roles/contracts/member-access.contract';

/**
 * The AI speaking first: products about to run out, and new serious anomalies, in the bell.
 *
 * Told to whoever can act on it — stockouts to those who can read the forecasts, anomalies to
 * those who can read the anomalies — and at most once per run (the AI module claims the run before
 * it announces). The event arrives from a background job, so the work runs in the tenant's own
 * context; a failure to notify is logged and never retried into a duplicate.
 */
@Injectable()
export class AiNotificationsListener {
  private readonly logger = new Logger(AiNotificationsListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  @OnEvent(AI_RUN_FINDINGS, { async: true })
  async onFindings(event: AiRunFindingsEvent): Promise<void> {
    try {
      await runAsTenantJob(this.dataSource, event.organizationId, async () => {
        if (event.stockouts?.count) await this.stockouts(event);
        if (event.anomalies?.count) await this.anomalies(event);
        if (event.cashflow) await this.cashflow(event);
      });
    } catch (error) {
      this.logger.warn(
        { event: 'ai_notice_failed', runId: event.runId },
        `AI run findings could not be notified: ${(error as Error).message}`,
      );
    }
  }

  /** The manager's monthly report is written: told to those who may read it. */
  @OnEvent(AI_REPORT_READY, { async: true })
  async onReportReady(event: AiReportReadyEvent): Promise<void> {
    try {
      await runAsTenantJob(this.dataSource, event.organizationId, async () => {
        // Told only to those who may read it: the requester of a personal report; for a company-wide
        // one, members holding every source permission and limited to no branch. The same rule as
        // reading it (`canReadReport`), so a notice never points at a report its reader cannot open.
        const required = [AI_PERMISSIONS.AI_REPORTS_VIEW, ...(event.requiredPermissions ?? [])];
        const members = await loadMembersAccess(this.dataSource, event.organizationId);
        const recipients = members
          .filter((member) => holdsAll(member, required))
          .filter((member) =>
            event.audience === 'REQUESTER' ? member.userId === event.requestedByUserId : member.branches === null,
          )
          .map((member) => ({ id: member.userId, language: member.language }));
        for (const recipient of recipients) {
          const language = languageOf(recipient.language);
          await this.notifications.createLocalizedNotification(recipient.id, language, {
            titleKey: 'notifications.ai.manager_report.title',
            bodyKey: 'notifications.ai.manager_report.body',
            params: { month: formatMonth(event.period, language) },
            link: `/reports/manager-report?id=${event.reportId}`,
            organizationId: event.organizationId,
          });
        }
      });
    } catch (error) {
      this.logger.warn(
        { event: 'ai_notice_failed', reportId: event.reportId },
        `AI report could not be notified: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Who may be told a company-wide AI finding: the permission, and no branch limit. The stockouts,
   * the anomalies and the cash projection are drawn from every branch's documents; a person
   * limited to some branches does not see them on screen and is not told them in the bell either.
   */
  private async companyWideReaders(organizationId: string, required: string[]) {
    const members = await loadMembersAccess(this.dataSource, organizationId);
    return members
      .filter((member) => holdsAll(member, required) && member.branches === null)
      .map((member) => ({ id: member.userId, language: member.language }));
  }

  private async stockouts(event: AiRunFindingsEvent): Promise<void> {
    const { count, earliestDate, products } = event.stockouts!;
    const recipients = await this.companyWideReaders(event.organizationId, [AI_PERMISSIONS.AI_FORECASTS_VIEW]);
    for (const recipient of recipients) {
      const language = languageOf(recipient.language);
      await this.notifications.createLocalizedNotification(recipient.id, language, {
        titleKey: 'notifications.ai.stockouts.title',
        bodyKey: count === 1 ? 'notifications.ai.stockouts.body_one' : 'notifications.ai.stockouts.body',
        params: { count, products: products.join(', '), date: formatDate(earliestDate, language) },
        link: '/inventory/predictions',
        organizationId: event.organizationId,
      });
    }
  }

  private async anomalies(event: AiRunFindingsEvent): Promise<void> {
    const { count, critical } = event.anomalies!;
    const recipients = await this.companyWideReaders(event.organizationId, [AI_PERMISSIONS.AI_ANOMALIES_VIEW]);
    for (const recipient of recipients) {
      await this.notifications.createLocalizedNotification(recipient.id, languageOf(recipient.language), {
        titleKey: critical ? 'notifications.ai.anomalies.title_critical' : 'notifications.ai.anomalies.title',
        bodyKey: count === 1 ? 'notifications.ai.anomalies.body_one' : 'notifications.ai.anomalies.body',
        params: { count, critical },
        link: '/reports/anomalies',
        organizationId: event.organizationId,
      });
    }
  }

  private async cashflow(event: AiRunFindingsEvent): Promise<void> {
    const { probability, date, lowestExpected, currency } = event.cashflow!;
    const recipients = await this.companyWideReaders(event.organizationId, [AI_PERMISSIONS.AI_CASHFLOW_VIEW]);
    for (const recipient of recipients) {
      const language = languageOf(recipient.language);
      await this.notifications.createLocalizedNotification(recipient.id, language, {
        titleKey: 'notifications.ai.cashflow.title',
        bodyKey: date ? 'notifications.ai.cashflow.body' : 'notifications.ai.cashflow.body_no_date',
        params: {
          percent: Math.round(probability * 100),
          date: formatDate(date, language),
          lowest: formatMoney(lowestExpected, currency, language),
        },
        link: '/accounting/treasury/cash-flow',
        organizationId: event.organizationId,
      });
    }
  }
}

function formatMoney(amount: number, currency: string | null, language: LanguageCode): string {
  try {
    return new Intl.NumberFormat(language, currency ? { style: 'currency', currency } : { maximumFractionDigits: 2 }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

function languageOf(language: string | null): LanguageCode {
  return matchLanguage(language) ?? 'es';
}

function formatDate(iso: string | null, language: LanguageCode): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
  } catch {
    return iso;
  }
}

/** `2026-09` → «septiembre de 2026». */
function formatMonth(period: string | null, language: LanguageCode): string {
  if (!period) return '';
  try {
    return new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period}-01T00:00:00Z`));
  } catch {
    return period;
  }
}
