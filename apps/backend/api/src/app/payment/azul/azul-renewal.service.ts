import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Like, Repository, In } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { SaasService } from '../../saas/saas.service';
import type { BillingPeriod } from '../../saas/enums/billing-period.enum';
import { AzulPaymentAdapter } from '../adapters/azul-payment.adapter';
import { BillingIntentStatus, BillingPaymentIntent } from '../entities/billing-payment-intent.entity';
import {
  SUBSCRIPTION_CHARGED,
  SubscriptionChargedAnswer,
  SubscriptionChargedEvent,
} from '../../contracts/billing/subscription-charge.contract';

/** Days a failed renewal is retried before the subscription is suspended. */
const RETRY_DAYS = 14;

/**
 * What Stripe does for a Stripe subscription, done here for one charged through Azul: renew it on
 * its date against the card on file, retry a declined renewal daily, suspend it when retries run
 * out — and hand every successful charge to Sales so the platform issues its own e-CF for it.
 */
@Injectable()
export class AzulRenewalService {
  private readonly logger = new Logger(AzulRenewalService.name);

  constructor(
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    @InjectRepository(BillingPaymentIntent) private readonly intents: Repository<BillingPaymentIntent>,
    private readonly azul: AzulPaymentAdapter,
    private readonly saas: SaasService,
    private readonly events: EventEmitter2,
  ) {}

  /** 06:15 in Santo Domingo (10:15 UTC), every day. */
  @Cron('15 10 * * *', { name: 'azul-renewals' })
  async renewDue(now: Date = new Date()): Promise<{ renewed: number; declined: number; suspended: number }> {
    const due = await this.organizations.find({
      where: {
        externalSubscriptionId: Like('azul_sub_%'),
        subscriptionStatus: In(['active', 'trialing', 'past_due']),
        subscriptionPeriodEnd: LessThanOrEqual(now),
      },
      relations: ['plan'],
    });
    let renewed = 0;
    let declined = 0;
    let suspended = 0;
    for (const organization of due) {
      if (!organization.plan) continue;
      const last = (await this.azul.chargesOf(organization)).find((c) => c.status === BillingIntentStatus.APPROVED);
      const period = ((last?.billingPeriod as BillingPeriod) ?? 'monthly') as BillingPeriod;
      const charge = await this.azul.renew(organization, organization.plan.slug, period);
      if (charge.status === BillingIntentStatus.APPROVED) {
        organization.subscriptionStatus = 'active';
        organization.subscriptionPeriodEnd = charge.periodEnd;
        renewed++;
      } else {
        const lapsedFor = organization.subscriptionPeriodEnd
          ? (now.getTime() - new Date(organization.subscriptionPeriodEnd).getTime()) / 86_400_000
          : RETRY_DAYS;
        if (lapsedFor >= RETRY_DAYS) {
          organization.subscriptionStatus = 'unpaid';
          suspended++;
        } else {
          organization.subscriptionStatus = 'past_due';
          declined++;
        }
        this.logger.warn(
          { event: 'azul_renewal_declined', organizationId: organization.id, chargeId: charge.id, lapsedDays: Math.floor(lapsedFor) },
          'Azul renewal declined',
        );
      }
      await this.organizations.save(organization);
      await this.saas.clearOrganizationCache(organization.id);
    }
    if (due.length) await this.invoicePending();
    return { renewed, declined, suspended };
  }

  /**
   * Hand every approved charge not yet documented to Sales, which issues the platform's e-CF for
   * it. Every ten minutes, so a signup's first charge is invoiced shortly after the account exists.
   */
  @Cron('*/10 * * * *', { name: 'azul-platform-invoices' })
  async invoicePending(): Promise<number> {
    const charges = await this.intents.find({
      where: { provider: 'azul', status: BillingIntentStatus.APPROVED, invoicedAt: IsNull() },
      order: { createdAt: 'ASC' },
      take: 50,
    });
    let invoiced = 0;
    for (const charge of charges) {
      if (charge.amountMinor <= 0) continue;
      const organization =
        (charge.organizationId
          ? await this.organizations.findOne({ where: { id: charge.organizationId } })
          : await this.organizations.findOne({ where: { externalSubscriptionId: `azul_sub_${charge.id}` } })) ?? null;
      // A signup's charge before its account exists: next run.
      if (!organization) continue;
      const event: SubscriptionChargedEvent = {
        chargeId: charge.id,
        organizationId: organization.id,
        legalName: organization.legalName ?? '',
        taxId: organization.taxId ?? null,
        country: organization.country ?? null,
        email: organization.email ?? charge.email ?? null,
        planSlug: charge.planSlug,
        period: charge.billingPeriod,
        currency: charge.currency,
        amountMinor: charge.amountMinor,
        taxMinor: charge.taxMinor,
        chargedAt: charge.createdAt.toISOString(),
      };
      try {
        const answers = (await this.events.emitAsync(SUBSCRIPTION_CHARGED, event)) as SubscriptionChargedAnswer[];
        const answer = answers.find((a) => a && 'invoiceId' in a) ?? null;
        if (!answer) continue; // The platform is not set up to invoice yet; retried next run.
        charge.organizationId = organization.id;
        charge.invoicedAt = new Date();
        charge.platformInvoiceId = answer.invoiceId;
        await this.intents.save(charge);
        invoiced++;
      } catch (error) {
        this.logger.error(
          { event: 'platform_invoice_failed', chargeId: charge.id, organizationId: organization.id },
          `The platform could not invoice a subscription charge: ${(error as Error).message}`,
        );
      }
    }
    return invoiced;
  }
}
