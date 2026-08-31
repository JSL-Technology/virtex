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

/** Human names for the metered resources, so a notification does not read `journal_entries`. */
const RESOURCE_LABELS: Readonly<Record<string, string>> = {
  [SaasResource.INVOICES]: 'facturas',
  [SaasResource.USERS]: 'usuarios',
  [SaasResource.CUSTOMERS]: 'clientes',
  [SaasResource.SUPPLIERS]: 'proveedores',
  [SaasResource.JOURNAL_ENTRIES]: 'asientos contables',
  [SaasResource.SUBSIDIARIES]: 'subsidiarias',
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
  private async recipients(
    organizationId: string,
  ): Promise<Array<{ id: string; email: string; firstName: string }>> {
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
    }));
  }

  private formatAmount(minorUnits: number, currency: string): string {
    const upper = (currency ?? 'usd').toUpperCase();
    // Zero-decimal currencies (CLP, PYG) are whole units already; dividing them by 100 understates
    // the amount a hundredfold, which on a dunning notice is worse than showing nothing.
    const zeroDecimal = new Set(['CLP', 'PYG', 'JPY', 'KRW', 'VND']);
    const value = zeroDecimal.has(upper) ? minorUnits : minorUnits / 100;
    return `${value.toLocaleString('es', { minimumFractionDigits: zeroDecimal.has(upper) ? 0 : 2 })} ${upper}`;
  }

  @OnEvent('billing.payment_failed')
  async onPaymentFailed(event: PaymentFailedEvent): Promise<void> {
    await this.notifyEveryone(
      event.organizationId,
      'No pudimos cobrar tu suscripción',
      `El cobro de ${this.formatAmount(event.amountDue, event.currency)} no se pudo completar` +
        (event.nextAttempt
          ? `. Lo reintentaremos el ${event.nextAttempt.toLocaleDateString('es')}.`
          : '.') +
        (event.gracePeriodEnd
          ? ` Tu acceso continúa hasta el ${new Date(event.gracePeriodEnd).toLocaleDateString('es')}.`
          : '') +
        ' Actualiza tu método de pago en Configuración → Facturación.',
      'payment_failed',
    );
  }

  @OnEvent('billing.payment_succeeded')
  async onPaymentSucceeded(event: PaymentSucceededEvent): Promise<void> {
    // Only worth saying after a failure — a routine renewal notice is noise. The grace period
    // having been cleared is the signal that this recovery follows a problem.
    const organization = await this.organizationRepository.findOne({
      where: { id: event.organizationId },
    });
    if (!organization || organization.subscriptionStatus !== 'active') return;

    await this.notifyEveryone(
      event.organizationId,
      'Tu suscripción está al día',
      `Recibimos el pago de ${this.formatAmount(event.amountPaid, event.currency)}. Gracias.`,
      'payment_succeeded',
      { emailToo: false },
    );
  }

  @OnEvent('saas.limit_warning')
  async onLimitWarning(event: LimitEvent): Promise<void> {
    const label = RESOURCE_LABELS[event.resource] ?? event.resource;
    await this.notifyEveryone(
      event.organizationId,
      `Te acercas al límite de ${label}`,
      `Has usado ${event.currentUsage} de ${event.limit} ${label} de tu plan. ` +
        'Puedes ampliarlo en Configuración → Facturación antes de alcanzarlo.',
      'limit_warning',
      { emailToo: false },
    );
  }

  @OnEvent('saas.limit_reached')
  async onLimitReached(event: LimitEvent): Promise<void> {
    const label = RESOURCE_LABELS[event.resource] ?? event.resource;
    await this.notifyEveryone(
      event.organizationId,
      `Alcanzaste el límite de ${label}`,
      `Tu plan permite ${event.limit} ${label}. Amplía el plan en Configuración → Facturación ` +
        'para seguir trabajando.',
      'limit_reached',
    );
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
    title: string,
    body: string,
    event: string,
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
        await this.notifications.createNotification(person.id, title, body).catch((error) =>
          this.logger.warn(
            { event: 'billing_notification_failed', organizationId, notification: event },
            `In-app notification failed: ${(error as Error).message}`,
          ),
        );
      }

      if (emailToo) {
        await this.mailService
          .sendBillingNotice(
            people.map((p) => p.email),
            title,
            body,
          )
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
