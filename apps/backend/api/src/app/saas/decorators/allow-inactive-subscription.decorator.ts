import { SetMetadata } from '@nestjs/common';

export const ALLOW_INACTIVE_SUBSCRIPTION_KEY = 'allowInactiveSubscription';

/**
 * Let a route work while the tenant's subscription is suspended.
 *
 * Reserved for the routes a suspended customer must still be able to reach: paying, viewing what
 * they owe, exporting their own data, and signing out. Locking somebody out of the page where they
 * would fix their billing is how a recoverable payment failure becomes a cancellation.
 */
export const AllowInactiveSubscription = () =>
  SetMetadata(ALLOW_INACTIVE_SUBSCRIPTION_KEY, true);
