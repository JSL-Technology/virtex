import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { LanguageCode, matchLanguage } from '@virteex/shared/types';
import { PERMISSIONS } from '../../shared/permissions';
import {
  PAYROLL_RUN_APPROVED,
  PAYROLL_RUN_CALCULATED,
  PAYROLL_RUN_PAID,
  PayrollRunEvent,
} from '../../payroll/events/payroll-run.events';
import { MEMBER_JOINED, MemberJoinedEvent } from '../../users/events/member-joined.event';
import { NotificationsService } from '../notifications.service';
import { Recipient, membersWithPermission } from '../recipients';

/**
 * Payroll and membership in the bell (QA R3-M09: «la campana dice "No hay notificaciones" pese a
 * nómina aprobada/pagada e invitaciones»).
 *
 * - A calculated run reaches whoever may approve it, never the person who calculated it (who may
 *   not approve it anyway); the approval and the payment reach whoever moved the run before.
 * - A new member reaches whoever invited them, or, when nobody is on record, the company's user
 *   administrators.
 *
 * The events are published after the commit, so nothing rolled back is announced. A failure to
 * notify is logged and swallowed — the step itself happened.
 */
@Injectable()
export class OperationsNotificationsListener {
  private readonly logger = new Logger(OperationsNotificationsListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  @OnEvent(PAYROLL_RUN_CALCULATED, { async: true })
  async onCalculated(event: PayrollRunEvent): Promise<void> {
    await this.safely(event, async () => {
      const approvers = await membersWithPermission(
        this.dataSource,
        event.organizationId,
        PERMISSIONS.PAYROLL_APPROVE,
        event.actorUserId,
      );
      await this.notifyPayroll(approvers, event, 'calculated');
    });
  }

  @OnEvent(PAYROLL_RUN_APPROVED, { async: true })
  async onApproved(event: PayrollRunEvent): Promise<void> {
    await this.safely(event, async () => {
      await this.notifyPayroll(await this.members(event.organizationId, [event.calculatedBy], event.actorUserId), event, 'approved');
    });
  }

  @OnEvent(PAYROLL_RUN_PAID, { async: true })
  async onPaid(event: PayrollRunEvent): Promise<void> {
    await this.safely(event, async () => {
      const recipients = await this.members(event.organizationId, [event.calculatedBy, event.approvedBy], event.actorUserId);
      await this.notifyPayroll(recipients, event, 'paid');
    });
  }

  @OnEvent(MEMBER_JOINED, { async: true })
  async onMemberJoined(event: MemberJoinedEvent): Promise<void> {
    try {
      let recipients = await this.members(event.organizationId, [event.invitedById], event.userId);
      if (recipients.length === 0) {
        recipients = await membersWithPermission(this.dataSource, event.organizationId, PERMISSIONS.USERS_EDIT, event.userId);
      }
      for (const recipient of recipients) {
        await this.notifications.createLocalizedNotification(recipient.id, this.languageOf(recipient), {
          titleKey: 'notifications.member_joined.title',
          bodyKey: 'notifications.member_joined.body',
          params: { name: event.name || event.email, email: event.email },
          link: '#settings/users',
          organizationId: event.organizationId,
        });
      }
    } catch (error) {
      this.logger.warn(
        { event: 'member_joined_notice_failed', userId: event.userId },
        `Member joined but nobody could be told: ${(error as Error).message}`,
      );
    }
  }

  private async notifyPayroll(recipients: Recipient[], event: PayrollRunEvent, step: 'calculated' | 'approved' | 'paid') {
    for (const recipient of recipients) {
      const language = this.languageOf(recipient);
      await this.notifications.createLocalizedNotification(recipient.id, language, {
        titleKey: `notifications.payroll.${step}.title`,
        bodyKey: `notifications.payroll.${step}.body`,
        params: { name: event.name, amount: formatAmount(event.totalNet, language, event.currencyCode) },
        link: `/payroll/runs/${event.runId}`,
        organizationId: event.organizationId,
      });
    }
  }

  /** The named people, if they are still active, unsuspended members here; never the actor. */
  private async members(organizationId: string, ids: (string | null)[], actorUserId: string | null): Promise<Recipient[]> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id && id !== actorUserId))];
    if (wanted.length === 0) return [];
    return this.dataSource.query(
      `SELECT u.id, u.preferred_language AS language
         FROM users u
         JOIN user_organizations m ON m.user_id = u.id AND m.organization_id = $1 AND m.suspended_at IS NULL
        WHERE u.id = ANY($2::uuid[]) AND u.status = 'ACTIVE'`,
      [organizationId, wanted],
    );
  }

  private async safely(event: PayrollRunEvent, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.warn(
        { event: 'payroll_notice_failed', runId: event.runId },
        `Payroll run moved but nobody could be told: ${(error as Error).message}`,
      );
    }
  }

  private languageOf(recipient: Recipient): LanguageCode {
    return matchLanguage(recipient.language) ?? 'es';
  }
}

export function formatAmount(amount: number, language: LanguageCode, currencyCode?: string | null): string {
  const options: Intl.NumberFormatOptions = currencyCode
    ? { style: 'currency', currency: currencyCode }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  try {
    return new Intl.NumberFormat(language, options).format(amount);
  } catch {
    return new Intl.NumberFormat(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  }
}
