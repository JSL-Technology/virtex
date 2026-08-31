import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import type Stripe from 'stripe';

import { StripePaymentAdapter } from './stripe-payment.adapter';
import { STRIPE_CLIENT } from '../stripe/stripe.provider';
import { Organization } from '../../organizations/entities/organization.entity';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { SaasService } from '../../saas/saas.service';

/**
 * The payment adapter had NO tests. None.
 *
 * 836 lines handling money: webhook signature verification, subscription lifecycle, dunning, the
 * compensation that refunds a customer whose account could not be created, and the reconciliation
 * endpoint that once let any member of any tenant point their employer's billing relationship at
 * their own Stripe customer. Meanwhile 458 lines of tests covered tax-id check digits, which
 * cannot lose anybody money.
 *
 * These pin the behaviours whose failure is silent — the ones where the code carries on and the
 * customer, or the ledger, is quietly wrong.
 */
describe('StripePaymentAdapter', () => {
  let adapter: StripePaymentAdapter;

  const stripe = {
    webhooks: { constructEvent: jest.fn() },
    subscriptions: { retrieve: jest.fn(), cancel: jest.fn() },
    invoices: { list: jest.fn() },
    refunds: { create: jest.fn() },
    checkout: { sessions: { retrieve: jest.fn(), create: jest.fn() } },
    prices: { retrieve: jest.fn() },
    customers: { create: jest.fn(), retrieve: jest.fn() },
  };

  const organizationRepository = { findOne: jest.fn(), save: jest.fn() };
  const webhookEventRepository = {};
  const saasService = {
    clearOrganizationCache: jest.fn(),
    getPlanBySlug: jest.fn(),
    getPlans: jest.fn().mockResolvedValue([]),
  };
  const eventEmitter = { emit: jest.fn(), emitAsync: jest.fn() };

  /** Entity manager captured by `dataSource.transaction`, so webhook handling is observable. */
  const manager = { findOne: jest.fn(), save: jest.fn() };
  const dataSource = {
    transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(manager)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripePaymentAdapter,
        { provide: STRIPE_CLIENT, useValue: stripe },
        { provide: getRepositoryToken(Organization), useValue: organizationRepository },
        { provide: getRepositoryToken(WebhookEvent), useValue: webhookEventRepository },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'STRIPE_WEBHOOK_SECRET' ? 'whsec_test' : 'development',
            ),
          },
        },
        { provide: DataSource, useValue: dataSource },
        { provide: SaasService, useValue: saasService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    adapter = module.get(StripePaymentAdapter);
  });

  const signedEvent = (event: Partial<Stripe.Event>) => {
    stripe.webhooks.constructEvent.mockReturnValue(event);
    return adapter.handleWebhook(Buffer.from('{}'), 'sig');
  };

  describe('webhook authentication', () => {
    it('refuses a payload whose signature does not verify', async () => {
      stripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature');
      });

      await expect(adapter.handleWebhook(Buffer.from('{}'), 'bad')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      // Nothing may be processed before the signature is proven: this endpoint is public by
      // necessity, and the signature IS its authentication.
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('verifies against the RAW body, not a re-serialised one', async () => {
      const raw = Buffer.from('{"id":"evt_1"}');
      stripe.webhooks.constructEvent.mockReturnValue({ id: 'evt_1', type: 'ping' } as never);

      await adapter.handleWebhook(raw, 'sig');

      // Re-serialising the parsed body changes key order and whitespace, and every signature
      // then fails. The application is created with `rawBody: true` precisely for this.
      expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(raw, 'sig', 'whsec_test');
    });

    it('processes an event exactly once', async () => {
      manager.findOne.mockResolvedValue({ id: 'evt_1' }); // already recorded

      await signedEvent({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } } as never);

      // The webhook and the browser redirect race constantly, and Stripe retries on any non-2xx.
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('dunning', () => {
    const invoice = {
      id: 'in_1',
      amount_due: 4900,
      currency: 'usd',
      attempt_count: 1,
      next_payment_attempt: 1_700_000_000,
      subscription: 'sub_1',
    };

    it('opens a bounded grace period on the FIRST failed charge', async () => {
      const organization = { id: 'org-1', gracePeriodEnd: null, subscriptionStatus: 'active' };
      manager.findOne.mockImplementation(async (entity: unknown) =>
        entity === WebhookEvent ? null : organization,
      );

      await signedEvent({
        id: 'evt_2',
        type: 'invoice.payment_failed',
        data: { object: invoice },
      } as never);

      // Waiting for Stripe's subscription status to change means waiting out the whole retry
      // schedule — roughly a fortnight in which nothing can tell a paying customer from one whose
      // card has been failing.
      expect(organization.subscriptionStatus).toBe('past_due');
      expect(organization.gracePeriodEnd).toBeInstanceOf(Date);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'billing.payment_failed',
        expect.objectContaining({ organizationId: 'org-1' }),
      );
    });

    it('never shortens a grace period that is already running', async () => {
      const farFuture = new Date(Date.now() + 90 * 24 * 3_600_000);
      const organization = {
        id: 'org-1',
        gracePeriodEnd: farFuture,
        subscriptionStatus: 'past_due',
      };
      manager.findOne.mockImplementation(async (entity: unknown) =>
        entity === WebhookEvent ? null : organization,
      );

      await signedEvent({
        id: 'evt_3',
        type: 'invoice.payment_failed',
        data: { object: invoice },
      } as never);

      // A second failed retry must not hand the customer a fresh window, nor cut short one an
      // operator granted deliberately.
      expect(organization.gracePeriodEnd).toBe(farFuture);
    });

    it('clears the grace period when the customer recovers, and invalidates the cache', async () => {
      const organization = {
        id: 'org-1',
        gracePeriodEnd: new Date(),
        subscriptionStatus: 'past_due',
      };
      manager.findOne.mockImplementation(async (entity: unknown) =>
        entity === WebhookEvent ? null : organization,
      );

      await signedEvent({
        id: 'evt_4',
        type: 'invoice.paid',
        data: { object: { ...invoice, amount_paid: 4900 } },
      } as never);

      expect(organization.subscriptionStatus).toBe('active');
      expect(organization.gracePeriodEnd).toBeNull();
      // The entitlement guard reads the status from the CACHED principal. Without this the
      // customer stays locked out of the very page they just paid on.
      expect(saasService.clearOrganizationCache).toHaveBeenCalledWith('org-1');
    });
  });

  describe('reconciling a checkout the browser came back from', () => {
    it('refuses a session that belongs to another organization', async () => {
      stripe.checkout.sessions.retrieve.mockResolvedValue({
        metadata: { organizationId: 'org-attacker' },
        status: 'complete',
        payment_status: 'paid',
      });

      await expect(
        adapter.confirmOrganizationCheckout('org-victim', 'cs_test_1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a session with no organization at all', async () => {
      // Registration checkouts carry `{ planSlug, pendingRegistrationId }` and no organization,
      // because none exists yet. The check used to be skipped entirely when the field was absent,
      // so anyone could reconcile a signup they had paid for onto their employer — overwriting
      // its Stripe customer and subscription with their own.
      stripe.checkout.sessions.retrieve.mockResolvedValue({
        metadata: { planSlug: 'pro', pendingRegistrationId: 'pending-1' },
        status: 'complete',
        payment_status: 'paid',
      });

      await expect(
        adapter.confirmOrganizationCheckout('org-victim', 'cs_test_2'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('compensating a charge whose account could not be created', () => {
    it('cancels first and refunds second', async () => {
      const order: string[] = [];
      stripe.subscriptions.cancel.mockImplementation(async () => void order.push('cancel'));
      stripe.invoices.list.mockResolvedValue({
        data: [{ amount_paid: 4900, payment_intent: 'pi_1' }],
      });
      stripe.refunds.create.mockImplementation(async () => void order.push('refund'));

      await adapter.voidOrphanedSubscription('sub_1', 'materialisation failed');

      // Stopping the recurring charge is the part that must not be missed; a refund can be issued
      // by hand later, whereas an uncancelled subscription bills a stranger every month.
      expect(order).toEqual(['cancel', 'refund']);
    });

    it('never throws — it runs inside a failure path already', async () => {
      stripe.subscriptions.cancel.mockRejectedValue(new Error('Stripe is down'));

      await expect(
        adapter.voidOrphanedSubscription('sub_1', 'materialisation failed'),
      ).resolves.toBeUndefined();
    });

    it('does not attempt a refund when the cancellation failed', async () => {
      stripe.subscriptions.cancel.mockRejectedValue(new Error('Stripe is down'));

      await adapter.voidOrphanedSubscription('sub_1', 'reason');

      expect(stripe.refunds.create).not.toHaveBeenCalled();
    });
  });

  describe('reading Stripe objects across API versions', () => {
    /**
     * `current_period_end` lived on the subscription root through the 2025-01 API and moved onto
     * each item afterwards. Reading only the root yields `undefined`, and `new Date(undefined *
     * 1000)` is an Invalid Date that TypeORM writes happily — so the renewal date silently became
     * null and every period calculation downstream drifted.
     */
    it('reads the period end from the subscription root', () => {
      const periodEnd = (adapter as never as {
        periodEndOf: (s: unknown) => Date | null;
      }).periodEndOf({ current_period_end: 1_700_000_000 });

      expect(periodEnd).toEqual(new Date(1_700_000_000 * 1000));
    });

    it('reads the period end from the items when the root has none', () => {
      const periodEnd = (adapter as never as {
        periodEndOf: (s: unknown) => Date | null;
      }).periodEndOf({
        items: { data: [{ current_period_end: 1_700_000_000 }, { current_period_end: 1_800_000_000 }] },
      });

      // The latest wins: a subscription with several items renews when its last item does.
      expect(periodEnd).toEqual(new Date(1_800_000_000 * 1000));
    });

    it('returns null rather than an Invalid Date when neither shape carries one', () => {
      const periodEnd = (adapter as never as {
        periodEndOf: (s: unknown) => Date | null;
      }).periodEndOf({ items: { data: [] } });

      expect(periodEnd).toBeNull();
    });

    it.each([
      [{ subscription: 'sub_1' }, 'sub_1'],
      [{ subscription: { id: 'sub_2' } }, 'sub_2'],
      [{ parent: { subscription_details: { subscription: 'sub_3' } } }, 'sub_3'],
      [{ parent: { subscription_details: { subscription: { id: 'sub_4' } } } }, 'sub_4'],
      [{}, null],
    ])('finds the subscription id in %j', (invoice, expected) => {
      const found = (adapter as never as {
        subscriptionIdOf: (i: unknown) => string | null;
      }).subscriptionIdOf(invoice);

      expect(found).toBe(expected);
    });
  });
});
