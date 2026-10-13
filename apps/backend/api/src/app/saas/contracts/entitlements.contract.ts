import { SaasResource } from '../enums/saas-resource.enum';

export { CheckFeature } from '../guards/feature-flag.guard';
export { SaasResource } from '../enums/saas-resource.enum';
export type { SaasFeatureKey } from '../saas.config';

/**
 * What another module may ask of the plan: is a capability granted, and may a metered thing happen.
 *
 * The answers live in `SaasService`, which is this module's internals; a feature module that
 * imported it would be coupled to everything else that service does (checkout, Stripe, trials).
 * This port is the two questions it actually needs, bound to the same implementation, so a quota a
 * feature enforces is the same quota the billing screen shows.
 */
export abstract class EntitlementsPort {
  /** Fails closed: no plan, or no row for the feature, answers `false`. */
  abstract checkFeature(organizationId: string, featureKey: string): Promise<boolean>;

  /**
   * Consume `increment` of `resource`, or throw the plan-limit error. In its own transaction, so the
   * counter and the decision commit together; called BEFORE the work it pays for, so concurrent
   * requests cannot each see the last unit free.
   */
  abstract consume(organizationId: string, resource: SaasResource, increment?: number): Promise<void>;
}
