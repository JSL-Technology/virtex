import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Organization } from '../../organizations/entities/organization.entity';
import { User, UserStatus } from '../../users/entities/user.entity/user.entity';
import { hasPermission } from '@virteex/shared/util-auth';
import { PERMISSIONS } from '../../shared/permissions';
import { NotificationsService } from '../../notifications/notifications.service';
import { MailService } from '../../mail/mail.service';
import { SaasResource } from '../enums/saas-resource.enum';
import { DEFAULT_LANGUAGE, matchLanguage } from '@virteex/shared/types';

interface PaymentFailedEvent {
  organizationId: string;
  amountDue: number;
  currency: string;
  attemptCount: number;
  nextAttempt: Date | null;
  gracePeriodEnd: Date | null;
}

interface PaymentSucceededEvent {
  organizationId: string;
  amountPaid: number;
  currency: string;
}

interface LimitEvent {
  organizationId: string;
  resource: SaasResource;
  currentUsage: number;
  limit: number;
  percentage?: number;
}

/**
 * Catalogue keys for the metered resources, so a notification does not read `journal_entries` —
 * and does not read `facturas` to somebody who asked for English, which is what a table of
 * Spanish literals here produced.
 */
const RESOURCE_LABEL_KEYS: Readonly<Record<string, string>> = {
  [SaasResource.INVOICES]: 'SAAS.RESOURCES.INVOICES',
  [SaasResource.USERS]: 'SAAS.RESOURCES.USERS',
  [SaasResource.CUSTOMERS]: 'SAAS.RESOURCES.CUSTOMERS',
  [SaasResource.SUPPLIERS]: 'SAAS.RESOURCES.SUPPLIERS',
  [SaasResource.JOURNAL_ENTRIES]: 'SAAS.RESOURCES.JOURNAL_ENTRIES',
  [SaasResource.SUBSIDIARIES]: 'SAAS.RESOURCES.SUBSIDIARIES',
};

/**
 * Tell the customer what is happening to their subscription and their quota.
 *
 * These four events were emitted with care — `saas.limit_warning` even carries a 24-hour debounce
 * so a tenant is not told twice in a day — and NOTHING subscribed to any of them. Not one
 * listener existed. So:
 *
 *   - a card that started failing produced a `past_due` status, a grace period and silence. The
 *     customer discovered it when the product stopped answering, which is the most expensive
 *     moment to discover it and the one that turns a recoverable payment failure into a
 *     cancellation;
 *   - a tenant approaching a quota was never warned, and met the limit as a hard error in the
 *     middle of issuing an invoice.
 *
 * Notifications go to the people who can act: the administrators of the tenant, resolved by
 * membership and by holding `billing:manage`. Everything is best-effort — a notification that
 * fails must never fail the webhook that Stripe is waiting on, or the metered operation the user
 * is performing.
 */
@Injectable()
export class BillingNotificationsListener {
  private readonly logger = new Logger(BillingNotificationsListener.name);

  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly notifications: NotificationsService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Who should hear about billing for this tenant.
   *
   * Resolved by MEMBERSHIP and by permission, not by `users.organization_id`: an accountant
   * invited from another tenant is a member here and may well be the person who holds the card.
   * Falls back to every member when the tenant somehow has nobody with the permission, because a
   * dunning notice nobody receives is the failure this whole listener exists to prevent.
   */
  private async recipients(organizationId: string): Promise<
    Array<{ id: string; email: string; firstName: string; preferredLanguage: string | null }>
  > {
    // Roles are stored as a `simple-array` (a comma-separated text column), so the permission
    // test cannot be a SQL predicate without becoming a substring match — `billing:manage` would
    // also match a hypothetical `billing:manage-later`. It is done in TypeScript with the same
    // `hasPermission` helper the guards use, so wildcards (`*`, `billing:*`) resolve identically.
    const members = await this.userRepository
      .createQueryBuilder('user')
      .innerJoin(
        'user_organizations',
        'membership',
        'membership.user_id = user.id AND membership.organization_id = :organizationId',
        { organizationId },
      )
      .leftJoinAndSelect(
        'user.roles',
        'role',
        'role.organizationId = :organizationId OR role.organizationId IS NULL',
        { organizationId },
      )
      .where('user.status = :status', { status: UserStatus.ACTIVE })
      .getMany();

    const canManageBilling = members.filter((member) =>
      hasPermission(
        [...new Set((member.roles ?? []).flatMap((role) => role.permissions ?? []))],
        [PERMISSIONS.BILLING_MANAGE],
      ),
    );

    // Falls back to every member: a dunning notice nobody receives is the failure this listener
    // exists to prevent, and a tenant with no billing-capable member is a misconfiguration the
    // customer still needs to hear about.
    const chosen = canManageBilling.length > 0 ? canManageBilling : members;

    return chosen.map((member) => ({
      id: member.id,
      email: member.email,
      firstName: member.firstName,
      preferredLanguage: member.preferredLanguage ?? null,
    }));
  }

  /**
   * Turn Stripe's minor units into a real amount plus its currency.
   *
   * Formatting is deferred to the point of rendering, where the reader's locale is known. It used
   * to be done here with `toLocaleString('es', …)` and the ISO code appended, so every recipient
   * read `1.234,56 USD` in Spanish grouping regardless of language or market.
   */
  private amountOf(minorUnits: number, currency: string): { amount: number; currency: string } {
    const upper = (currency ?? 'usd').toUpperCase();
    // Zero-decimal currencies (CLP, PYG) are whole units already; dividing them by 100 understates
    // the amount a hundredfold, which on a dunning notice is worse than showing nothing.
    const zeroDecimal = new Set(['CLP', 'PYG', 'JPY', 'KRW', 'VND']);
    return { amount: zeroDecimal.has(upper) ? minorUnits : minorUnits / 100, currency: upper };
  }

  @OnEvent('billing.payment_failed')
  async onPaymentFailed(event: PaymentFailedEvent): Promise<void> {
    const { amount, currency } = this.amountOf(event.amountDue, event.currency);

    // Four sentences were concatenated in TypeScript, with two conditional clauses spliced in by
    // `+`. That is untranslatable by construction: no other language can be relied on to put the
    // retry date and the grace period in the same order or the same clause. Each combination is
    // now a whole sentence in the catalogue, chosen here.
    const bodyKey = event.nextAttempt
      ? event.gracePeriodEnd
        ? 'SAAS.PAYMENT_FAILED.BODY_RETRY_AND_GRACE'
        : 'SAAS.PAYMENT_FAILED.BODY_RETRY'
      : event.gracePeriodEnd
        ? 'SAAS.PAYMENT_FAILED.BODY_GRACE'
        : 'SAAS.PAYMENT_FAILED.BODY';

    await this.notifyEveryone(event.organizationId, 'payment_failed', {
      titleKey: 'SAAS.PAYMENT_FAILED.TITLE',
      bodyKey,
      params: {
        amount,
        currency,
        nextAttempt: event.nextAttempt?.toISOString() ?? null,
        gracePeriodEnd: event.gracePeriodEnd ? new Date(event.gracePeriodEnd).toISOString() : null,
      },
    });
  }

  @OnEvent('billing.payment_succeeded')
  async onPaymentSucceeded(event: PaymentSucceededEvent): Promise<void> {
    // Only worth saying after a failure — a routine renewal notice is noise. The grace period
    // having been cleared is the signal that this recovery follows a problem.
    const organization = await this.organizationRepository.findOne({
      where: { id: event.organizationId },
    });
    if (!organization || organization.subscriptionStatus !== 'active') return;

    const { amount, currency } = this.amountOf(event.amountPaid, event.currency);
    await this.notifyEveryone(
      event.organizationId,
      'payment_succeeded',
      {
        titleKey: 'SAAS.PAYMENT_SUCCEEDED.TITLE',
        bodyKey: 'SAAS.PAYMENT_SUCCEEDED.BODY',
        params: { amount, currency },
      },
      { emailToo: false },
    );
  }

  @OnEvent('saas.limit_warning')
  async onLimitWarning(event: LimitEvent): Promise<void> {
    await this.notifyEveryone(
      event.organizationId,
      'limit_warning',
      {
        titleKey: 'SAAS.LIMIT_WARNING.TITLE',
        bodyKey: 'SAAS.LIMIT_WARNING.BODY',
        params: {
          resource: this.i18nResource(event.resource),
          used: event.currentUsage,
          limit: event.limit,
        },
      },
      { emailToo: false },
    );
  }

  /**
   * The resource name as a nested catalogue reference.
   *
   * Passed as a `{{resource}}` parameter whose value is itself a key, resolved by the template's
   * `t` helper and by `I18nService` before interpolation — so "facturas"/"invoices"/"faturas"
   * follows the reader rather than the server.
   */
  private i18nResource(resource: SaasResource): string {
    return RESOURCE_LABEL_KEYS[resource] ?? resource;
  }

  @OnEvent('saas.limit_reached')
  async onLimitReached(event: LimitEvent): Promise<void> {
    await this.notifyEveryone(event.organizationId, 'limit_reached', {
      titleKey: 'SAAS.LIMIT_REACHED.TITLE',
      bodyKey: 'SAAS.LIMIT_REACHED.BODY',
      params: { resource: this.i18nResource(event.resource), limit: event.limit },
    });
  }

  /**
   * Best-effort delivery to everybody who can act.
   *
   * Failures are logged and swallowed on purpose: these listeners run inside the Stripe webhook
   * transaction and inside metered operations, and a notification is never a reason to fail
   * either of them.
   */
  private async notifyEveryone(
    organizationId: string,
    event: string,
    message: { titleKey: string; bodyKey: string; params?: Record<string, unknown> },
    options: { emailToo?: boolean } = {},
  ): Promise<void> {
    const { emailToo = true } = options;

    try {
      const people = await this.recipients(organizationId);
      if (people.length === 0) {
        this.logger.warn(
          { event: 'billing_notification_no_recipients', organizationId, notification: event },
          'A billing notification has nobody to go to.',
        );
        return;
      }

      for (const person of people) {
        // Each person in their own language: a tenant is not monolingual, and the one message a
        // customer must not misread is the one telling them their card was declined.
        await this.notifications
          .createLocalizedNotification(
            person.id,
            matchLanguage(person.preferredLanguage) ?? DEFAULT_LANGUAGE,
            message,
          )
          .catch((error) =>
            this.logger.warn(
              { event: 'billing_notification_failed', organizationId, notification: event },
              `In-app notification failed: ${(error as Error).message}`,
            ),
          );
      }

      if (emailToo) {
        await this.mailService
          .sendBillingNotice(people, message)
          .catch((error) =>
            this.logger.warn(
              { event: 'billing_email_not_queued', organizationId, notification: event },
              `Billing email could not be queued: ${(error as Error).message}`,
            ),
          );
      }
    } catch (error) {
      this.logger.error(
        { event: 'billing_notification_error', organizationId, notification: event },
        `Could not notify the tenant: ${(error as Error).message}`,
      );
    }
  }
}
