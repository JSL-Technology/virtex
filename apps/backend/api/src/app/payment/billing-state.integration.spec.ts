import { DataSource, EntityManager } from 'typeorm';
import { BillingStateService, type SubscriptionSnapshot } from './billing-state.service';
import { SaasService } from '../saas/saas.service';
import { Plan } from '../saas/entities/plan.entity';
import { PlanChangeReason } from '../saas/plan-change';
import { Organization } from '../organizations/entities/organization.entity';
import { actAsTenantWithin } from '../shared/tenancy/tenant-job';
import { StripePaymentAdapter } from './adapters/stripe-payment.adapter';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * Billing state, written the way a payment webhook writes it: as the application's role, with the
 * row-level policies on, and NO tenant in context.
 *
 * Three defects meet here. `organization_subscription_history` had no rows in any environment,
 * because the only method that wrote it was called by nothing — and had it been called from a
 * webhook, the insert would have been refused: the table is isolated per tenant, and a webhook has
 * no tenant. A subsidiary billed through its parent kept the old plan, or stayed entitled after a
 * cancellation, because each handler updated ONE organization of the group. And the dunning window
 * moved forward with every failed retry.
 *
 * Against the migrated schema, as `virtex_app`: as the table owner the policies do not apply and
 * every assertion about them would pass for the wrong reason.
 */
describeWithDb('billing state is written once, for every organization a subscription bills', () => {
  let ds: DataSource;
  let saas: SaasService;
  let billing: BillingStateService;
  let parentId: string;
  let subsidiaryId: string;
  let independentId: string;
  let starter: Plan;
  let pro: Plan;
  const subscriptionId = `sub_qa_${Date.now()}`;

  /** A transaction as the application's role, with no tenant — what a webhook gets. */
  const asWebhook = <T>(work: (manager: EntityManager) => Promise<T>): Promise<T> =>
    ds.transaction(async (manager) => {
      await manager.query(`SET LOCAL ROLE virtex_app`);
      await manager.query(`SELECT set_config('app.current_organization', '', true)`);
      return work(manager);
    });

  const snapshot = (over: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot => ({
    subscriptionId,
    customerId: 'cus_qa',
    status: 'active',
    periodEnd: new Date(Date.now() + 30 * 24 * 3_600_000),
    plan: pro,
    ...over,
  });

  const history = async (organizationId: string) =>
    ds.query(
      `SELECT previous_plan_id, new_plan_id, reason, changed_by FROM organization_subscription_history
        WHERE organization_id = $1 ORDER BY created_at, id`,
      [organizationId],
    );

  beforeAll(async () => {
    ds = await openTestDataSource();
    starter = await ds.getRepository(Plan).findOneByOrFail({ slug: 'starter' });
    pro = await ds.getRepository(Plan).findOneByOrFail({ slug: 'pro' });

    parentId = await createTestOrganization(ds, 'QA billing parent');
    subsidiaryId = await createTestOrganization(ds, 'QA billing subsidiary');
    independentId = await createTestOrganization(ds, 'QA billing linked');
    // The parent and the subsidiary created under it share one subscription and one customer; the
    // company linked afterwards keeps its own.
    await ds.query(
      `UPDATE organizations SET plan_id = $1, subscription_status = 'active', external_subscription_id = $2, external_customer_id = 'cus_qa'
        WHERE id = ANY($3)`,
      [starter.id, subscriptionId, [parentId, subsidiaryId]],
    );
    await ds.query(
      `UPDATE organizations SET plan_id = $1, subscription_status = 'active', external_subscription_id = 'sub_qa_own', external_customer_id = 'cus_qa_own'
        WHERE id = $2`,
      [starter.id, independentId],
    );
    await ds.query(
      `INSERT INTO organization_subsidiaries (parent_organization_id, subsidiary_organization_id, ownership) VALUES ($1, $2, 100), ($1, $3, 60)`,
      [parentId, subsidiaryId, independentId],
    );

    // `applyPlan` needs nothing of the service but its logger; the rest is never touched.
    saas = new SaasService(
      ds.getRepository(Plan), {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, ds, {} as never, {} as never, {} as never,
    );
    billing = new BillingStateService(saas);
  }, 60_000);

  const eventId = `evt_qa_${Date.now()}`;

  // Deleting a company cascades through every table it owns: well past Jest's default five seconds.
  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM payment_webhook_events WHERE id = $1`, [eventId]);
      await ds.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[subsidiaryId, independentId]]);
    }
    await dropTestOrganization(ds, parentId);
  }, 120_000);

  it('a plan change reaches the whole group and is recorded for each company — as the webhook role, with no tenant', async () => {
    await asWebhook(async (manager) => {
      const group = await billing.organizationsOn(manager, subscriptionId);
      expect(group.map((o) => o.id).sort()).toEqual([parentId, subsidiaryId].sort());
      await billing.record(manager, group, snapshot(), { reason: PlanChangeReason.PROVIDER_UPDATE, changedBy: null });
      // The tenant context the transaction had is the one it has after: none.
      const [{ tenant }] = await manager.query(`SELECT current_setting('app.current_organization', true) AS tenant`);
      expect(tenant).toBe('');
    });

    const plans = await ds.query(`SELECT id, plan_id FROM organizations WHERE id = ANY($1)`, [[parentId, subsidiaryId, independentId]]);
    const planOf = Object.fromEntries(plans.map((row: { id: string; plan_id: string }) => [row.id, row.plan_id]));
    expect(planOf[parentId]).toBe(pro.id);
    expect(planOf[subsidiaryId]).toBe(pro.id);
    // A company with its own subscription is not part of the group.
    expect(planOf[independentId]).toBe(starter.id);

    for (const id of [parentId, subsidiaryId]) {
      expect(await history(id)).toEqual([
        { previous_plan_id: starter.id, new_plan_id: pro.id, reason: 'provider_update', changed_by: null },
      ]);
    }
  });

  it('recording the same subscription again writes nothing: the browser and the webhook can both arrive', async () => {
    await asWebhook(async (manager) =>
      billing.record(manager, await billing.organizationsOn(manager, subscriptionId), snapshot(), {
        reason: PlanChangeReason.CHECKOUT,
        changedBy: 'someone',
      }),
    );
    expect(await history(parentId)).toHaveLength(1);
    expect(await history(subsidiaryId)).toHaveLength(1);
  });

  it('the dunning window opens on the first failure and does not move on the next one', async () => {
    const graceOf = async () =>
      (await ds.query(`SELECT grace_period_end FROM organizations WHERE id = $1`, [parentId]))[0].grace_period_end as Date | null;

    await asWebhook(async (manager) =>
      billing.record(manager, await billing.organizationsOn(manager, subscriptionId), snapshot({ status: 'past_due' }), {
        reason: PlanChangeReason.PROVIDER_UPDATE,
      }),
    );
    const opened = await graceOf();
    expect(opened).toBeInstanceOf(Date);

    await asWebhook(async (manager) =>
      billing.record(manager, await billing.organizationsOn(manager, subscriptionId), snapshot({ status: 'unpaid' }), {
        reason: PlanChangeReason.PROVIDER_UPDATE,
      }),
    );
    expect((await graceOf())?.getTime()).toBe(opened?.getTime());

    await asWebhook(async (manager) =>
      billing.record(manager, await billing.organizationsOn(manager, subscriptionId), snapshot({ status: 'active' }), {
        reason: PlanChangeReason.PROVIDER_UPDATE,
      }),
    );
    expect(await graceOf()).toBeNull();
  });

  it('a subscription that is not in force does not move the plan', async () => {
    await asWebhook(async (manager) =>
      billing.record(manager, await billing.organizationsOn(manager, subscriptionId), snapshot({ status: 'incomplete', plan: starter }), {
        reason: PlanChangeReason.CHECKOUT,
      }),
    );
    const [{ plan_id }] = await ds.query(`SELECT plan_id FROM organizations WHERE id = $1`, [parentId]);
    expect(plan_id).toBe(pro.id);
    await asWebhook(async (manager) =>
      billing.record(manager, await billing.organizationsOn(manager, subscriptionId), snapshot({ status: 'active' }), {
        reason: PlanChangeReason.PROVIDER_UPDATE,
      }),
    );
  });

  it('a new subscription for the parent moves the companies billed through the old one with it', async () => {
    const renewed = `${subscriptionId}_new`;
    await asWebhook(async (manager) => {
      const group = await billing.billedWith(manager, parentId);
      expect(group.map((o) => o.id).sort()).toEqual([parentId, subsidiaryId].sort());
      await billing.record(manager, group, snapshot({ subscriptionId: renewed }), { reason: PlanChangeReason.CHECKOUT });
    });
    const rows = await ds.query(`SELECT external_subscription_id FROM organizations WHERE id = ANY($1)`, [[parentId, subsidiaryId]]);
    expect(rows.map((row: { external_subscription_id: string }) => row.external_subscription_id)).toEqual([renewed, renewed]);
    await ds.query(`UPDATE organizations SET external_subscription_id = $1 WHERE id = ANY($2)`, [subscriptionId, [parentId, subsidiaryId]]);
  });

  it('knows which companies are billed through their parent, and which manage their own billing', async () => {
    const manager = ds.manager;
    await expect(billing.billingParentOf(manager, subsidiaryId)).resolves.toEqual({
      organizationId: parentId,
      name: expect.stringContaining('QA billing parent'),
    });
    await expect(billing.billingParentOf(manager, parentId)).resolves.toBeNull();
    // Linked under the parent, but paying for itself.
    await expect(billing.billingParentOf(manager, independentId)).resolves.toBeNull();
  });

  it('acting as a tenant needs a transaction to act in', async () => {
    await expect(actAsTenantWithin(ds.manager, parentId, async () => undefined)).rejects.toThrow(/caller's transaction/);
  });

  it('the history row is refused without acting as its tenant — which is why the one writer does', async () => {
    await expect(
      asWebhook((manager) =>
        manager.query(
          `INSERT INTO organization_subscription_history (organization_id, previous_plan_id, new_plan_id, reason) VALUES ($1, $2, $3, 'provider_update')`,
          [parentId, starter.id, pro.id],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    // Nothing but the one row of the first change.
    expect(await history(parentId)).toHaveLength(1);
    // And the organizations kept the plan the provider bills.
    const [{ plan_id }] = await ds.query(`SELECT plan_id FROM organizations WHERE id = $1`, [parentId]);
    expect(plan_id).toBe(pro.id);
  });

  it('two deliveries of one event at the same time: one does the work, neither fails', async () => {
    // Before, both passed a `findOne`, both did the work, and the second failed on the primary key
    // at the end — rolled back, answered 500 and redelivered by Stripe (IAM-P3). Now the first
    // statement claims the event, and the second delivery waits on that claim and finds it taken.
    const event = {
      id: eventId,
      type: 'customer.subscription.updated',
      data: { object: { id: subscriptionId } },
    };
    const stripe = {
      webhooks: { constructEvent: () => event },
      subscriptions: {
        retrieve: async () => ({
          id: subscriptionId,
          customer: 'cus_qa',
          status: 'active',
          items: { data: [{ id: 'si_qa', quantity: 1, price: { id: starter.monthlyPriceId } }] },
        }),
      },
    };
    // The adapter's own transactions, run as the application's role: the policies apply.
    const asApplication = {
      transaction: <T>(work: (manager: EntityManager) => Promise<T>) =>
        ds.transaction(async (manager) => {
          await manager.query(`SET LOCAL ROLE virtex_app`);
          return work(manager);
        }),
    };
    saas.clearOrganizationCache = jest.fn(async () => undefined);
    const adapter = new StripePaymentAdapter(
      stripe as never,
      ds.getRepository(Organization),
      { get: (key: string) => (key === 'STRIPE_WEBHOOK_SECRET' ? 'whsec_qa' : undefined) } as never,
      asApplication as never,
      saas,
      billing,
      { emit: jest.fn(), emitAsync: jest.fn() } as never,
    );
    const before = (await history(parentId)).length;

    const deliveries = await Promise.allSettled([
      adapter.handleWebhook(Buffer.from('{}'), 'sig'),
      adapter.handleWebhook(Buffer.from('{}'), 'sig'),
    ]);

    expect(deliveries.map((delivery) => delivery.status)).toEqual(['fulfilled', 'fulfilled']);
    // Exactly one change recorded per company, not one per delivery.
    for (const id of [parentId, subsidiaryId]) {
      const rows = await history(id);
      expect(rows).toHaveLength(before + 1);
      expect(rows[rows.length - 1]).toMatchObject({ new_plan_id: starter.id, reason: 'provider_update' });
    }
    const [{ count }] = await ds.query(`SELECT COUNT(*)::int AS count FROM payment_webhook_events WHERE id = $1`, [eventId]);
    expect(count).toBe(1);
  }, 60_000);
});
