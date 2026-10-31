import { ConfigService } from '@nestjs/config';
import { isDevLikeEnvironment } from '../config/environment';

/**
 * Which payment processor backs subscriptions.
 *
 * - `stripe`: the real processor. The only value a deployment accepts.
 * - `simulated`: development and test only. Checkouts complete immediately without charging
 *   anything, so signup, plan changes and the billing screen can be exercised end to end on a
 *   machine with no Stripe account. Before it existed a local run could not create an account
 *   through the interface at all: the last step answered with a generic error because the plan had
 *   no Stripe price.
 */
export type PaymentProvider = 'stripe' | 'simulated' | 'azul';

/**
 * - `azul`: Azul, the Dominican acquirer (Banco Popular). For a platform company established in the
 *   Dominican Republic, which Stripe does not take as a merchant, charging customers in pesos.
 */
export const PAYMENT_PROVIDERS: readonly PaymentProvider[] = ['stripe', 'simulated', 'azul'];

/**
 * The provider this process uses.
 *
 * `env.validation.ts` already refuses `simulated` outside development and test; this repeats the
 * rule at the point of use so that no configuration path, however it was reached, can make a
 * deployment hand out subscriptions without charging for them.
 */
export function resolvePaymentProvider(config: ConfigService): PaymentProvider {
  const configured = config.get<string>('PAYMENT_PROVIDER');
  if (configured === 'azul') return 'azul';
  if (!isDevLikeEnvironment()) return 'stripe';
  if (configured === 'stripe' || configured === 'simulated') return configured;
  return config.get<string>('STRIPE_SECRET_KEY') ? 'stripe' : 'simulated';
}
