import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { LanguageCode, matchLanguage } from '@virteex/shared/types';
import { AI_RUN_FINDINGS, AiRunFindingsEvent } from '../../contracts/ai-insights/ai-run-findings.contract';
import { AI_PERMISSIONS } from '../../shared/ai.permissions';
import { runAsTenantJob } from '../../shared/tenancy/tenant-job';
import { NotificationsService } from '../notifications.service';
import { membersWithPermission } from '../recipients';

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

  private async stockouts(event: AiRunFindingsEvent): Promise<void> {
    const { count, earliestDate, products } = event.stockouts!;
    const recipients = await membersWithPermission(this.dataSource, event.organizationId, AI_PERMISSIONS.AI_FORECASTS_VIEW);
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
    const recipients = await membersWithPermission(this.dataSource, event.organizationId, AI_PERMISSIONS.AI_ANOMALIES_VIEW);
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
    const recipients = await membersWithPermission(this.dataSource, event.organizationId, AI_PERMISSIONS.AI_CASHFLOW_VIEW);
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
