import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import type { Plan } from '../saas/entities/plan.entity';
import { SaasService } from '../saas/saas.service';
import { SAAS_CONFIG } from '../saas/saas.config';
import { applyDunningWindow, type PlanChange, SubscriptionStanding } from '../saas/plan-change';

/** The payment provider's view of one subscription, read the same way by every adapter. */
export interface SubscriptionSnapshot {
  subscriptionId: string;
  customerId: string | null;
  status: string;
  periodEnd: Date | null;
  /** The plan its price bills; `null` when the price is none of ours, and the plan is left alone. */
  plan: Plan | null;
}

/** The company an organization is billed through, when it does not manage its own billing. */
export interface BillingParent {
  organizationId: string;
  name: string;
}

/**
 * Billing state belongs to the SUBSCRIPTION, not to one organization.
 *
 * A company created under another one is billed through its parent: it copies the parent's
 * subscription and customer when it is created (`OrganizationsService.createSubsidiary`). Every
 * webhook handler located «the» organization with `findOne`, so it updated one company of the
 * group — whichever the database returned first. A cancellation left the rest of the group
 * entitled, a plan change left it on the old plan, and a recovered payment left it locked out.
 *
 * This is the one place billing state is written. It finds every organization a subscription bills
 * and locks them — the browser's return and the webhook race for the same checkout constantly —
 * then records the provider's view on each: status, period, dunning window and plan, the plan
 * through `SaasService.applyPlan`. It returns the organizations whose cached entitlement is now
 * stale, for the caller to invalidate once the transaction has committed.
 */
@Injectable()
export class BillingStateService {
  constructor(private readonly saas: SaasService) {}

  /** Every organization billed through a subscription, locked for the rest of the transaction. */
  organizationsOn(manager: EntityManager, subscriptionId: string): Promise<Organization[]> {
    return manager.find(Organization, {
      where: { externalSubscriptionId: subscriptionId },
      // One lock order for everyone, so two transactions over the same group cannot deadlock.
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /**
   * An organization and every one billed through the same subscription, locked.
   *
   * Read BEFORE the organization moves to a new subscription, so the companies created under it
   * move with it. One statement locks them all in id order; if the subscription changed between
   * the unlocked read and the lock, the group is read again from what is now locked.
   */
  async billedWith(manager: EntityManager, organizationId: string): Promise<Organization[]> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const subscriptionId = (
        await manager.findOne(Organization, { where: { id: organizationId }, select: ['id', 'externalSubscriptionId'] })
      )?.externalSubscriptionId;
      const group = await manager.find(Organization, {
        where: subscriptionId
          ? [{ id: organizationId }, { externalSubscriptionId: subscriptionId }]
          : [{ id: organizationId }],
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      const anchor = group.find((organization) => organization.id === organizationId);
      if (!anchor) return [];
      if ((anchor.externalSubscriptionId ?? null) === (subscriptionId ?? null)) return group;
    }
    // Three changes of subscription inside one transaction's reads is not a race, it is a fault.
    throw new Error(`The subscription of organization ${organizationId} kept changing while its billing group was read.`);
  }

  /**
   * Record the provider's view of a subscription on every organization it bills.
   *
   * The plan moves only while the subscription is in force. A checkout paid with a method that
   * settles later (a bank slip, a cash voucher) completes with an `incomplete` subscription, and
   * the plan it is buying is not the customer's until that payment lands — at which point the
   * provider reports the subscription active and this runs again with the same price.
   *
   * @returns the organizations whose cached entitlement is stale once this commits.
   */
  async record(
    manager: EntityManager,
    organizations: readonly Organization[],
    snapshot: SubscriptionSnapshot,
    change: PlanChange,
  ): Promise<string[]> {
    const planApplies = snapshot.plan !== null && SubscriptionStanding.IN_FORCE.has(snapshot.status);
    for (const organization of organizations) {
      organization.externalSubscriptionId = snapshot.subscriptionId;
      if (snapshot.customerId) organization.externalCustomerId = snapshot.customerId;
      organization.subscriptionStatus = snapshot.status;
      if (snapshot.periodEnd) organization.subscriptionPeriodEnd = snapshot.periodEnd;
      applyDunningWindow(organization, snapshot.status, SAAS_CONFIG.GRACE_PERIOD_DAYS);
      if (planApplies && snapshot.plan) {
        await this.saas.applyPlan(manager, organization, snapshot.plan, change);
      }
      await manager.save(Organization, organization);
    }
    return organizations.map((organization) => organization.id);
  }

  /**
   * The company an organization is billed through, or `null` when it manages its own billing.
   *
   * A company created under another one shares its parent's subscription and customer, and with
   * them the card, the invoices and the provider's portal. Its own administrator is not the
   * parent's — so a subsidiary that could open the portal saw and changed the parent's card, and
   * one that could change plan changed the whole group's. Billing is managed where it is paid.
   * A company linked under a parent after the fact keeps its own subscription, and its own billing.
   */
  async billingParentOf(manager: EntityManager, organizationId: string): Promise<BillingParent | null> {
    const [row]: Array<{ id: string; legal_name: string }> = await manager.query(
      `SELECT p.id, p.legal_name
         FROM organization_subsidiaries s
         JOIN organizations o ON o.id = s.subsidiary_organization_id
         JOIN organizations p ON p.id = s.parent_organization_id
        WHERE s.subsidiary_organization_id = $1
          AND (   (o.external_subscription_id IS NOT NULL AND o.external_subscription_id = p.external_subscription_id)
               OR (o.external_customer_id IS NOT NULL AND o.external_customer_id = p.external_customer_id))
        LIMIT 1`,
      [organizationId],
    );
    return row ? { organizationId: row.id, name: row.legal_name } : null;
  }
}
