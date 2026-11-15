import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { PaymentService } from './payment.service';
import type { PaymentGateway } from './payment-gateway.port';
import { expectLocalizedError } from '../i18n/testing/expect-localized-error';

/**
 * The provider-neutral rules of billing, held once instead of in each adapter.
 *
 * A company created under another one shares its parent's subscription and customer — and with
 * them the card, the invoices and the provider's portal. Its administrator is not the parent's:
 * a subsidiary that could open the portal saw and changed the parent's card, and one that could
 * change plan changed the whole group's.
 */
describe('PaymentService', () => {
  const gateway = {
    startPlanChange: jest.fn(async () => ({ flow: 'checkout', url: 'https://pay' })),
    getBillingOverview: jest.fn(async () => ({ billedThrough: null })),
    getInvoices: jest.fn(async () => []),
    createBillingPortalSession: jest.fn(async () => ({ url: 'https://portal' })),
    confirmOrganizationCheckout: jest.fn(async () => ({})),
    reconcileSubscription: jest.fn(async () => ({})),
    handleWebhook: jest.fn(),
  };
  let parent: { organizationId: string; name: string } | null = null;
  const billingState = { billingParentOf: jest.fn(async () => parent) };
  const organizations = {
    findOne: jest.fn(async () => ({
      plan: { slug: 'pro', name: 'Pro', monthlyPrice: 7900 },
      country: 'US',
      subscriptionStatus: 'active',
      subscriptionPeriodEnd: null,
    })),
  };
  const failures = { labels: jest.fn(() => ({ inc: jest.fn() })) };
  const service = new PaymentService(
    gateway as unknown as PaymentGateway,
    billingState as never,
    { manager: {} } as never,
    organizations as never,
    { webhookFailureCounter: failures } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    parent = null;
  });

  describe('a company billed through its parent', () => {
    beforeEach(() => {
      parent = { organizationId: 'org-parent', name: 'QA Matriz' };
    });

    it.each([
      ['changes plan', () => service.startPlanChange({ organizationId: 'org-sub' } as never)],
      ['opens the portal', () => service.createBillingPortalSession('org-sub', 'https://back')],
      ['reads the invoices', () => service.getInvoices('org-sub')],
      ['confirms a checkout', () => service.confirmOrganizationCheckout('org-sub', 'cs_1')],
      ['reconciles the subscription', () => service.reconcileSubscription('org-sub')],
    ])('cannot: %s', async (_what, act) => {
      await expectLocalizedError(act(), 'payment.billing_managed_by_parent', { name: 'QA Matriz' });
      await expect(act()).rejects.toBeInstanceOf(ForbiddenException);
      expect(gateway.startPlanChange).not.toHaveBeenCalled();
      expect(gateway.createBillingPortalSession).not.toHaveBeenCalled();
      expect(gateway.getInvoices).not.toHaveBeenCalled();
    });

    it('sees its plan and who bills it, never the parent’s card', async () => {
      const overview = await service.getBillingOverview('org-sub');

      expect(gateway.getBillingOverview).not.toHaveBeenCalled();
      expect(overview.billedThrough).toEqual({ organizationId: 'org-parent', name: 'QA Matriz' });
      expect(overview.subscription?.managedBy).toBe('parent_organization');
      expect(overview.paymentMethod).toBeNull();
      expect(overview.plan?.slug).toBe('pro');
    });
  });

  it('a company that pays for itself is served by the gateway', async () => {
    await expect(service.createBillingPortalSession('org-1', 'https://back')).resolves.toEqual({ url: 'https://portal' });
    await service.getBillingOverview('org-1');
    expect(gateway.getBillingOverview).toHaveBeenCalledWith('org-1');
  });

  describe('a webhook delivery that is not processed is counted, and still fails', () => {
    it.each([
      [new BadRequestException('bad signature'), 'rejected'],
      [new ServiceUnavailableException('not configured'), 'unavailable'],
      [new Error('database down'), 'failed'],
    ])('%s → %s', async (error, reason) => {
      gateway.handleWebhook.mockRejectedValueOnce(error);

      await expect(service.handleWebhook('sig', Buffer.from('{}'))).rejects.toBe(error);
      expect(failures.labels).toHaveBeenCalledWith(reason);
    });

    it('a processed delivery is not', async () => {
      gateway.handleWebhook.mockResolvedValueOnce({ processed: true, eventId: 'evt_1', type: 'invoice.paid' });

      await service.handleWebhook('sig', Buffer.from('{}'));
      expect(failures.labels).not.toHaveBeenCalled();
    });
  });
});
