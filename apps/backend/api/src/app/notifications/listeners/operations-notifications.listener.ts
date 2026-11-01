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
} from '../../contracts/business-events/payroll-run.events';
import { MEMBER_JOINED, MemberJoinedEvent } from '../../users/events/member-joined.event';
import { NotificationsService } from '../notifications.service';
import { runAsTenantJob } from '../../shared/tenancy/tenant-job';
import { amountFormatterFor } from '../amount-format';
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
      await runAsTenantJob(this.dataSource, event.organizationId, () => this.announceMember(event));
    } catch (error) {
      this.logger.warn(
        { event: 'member_joined_notice_failed', userId: event.userId },
        `Member joined but nobody could be told: ${(error as Error).message}`,
      );
    }
  }

  private async announceMember(event: MemberJoinedEvent): Promise<void> {
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
  }

  private async notifyPayroll(recipients: Recipient[], event: PayrollRunEvent, step: 'calculated' | 'approved' | 'paid') {
    if (recipients.length === 0) return;
    const format = await amountFormatterFor(this.dataSource.manager, event.organizationId);
    for (const recipient of recipients) {
      const language = this.languageOf(recipient);
      await this.notifications.createLocalizedNotification(recipient.id, language, {
        titleKey: PAYROLL_KEYS[step].title,
        bodyKey: PAYROLL_KEYS[step].body,
        params: { name: event.name, amount: format(event.totalNet, language, event.currencyCode) },
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

  /**
   * In a tenant context of its own: the event is handled after the request that raised it has
   * given its connection back, and reading through that one failed with «Query runner already
   * released» — so no payroll notice was ever written (found re-verifying QA R3-M09).
   */
  private async safely(event: PayrollRunEvent, work: () => Promise<void>): Promise<void> {
    try {
      await runAsTenantJob(this.dataSource, event.organizationId, work);
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

/** Written out, not composed, so the catalogue check sees every key used. */
const PAYROLL_KEYS = {
  calculated: { title: 'notifications.payroll.calculated.title', body: 'notifications.payroll.calculated.body' },
  approved: { title: 'notifications.payroll.approved.title', body: 'notifications.payroll.approved.body' },
  paid: { title: 'notifications.payroll.paid.title', body: 'notifications.payroll.paid.body' },
} as const;
