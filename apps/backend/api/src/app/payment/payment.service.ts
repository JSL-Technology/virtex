import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { RegistrationPaymentPort } from '../auth/ports/registration-payment.port';
import type { BillingPeriod } from '../saas/enums/billing-period.enum';
import { BadRequestError, ForbiddenError } from '../i18n/localized.exception';
import { BillingStateService } from './billing-state.service';
import { overviewFromRecord } from './billing-overview';
import {
  type BillingInvoice,
  type BillingOverview,
  type CheckoutSessionInfo,
  type CheckoutSessionResult,
  type CreateRegistrationCheckoutDto,
  PaymentGateway,
  type PlanChangeStart,
  type StartPlanChangeRequest,
  type WebhookResult,
} from './payment-gateway.port';

/**
 * Billing, as the product's controllers and the signup see it — whichever provider is configured.
 *
 * The rules that do not depend on the provider live here, once, rather than in each adapter: above
 * all that a company billed through its parent does not manage billing itself. Its subscription,
 * card and invoices are the parent's, and so is the decision to change them.
 */
@Injectable()
export class PaymentService extends RegistrationPaymentPort {
  constructor(
    private readonly gateway: PaymentGateway,
    private readonly billingState: BillingStateService,
    private readonly dataSource: DataSource,
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
  ) {
    super();
  }

  priceIdFor(
    plan: { slug: string; monthlyPriceId?: string | null; annualPriceId?: string | null },
    period: BillingPeriod,
  ): string | null {
    return this.gateway.priceIdFor(plan, period);
  }

  createRegistrationCheckoutSession(dto: CreateRegistrationCheckoutDto): Promise<CheckoutSessionResult> {
    return this.gateway.createRegistrationCheckoutSession(dto);
  }

  getCheckoutSession(sessionId: string): Promise<CheckoutSessionInfo> {
    return this.gateway.getCheckoutSession(sessionId);
  }

  /** Cancel and refund a subscription whose account could not be created. See the gateway. */
  voidOrphanedSubscription(subscriptionId: string, reason: string): Promise<void> {
    return this.gateway.voidOrphanedSubscription(subscriptionId, reason);
  }

  handleWebhook(signature: string, payload: Buffer): Promise<WebhookResult> {
    return this.gateway.handleWebhook(payload, signature);
  }

  /** Buy a subscription when none is in force, change the one in force otherwise. */
  async startPlanChange(request: StartPlanChangeRequest): Promise<PlanChangeStart> {
    await this.assertManagesOwnBilling(request.organizationId);
    return this.gateway.startPlanChange(request);
  }

  async getBillingOverview(organizationId: string): Promise<BillingOverview> {
    const parent = await this.billingState.billingParentOf(this.dataSource.manager, organizationId);
    if (!parent) return this.gateway.getBillingOverview(organizationId);

    // The plan and the standing are this company's to see; the parent's card is not.
    const organization = await this.organizations.findOne({ where: { id: organizationId }, relations: ['plan'] });
    if (!organization) throw new BadRequestError('payment.organization_not_found');
    return overviewFromRecord(organization, 'parent_organization', parent);
  }

  async confirmOrganizationCheckout(organizationId: string, sessionId: string): Promise<BillingOverview> {
    await this.assertManagesOwnBilling(organizationId);
    return this.gateway.confirmOrganizationCheckout(organizationId, sessionId);
  }

  async reconcileSubscription(organizationId: string): Promise<BillingOverview> {
    await this.assertManagesOwnBilling(organizationId);
    return this.gateway.reconcileSubscription(organizationId);
  }

  async getInvoices(organizationId: string, limit?: number): Promise<BillingInvoice[]> {
    await this.assertManagesOwnBilling(organizationId);
    return this.gateway.getInvoices(organizationId, limit);
  }

  async createBillingPortalSession(organizationId: string, returnUrl: string): Promise<{ url: string }> {
    await this.assertManagesOwnBilling(organizationId);
    return this.gateway.createBillingPortalSession(organizationId, returnUrl);
  }

  private async assertManagesOwnBilling(organizationId: string): Promise<void> {
    const parent = await this.billingState.billingParentOf(this.dataSource.manager, organizationId);
    if (parent) {
      throw new ForbiddenError('payment.billing_managed_by_parent', { name: parent.name });
    }
  }
}
