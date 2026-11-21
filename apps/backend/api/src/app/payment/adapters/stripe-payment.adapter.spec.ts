import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type Stripe from 'stripe';
import { StripePaymentAdapter } from './stripe-payment.adapter';
import { STRIPE_CLIENT } from '../stripe/stripe.provider';
import { Organization } from '../../organizations/entities/organization.entity';
import { SaasService } from '../../saas/saas.service';
import { BillingStateService } from '../billing-state.service';
import { PlanChangeReason } from '../../saas/plan-change';
import type { StartPlanChangeRequest } from '../payment-gateway.port';

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
 * customer, or the ledger, is quietly wrong. The billing state is written by the REAL
 * `BillingStateService` over a recording entity manager, so the dunning window and the plan rules
 * asserted here are the ones production runs; `billing-state.integration.spec.ts` proves the same
 * writes against PostgreSQL with its row-level policies on.
 */
describe('StripePaymentAdapter', () => {
  let adapter: StripePaymentAdapter;

  const stripe = {
    webhooks: { constructEvent: jest.fn() },
    subscriptions: { retrieve: jest.fn(), cancel: jest.fn() },
    invoices: { list: jest.fn() },
    refunds: { create: jest.fn() },
    checkout: { sessions: { retrieve: jest.fn(), create: jest.fn() } },
    billingPortal: { sessions: { create: jest.fn() } },
    prices: { retrieve: jest.fn() },
    customers: { create: jest.fn(), retrieve: jest.fn() },
  };

  const starter = { id: 'plan-starter', slug: 'starter' };
  const pro = { id: 'plan-pro', slug: 'pro' };
  const plansByPrice: Record<string, typeof starter> = { price_starter: starter, price_pro: pro };

  const order: string[] = [];
  const organizationRepository = { findOne: jest.fn(), save: jest.fn(), update: jest.fn() };
  const saasService = {
    clearOrganizationCache: jest.fn(async (id: string) => void order.push(`invalidate:${id}`)),
    planForPrice: jest.fn(async (priceId?: string | null) => (priceId ? plansByPrice[priceId] ?? null : null)),
    applyPlan: jest.fn(async (_m: unknown, organization: { planId?: string | null }, plan: { id: string }) => {
      const changed = organization.planId !== plan.id;
      organization.planId = plan.id;
      return changed;
    }),
    getPlans: jest.fn().mockResolvedValue([]),
  };
  const eventEmitter = { emit: jest.fn(), emitAsync: jest.fn() };

  /**
   * The entity manager handed to `dataSource.transaction`. `find` answers «who carries this
   * subscription» from `group`; `query` answers the billed-through-parent lookup from `parentOf`.
   */
  let group: Array<Record<string, unknown>> = [];
  let parentOf: Record<string, { id: string; legal_name: string }> = {};
  /** Event ids already claimed by an earlier delivery. */
  let claimedEvents = new Set<string>();
  const manager = {
    findOne: jest.fn(),
    find: jest.fn(async () => group),
    save: jest.fn(async (_entity: unknown, row: unknown) => row),
    query: jest.fn(async (sql: string, [id]: [string]) => {
      if (sql.includes('payment_webhook_events')) {
        if (claimedEvents.has(id)) return [];
        claimedEvents.add(id);
        return [{ id }];
      }
      return parentOf[id] ? [parentOf[id]] : [];
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (cb: (m: unknown) => unknown) => {
      const result = await cb(manager);
      order.push('commit');
      return result;
    }),
  };

  const subscription = (over: Partial<Stripe.Subscription> & { prices?: string[] } = {}) => {
    const { prices = ['price_starter'], ...rest } = over;
    return {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      items: { data: prices.map((price, index) => ({ id: `si_${index}`, quantity: 1, price: { id: price } })) },
      ...rest,
    };
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    order.length = 0;
    group = [];
    parentOf = {};
    claimedEvents = new Set();
    manager.findOne.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripePaymentAdapter,
        BillingStateService,
        { provide: STRIPE_CLIENT, useValue: stripe },
        { provide: getRepositoryToken(Organization), useValue: organizationRepository },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => (key === 'STRIPE_WEBHOOK_SECRET' ? 'whsec_test' : undefined)),
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
      claimedEvents.add('evt_1'); // an earlier delivery claimed it
      group = [{ id: 'org-1', gracePeriodEnd: null }];
      stripe.subscriptions.retrieve.mockResolvedValue(subscription());

      await expect(
        signedEvent({ id: 'evt_1', type: 'invoice.paid', data: { object: { subscription: 'sub_1' } } } as never),
      ).resolves.toMatchObject({ processed: true });

      // The webhook and the browser redirect race constantly, and Stripe retries on any non-2xx.
      expect(manager.save).not.toHaveBeenCalled();
      expect(saasService.clearOrganizationCache).not.toHaveBeenCalled();
    });

    it('claims the event before it does any of the work', async () => {
      group = [{ id: 'org-1', gracePeriodEnd: null }];
      stripe.subscriptions.retrieve.mockResolvedValue(subscription());

      await signedEvent({ id: 'evt_claim', type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } } as never);

      // First statement of the transaction: an atomic claim, not a read followed by a late insert.
      expect(manager.query.mock.calls[0][0]).toMatch(/INSERT INTO "payment_webhook_events".*ON CONFLICT \("id"\) DO NOTHING/);
      expect(manager.find.mock.invocationCallOrder[0]).toBeGreaterThan(manager.query.mock.invocationCallOrder[0]);
    });
  });

  describe('a plan changed at Stripe reaches the product', () => {
    it('moves the plan when the subscription’s price changes', async () => {
      // The customer moved from Starter to Pro on Stripe's page. The handler synced the status and
      // the period and ignored the price, so Stripe charged Pro and the product enforced Starter.
      const organization = { id: 'org-1', planId: starter.id, gracePeriodEnd: null };
      group = [organization];
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ prices: ['price_pro'] }));

      await signedEvent({
        id: 'evt_plan',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1' } },
      } as never);

      expect(saasService.applyPlan).toHaveBeenCalledWith(manager, organization, pro, {
        reason: PlanChangeReason.PROVIDER_UPDATE,
        changedBy: null,
      });
      expect(organization.planId).toBe(pro.id);
    });

    it('reads the subscription as Stripe has it NOW, not as the event froze it', async () => {
      // Events arrive out of order. The payload of an older event says Starter; Stripe says Pro.
      group = [{ id: 'org-1', planId: pro.id, gracePeriodEnd: null }];
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ prices: ['price_pro'] }));

      await signedEvent({
        id: 'evt_old',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1', items: { data: [{ price: { id: 'price_starter' } }] } } },
      } as never);

      expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_1');
      expect(saasService.applyPlan).toHaveBeenCalledWith(manager, expect.anything(), pro, expect.anything());
    });

    it('reaches every organization billed through the subscription, not one of them', async () => {
      // A subsidiary created under its parent carries the parent's subscription. `findOne` updated
      // whichever the database returned: a cancellation left the rest of the group entitled.
      const parent = { id: 'org-parent', subscriptionStatus: 'active', gracePeriodEnd: null };
      const subsidiary = { id: 'org-sub', subscriptionStatus: 'active', gracePeriodEnd: null };
      group = [parent, subsidiary];
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'canceled' }));

      await signedEvent({
        id: 'evt_cancel',
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_1' } },
      } as never);

      expect(parent.subscriptionStatus).toBe('canceled');
      expect(subsidiary.subscriptionStatus).toBe('canceled');
      expect(saasService.clearOrganizationCache).toHaveBeenCalledWith('org-parent');
      expect(saasService.clearOrganizationCache).toHaveBeenCalledWith('org-sub');
    });

    it('does not apply the plan of a subscription that is not in force', async () => {
      // A checkout paid by bank slip completes `incomplete`: the plan is not the customer's until
      // the payment lands and Stripe reports the subscription active.
      const organization = { id: 'org-1', planId: starter.id, gracePeriodEnd: null };
      group = [organization];
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'incomplete', prices: ['price_pro'] }));

      await signedEvent({
        id: 'evt_incomplete',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1' } },
      } as never);

      expect(saasService.applyPlan).not.toHaveBeenCalled();
      expect(organization.planId).toBe(starter.id);
    });

    it('invalidates the cached entitlement only after the change has committed', async () => {
      // Inside the transaction, a concurrent request could cache the OLD plan again before the
      // new one was visible, and keep serving it for a full TTL.
      group = [{ id: 'org-1', planId: starter.id, gracePeriodEnd: null }];
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ prices: ['price_pro'] }));

      await signedEvent({ id: 'evt_order', type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } } as never);

      expect(order).toEqual(['commit', 'invalidate:org-1']);
    });

    it('a cache outage after the commit does not fail the webhook', async () => {
      // The database is already right; failing would make Stripe redeliver an event that is now
      // recorded as processed, and the cached principal expires on its own.
      group = [{ id: 'org-1', planId: starter.id, gracePeriodEnd: null }];
      stripe.subscriptions.retrieve.mockResolvedValue(subscription());
      saasService.clearOrganizationCache.mockRejectedValueOnce(new Error('redis down'));

      await expect(
        signedEvent({ id: 'evt_redis', type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } } as never),
      ).resolves.toMatchObject({ processed: true });
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
      const organization = { id: 'org-1', gracePeriodEnd: null as Date | null, subscriptionStatus: 'active' };
      group = [organization];
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'past_due' }));

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
        expect.objectContaining({ organizationId: 'org-1', gracePeriodEnd: organization.gracePeriodEnd }),
      );
    });

    it('a second failed retry leaves the window where the first one opened it', async () => {
      // It used to be reset to «now + N days» on every failure, so the bounded grace period lasted
      // as long as Stripe kept retrying, plus N days.
      const opened = new Date(Date.now() + 2 * 24 * 3_600_000);
      const organization = { id: 'org-1', gracePeriodEnd: opened, subscriptionStatus: 'past_due' };
      group = [organization];
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'past_due' }));

      await signedEvent({ id: 'evt_retry', type: 'invoice.payment_failed', data: { object: invoice } } as never);

      expect(organization.gracePeriodEnd).toBe(opened);
    });

    it('never shortens a grace period that is already running', async () => {
      const farFuture = new Date(Date.now() + 90 * 24 * 3_600_000);
      const organization = {
        id: 'org-1',
        gracePeriodEnd: farFuture,
        subscriptionStatus: 'past_due',
      };
      group = [organization];
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'unpaid' }));

      await signedEvent({
        id: 'evt_3',
        type: 'invoice.payment_failed',
        data: { object: invoice },
      } as never);

      // Neither a failed retry nor the subscription turning `unpaid` cuts short a window an
      // operator granted deliberately.
      expect(organization.gracePeriodEnd).toBe(farFuture);
    });

    it('clears the grace period when the customer recovers, and invalidates the cache', async () => {
      const organization = {
        id: 'org-1',
        gracePeriodEnd: new Date() as Date | null,
        subscriptionStatus: 'past_due',
      };
      group = [organization];
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'active' }));

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

    it('tells the company that pays, not every company billed through it', async () => {
      group = [
        { id: 'org-parent', gracePeriodEnd: null },
        { id: 'org-sub', gracePeriodEnd: null },
      ];
      parentOf = { 'org-sub': { id: 'org-parent', legal_name: 'QA Matriz' } };
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'past_due' }));

      await signedEvent({ id: 'evt_5', type: 'invoice.payment_failed', data: { object: invoice } } as never);

      const notified = eventEmitter.emit.mock.calls.map(([, payload]) => (payload as { organizationId: string }).organizationId);
      expect(notified).toEqual(['org-parent']);
    });
  });

  describe('changing plan from inside the product', () => {
    const request: StartPlanChangeRequest = {
      organizationId: 'org-1',
      actorUserId: 'user-1',
      userEmail: 'qa@example.com',
      priceId: 'price_pro',
      successUrl: 'https://app/settings/billing?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://app/settings/billing',
      planChangedUrl: 'https://app/settings/billing?plan_change=confirmed',
    };

    it('changes the subscription in force instead of buying a second one', async () => {
      // Every in-app plan change opened a Checkout in `subscription` mode, which CREATES a
      // subscription: two of them billed, and the older one's events matched no organization.
      organizationRepository.findOne.mockResolvedValue({ id: 'org-1', externalSubscriptionId: 'sub_1', externalCustomerId: 'cus_1' });
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'active', prices: ['price_starter'] }));
      stripe.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.com/flow' });

      await expect(adapter.startPlanChange(request)).resolves.toEqual({
        flow: 'subscription_update',
        url: 'https://billing.stripe.com/flow',
      });
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
      expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_1',
          flow_data: expect.objectContaining({
            type: 'subscription_update_confirm',
            subscription_update_confirm: { subscription: 'sub_1', items: [{ id: 'si_0', price: 'price_pro', quantity: 1 }] },
            after_completion: { type: 'redirect', redirect: { return_url: request.planChangedUrl } },
          }),
        }),
      );
    });

    it('asks for an unsettled subscription to be settled first', async () => {
      organizationRepository.findOne.mockResolvedValue({ id: 'org-1', externalSubscriptionId: 'sub_1' });
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'unpaid' }));

      await expect(adapter.startPlanChange(request)).rejects.toBeInstanceOf(ConflictException);
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
      expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    });

    it('refuses to «change» to the plan the subscription already bills', async () => {
      organizationRepository.findOne.mockResolvedValue({ id: 'org-1', externalSubscriptionId: 'sub_1' });
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ prices: ['price_pro'] }));

      await expect(adapter.startPlanChange(request)).rejects.toBeInstanceOf(ConflictException);
    });

    it('buys a subscription when none is in force, in the market currency, naming who asked', async () => {
      organizationRepository.findOne.mockResolvedValue({
        id: 'org-1',
        country: 'US',
        externalSubscriptionId: 'sub_old',
        externalCustomerId: 'cus_1',
      });
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ id: 'sub_old', status: 'canceled' }));
      stripe.checkout.sessions.create.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' });

      await expect(adapter.startPlanChange(request)).resolves.toEqual({ flow: 'checkout', url: 'https://checkout.stripe.com/cs_1' });
      const params = stripe.checkout.sessions.create.mock.calls[0][0];
      expect(params).toMatchObject({
        customer: 'cus_1',
        mode: 'subscription',
        line_items: [{ price: 'price_pro', quantity: 1 }],
        currency: 'usd',
        metadata: { organizationId: 'org-1', planSlug: 'pro', initiatedBy: 'user-1' },
        subscription_data: { metadata: { organizationId: 'org-1', planSlug: 'pro', initiatedBy: 'user-1' } },
      });
      // The market's own methods (`markets/us/payments.ts`), not a table in this adapter.
      expect(params.payment_method_types).toEqual(['card', 'us_bank_account']);
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

    it('records a paid checkout on the whole group, naming who bought it', async () => {
      const anchor = { id: 'org-1', planId: starter.id, externalSubscriptionId: 'sub_old', gracePeriodEnd: null };
      const subsidiary = { id: 'org-2', planId: starter.id, externalSubscriptionId: 'sub_old', gracePeriodEnd: null };
      stripe.checkout.sessions.retrieve.mockResolvedValue({
        metadata: { organizationId: 'org-1', initiatedBy: 'user-1' },
        status: 'complete',
        payment_status: 'paid',
        subscription: subscription({ id: 'sub_new', prices: ['price_pro'] }),
      });
      manager.findOne.mockResolvedValue({ id: 'org-1', externalSubscriptionId: 'sub_old' });
      group = [anchor, subsidiary];
      organizationRepository.findOne.mockResolvedValue({ id: 'org-1', plan: pro, subscriptionStatus: 'active' });

      await adapter.confirmOrganizationCheckout('org-1', 'cs_test_3');

      // The companies billed through the old subscription move to the new one with it.
      expect(anchor.externalSubscriptionId).toBe('sub_new');
      expect(subsidiary.externalSubscriptionId).toBe('sub_new');
      expect(saasService.applyPlan).toHaveBeenCalledWith(manager, anchor, pro, { reason: PlanChangeReason.CHECKOUT, changedBy: 'user-1' });
      expect(saasService.applyPlan).toHaveBeenCalledWith(manager, subsidiary, pro, { reason: PlanChangeReason.CHECKOUT, changedBy: 'user-1' });
      expect(order).toEqual(['commit', 'invalidate:org-1', 'invalidate:org-2']);
    });
  });

  describe('compensating a charge whose account could not be created', () => {
    it('cancels first and refunds second', async () => {
      const steps: string[] = [];
      stripe.subscriptions.cancel.mockImplementation(async () => void steps.push('cancel'));
      stripe.invoices.list.mockResolvedValue({
        data: [{ amount_paid: 4900, payment_intent: 'pi_1' }],
      });
      stripe.refunds.create.mockImplementation(async () => void steps.push('refund'));

      await adapter.voidOrphanedSubscription('sub_1', 'materialisation failed');

      // Stopping the recurring charge is the part that must not be missed; a refund can be issued
      // by hand later, whereas an uncancelled subscription bills a stranger every month.
      expect(steps).toEqual(['cancel', 'refund']);
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
