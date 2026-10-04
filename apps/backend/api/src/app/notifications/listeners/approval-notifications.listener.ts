import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { LanguageCode, composeKey, matchLanguage } from '@virteex/shared/types';
import { hasPermission } from '@virteex/shared/util-auth';
import {
  APPROVAL_DECIDED,
  APPROVAL_REQUESTED,
  ApprovalDecidedEvent,
  ApprovalRequestedEvent,
} from '../../workflows/events/approval.events';
import { NotificationsService } from '../notifications.service';

/** Where the document behind a request is opened in the client, by type. */
const DOCUMENT_LINKS: Readonly<Record<string, (id: string) => string>> = {
  VENDOR_BILL: (id) => `/accounts-payable/${id}`,
  JOURNAL_ENTRY: (id) => `/accounting/journal-entries/${id}/edit`,
  AUDIT_ADJUSTMENT: () => '/accounting/audit-adjustments',
  PERIOD_REOPENING: () => '/accounting/periods',
  PAYMENT_BATCH: () => '/accounts-payable/payments',
  PURCHASE_ORDER: (id) => `/purchasing/orders/${id}/edit`,
  PURCHASE_REQUISITION: (id) => `/purchasing/requisitions/${id}/edit`,
};

interface Recipient {
  id: string;
  language: string | null;
}

/**
 * Approvals in the bell (QA B-02: «la campana no muestra ninguna notificación pese a los eventos»).
 *
 * - A request reaches the members of the role that decides its open step — on submission and
 *   again at every escalation — except whoever raised it, who may not approve it anyway.
 * - The decision reaches whoever raised it, unless they decided it themselves.
 *
 * The events are published after the commit by whoever owned the transaction, so the request is
 * in the database by then and a rolled-back one is never announced. A failure to notify is logged
 * and swallowed — the approval itself happened.
 */
@Injectable()
export class ApprovalNotificationsListener {
  private readonly logger = new Logger(ApprovalNotificationsListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  @OnEvent(APPROVAL_REQUESTED)
  async onRequested(event: ApprovalRequestedEvent): Promise<void> {
    try {
      const recipients = event.roleId
        ? await this.membersWithRole(event.organizationId, event.roleId, event.requestedByUserId)
        : event.permission
          ? await this.membersWithPermission(event.organizationId, event.permission, event.requestedByUserId)
          : [];
      for (const recipient of recipients) {
        const language = this.languageOf(recipient);
        await this.notifications.createLocalizedNotification(recipient.id, language, {
          titleKey: 'notifications.approval.requested.title',
          bodyKey: event.reference
            ? 'notifications.approval.requested.body_reference'
            : 'notifications.approval.requested.body_step',
          params: {
            documentKey: documentKey(event.documentType),
            amount: formatAmount(event.amount, language, event.currencyCode),
            ...(event.reference ? { reference: event.reference } : { step: event.stepOrder ?? 1 }),
          },
          link: '/approvals',
          organizationId: event.organizationId,
        });
      }
    } catch (error) {
      this.logger.warn(
        { event: 'approval_notice_failed', requestId: event.requestId },
        `Approval request recorded but its approvers could not be notified: ${(error as Error).message}`,
      );
    }
  }

  @OnEvent(APPROVAL_DECIDED)
  async onDecided(event: ApprovalDecidedEvent): Promise<void> {
    if (!event.requestedByUserId || event.requestedByUserId === event.actorUserId) return;
    const requesterId = event.requestedByUserId;
    try {
      const [recipient] = await this.dataSource.query(
        `SELECT u.id, u.preferred_language AS language
           FROM users u
           JOIN user_organizations m ON m.user_id = u.id AND m.organization_id = $2 AND m.suspended_at IS NULL
          WHERE u.id = $1 AND u.status = 'ACTIVE'`,
        [requesterId, event.organizationId],
      );
      if (!recipient) return;
      const approved = event.decision === 'APPROVED';
      await this.notifications.createLocalizedNotification(recipient.id, this.languageOf(recipient), {
        titleKey: approved ? 'notifications.approval.approved.title' : 'notifications.approval.rejected.title',
        bodyKey: approved
          ? event.reference
            ? 'notifications.approval.approved.body_reference'
            : 'notifications.approval.approved.body'
          : event.reference
            ? 'notifications.approval.rejected.body_reference'
            : 'notifications.approval.rejected.body',
        params: {
          documentKey: documentKey(event.documentType),
          reason: event.reason ?? '',
          ...(event.reference ? { reference: event.reference } : {}),
        },
        link: DOCUMENT_LINKS[event.documentType]?.(event.documentId) ?? null,
        organizationId: event.organizationId,
      });
    } catch (error) {
      this.logger.warn(
        { event: 'approval_decision_notice_failed', requestId: event.requestId },
        `Approval decided but the requester could not be notified: ${(error as Error).message}`,
      );
    }
  }

  /** Active, unsuspended members of this company holding a permission here; never the requester. */
  private async membersWithPermission(organizationId: string, permission: string, requesterId: string | null): Promise<Recipient[]> {
    const rows: { id: string; language: string | null; permissions: string | null }[] = await this.dataSource.query(
      `SELECT u.id, u.preferred_language AS language, r.permissions
         FROM users u
         JOIN user_organizations m ON m.user_id = u.id AND m.organization_id = $1 AND m.suspended_at IS NULL
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id AND (r.organization_id = $1 OR r.organization_id IS NULL)
        WHERE u.status = 'ACTIVE' AND ($2::uuid IS NULL OR u.id <> $2::uuid)`,
      [organizationId, requesterId],
    );
    const byUser = new Map<string, { language: string | null; permissions: string[] }>();
    for (const row of rows) {
      const entry = byUser.get(row.id) ?? { language: row.language, permissions: [] };
      entry.permissions.push(...(row.permissions ?? '').split(',').map((p) => p.trim()).filter(Boolean));
      byUser.set(row.id, entry);
    }
    return [...byUser.entries()]
      .filter(([, entry]) => hasPermission(entry.permissions, [permission]))
      .map(([id, entry]) => ({ id, language: entry.language }));
  }

  /** Active, unsuspended members of this company holding the step's role; never the requester. */
  private membersWithRole(organizationId: string, roleId: string, requesterId: string | null): Promise<Recipient[]> {
    return this.dataSource.query(
      `SELECT DISTINCT u.id, u.preferred_language AS language
         FROM users u
         JOIN user_organizations m ON m.user_id = u.id AND m.organization_id = $1 AND m.suspended_at IS NULL
         JOIN user_roles ur ON ur.user_id = u.id AND ur.role_id = $2
         JOIN roles r ON r.id = ur.role_id AND (r.organization_id = $1 OR r.organization_id IS NULL)
        WHERE u.status = 'ACTIVE' AND ($3::uuid IS NULL OR u.id <> $3::uuid)`,
      [organizationId, roleId, requesterId],
    );
  }

  private languageOf(recipient: Recipient): LanguageCode {
    return matchLanguage(recipient.language) ?? 'es';
  }
}

function documentKey(documentType: string): string {
  return composeKey('notifications.document_type', documentType);
}

function formatAmount(amount: number, language: LanguageCode, currencyCode?: string | null): string {
  const options: Intl.NumberFormatOptions = currencyCode
    ? { style: 'currency', currency: currencyCode }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  try {
    return new Intl.NumberFormat(language, options).format(amount);
  } catch {
    return new Intl.NumberFormat(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  }
}
