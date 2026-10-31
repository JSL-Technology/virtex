import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource, Like } from 'typeorm';
import { InvoicesService } from './invoices.service';
import { Invoice, PaymentMethod } from './entities/invoice.entity';
import { Customer } from '../customers/entities/customer.entity';
import { runAsTenantJob } from '../shared/tenancy/tenant-job';
import { validateTaxId } from '../localization/contracts/tax-id.contract';
import {
  SUBSCRIPTION_CHARGED,
  SubscriptionChargedAnswer,
  SubscriptionChargedEvent,
} from '../contracts/billing/subscription-charge.contract';

/**
 * The platform's own comprobantes: every subscription charge it collects is a sale of the platform
 * company to the customer company, and in the Dominican Republic that sale needs its e-CF.
 *
 * The platform is a tenant like any other — `PLATFORM_BILLING_ORGANIZATION_ID` — with its own RNC,
 * certificate, e-NCF ranges and a service product (`PLATFORM_BILLING_PRODUCT_ID`) the charges are
 * invoiced as. So the platform bills its customers through the product it sells them: same
 * numbering, same ledger, same transmission to the DGII, same 607.
 *
 * Unconfigured, it answers null and the charge is retried on the next run — never silently dropped.
 */
@Injectable()
export class PlatformBillingListener {
  private readonly logger = new Logger(PlatformBillingListener.name);

  constructor(
    private readonly invoices: InvoicesService,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  @OnEvent(SUBSCRIPTION_CHARGED, { promisify: true })
  async onCharge(event: SubscriptionChargedEvent): Promise<SubscriptionChargedAnswer> {
    const platformId = this.config.get<string>('PLATFORM_BILLING_ORGANIZATION_ID');
    const productId = this.config.get<string>('PLATFORM_BILLING_PRODUCT_ID');
    if (!platformId || !productId) {
      this.logger.warn(
        { event: 'platform_billing_unconfigured', chargeId: event.chargeId },
        'Subscription charge not invoiced: set PLATFORM_BILLING_ORGANIZATION_ID and PLATFORM_BILLING_PRODUCT_ID.',
      );
      return null;
    }
    const marker = `SaaS ${event.chargeId}`;
    return runAsTenantJob(this.dataSource, platformId, async () => {
      // Idempotent: a charge is invoiced once, even if the run that invoiced it did not record it.
      const existing = await this.dataSource.getRepository(Invoice).findOne({
        where: { organizationId: platformId, notes: Like(`${marker}%`) },
        select: ['id'],
      });
      if (existing) return { invoiceId: existing.id };

      const customerId = await this.customerFor(platformId, event);
      const net = (event.amountMinor - event.taxMinor) / 100;
      const issueDate = event.chargedAt.slice(0, 10);
      const invoice = await this.invoices.create(
        {
          customerId,
          issueDate,
          dueDate: issueDate,
          currencyCode: event.currency,
          paymentMethod: PaymentMethod.CREDIT_CARD,
          notes: `${marker} · ${event.planSlug} (${event.period})`,
          lineItems: [{ productId, quantity: 1, unitPrice: net }],
        } as never,
        platformId,
      );
      this.logger.log(
        { event: 'platform_invoice_issued', chargeId: event.chargeId, invoiceId: invoice.id, ncf: invoice.fiscalNumber },
        'Subscription charge invoiced',
      );
      return { invoiceId: invoice.id };
    });
  }

  /** The customer company in the platform's books: by RNC, created the first time; else consumo. */
  private async customerFor(platformId: string, event: SubscriptionChargedEvent): Promise<string> {
    const repo = this.dataSource.getRepository(Customer);
    const digits = (event.taxId ?? '').replace(/\D/g, '');
    const valid = digits && (event.country ?? 'DO').toUpperCase() === 'DO' ? validateTaxId('DO', digits) : false;
    if (!valid) {
      const consumer = await repo.findOne({ where: { organizationId: platformId, isFinalConsumer: true } });
      if (!consumer) throw new Error('The platform company has no «Consumidor final» customer.');
      return consumer.id;
    }
    const found = await repo.findOne({ where: { organizationId: platformId, taxId: digits } });
    if (found) return found.id;
    const created = await repo.save(
      repo.create({
        organizationId: platformId,
        companyName: (event.legalName || digits).slice(0, 255),
        taxId: digits,
        email: event.email ?? undefined,
        identityDocumentTypeCode: digits.length === 9 ? 'RNC' : 'CEDULA',
        identityDocumentCountry: 'DO',
        country: 'DO',
      } as Partial<Customer>),
    );
    return created.id;
  }
}
