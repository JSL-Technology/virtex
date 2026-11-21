import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { LanguageCode, matchLanguage } from '@virtex/shared/types';
import { PERMISSIONS } from '../../shared/permissions';
import { BUDGET_EXCEEDED, BudgetExceededEvent } from '../../contracts/business-events/budget.events';
import { NotificationsService } from '../notifications.service';
import { runAsTenantJob } from '../../shared/tenancy/tenant-job';
import { amountFormatterFor } from '../amount-format';
import { Recipient, membersWithPermission } from '../recipients';

/**
 * A posting past its budget, under a control set to warn (FINB-20): it went through, and the bell is
 * the warning.
 *
 * It reaches whoever manages budgets, and the person who posted it — they were not stopped, so this
 * is how they learn the posting was over its line. Published after the commit, so a posting that
 * rolled back is never announced; a failure to notify is logged and swallowed, the posting stands.
 */
@Injectable()
export class BudgetNotificationsListener {
  private readonly logger = new Logger(BudgetNotificationsListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  @OnEvent(BUDGET_EXCEEDED, { async: true })
  async onExceeded(event: BudgetExceededEvent): Promise<void> {
    try {
      await runAsTenantJob(this.dataSource, event.organizationId, () => this.announce(event));
    } catch (error) {
      this.logger.warn(
        { event: 'budget_exceeded_notice_failed', organizationId: event.organizationId, accountId: event.accountId },
        `A posting went past its budget but nobody could be told: ${(error as Error).message}`,
      );
    }
  }

  private async announce(event: BudgetExceededEvent): Promise<void> {
    const managers = await membersWithPermission(this.dataSource, event.organizationId, PERMISSIONS.BUDGETS_MANAGE);
    const recipients = new Map<string, Recipient>(managers.map((recipient) => [recipient.id, recipient]));
    for (const poster of await this.activeMember(event.organizationId, event.actorUserId)) recipients.set(poster.id, poster);
    if (recipients.size === 0) return;

    const format = await amountFormatterFor(this.dataSource.manager, event.organizationId);
    for (const recipient of recipients.values()) {
      const language = this.languageOf(recipient);
      await this.notifications.createLocalizedNotification(recipient.id, language, {
        titleKey: 'notifications.budget_exceeded.title',
        bodyKey: 'notifications.budget_exceeded.body',
        params: {
          budget: event.budgetName,
          period: event.period,
          account: event.accountCode ?? '',
          actual: format(event.actual, language),
          budgeted: format(event.budgeted, language),
        },
        link: `/accounting/variance-analysis?from=${event.period}&to=${event.period}`,
        organizationId: event.organizationId,
      });
    }
  }

  /** The person who posted, if they are still an active, unsuspended member here. */
  private async activeMember(organizationId: string, userId: string | null): Promise<Recipient[]> {
    if (!userId) return [];
    return this.dataSource.query(
      `SELECT u.id, u.preferred_language AS language
         FROM users u
         JOIN user_organizations m ON m.user_id = u.id AND m.organization_id = $1 AND m.suspended_at IS NULL
        WHERE u.id = $2 AND u.status = 'ACTIVE'`,
      [organizationId, userId],
    );
  }

  private languageOf(recipient: Recipient): LanguageCode {
    return matchLanguage(recipient.language) ?? 'es';
  }
}
