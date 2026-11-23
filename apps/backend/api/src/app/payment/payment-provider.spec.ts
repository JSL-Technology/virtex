import { ConfigService } from '@nestjs/config';
import { choosePaymentGateway } from './payment-provider';

/**
 * The gateway a process charges through, and the signal that tells an operator which (IAM-P2).
 *
 * The configuration rules make the simulated provider unreachable in a deployment. What they cannot
 * stop is a deployment started with `NODE_ENV=development` by mistake — and that box would hand out
 * subscriptions without charging, with nothing to say so. `payment_provider_info` is what an alert
 * watches.
 */
describe('choosePaymentGateway', () => {
  const originalEnv = process.env['NODE_ENV'];
  afterEach(() => {
    process.env['NODE_ENV'] = originalEnv;
  });

  const config = (values: Record<string, string | undefined>) =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigService;
  const gauge = () => {
    const set = jest.fn();
    return { labels: jest.fn(() => ({ set })), set };
  };
  const gateways = { stripe: 'stripe-adapter', simulated: 'simulated-adapter' };

  it('publishes the simulated provider, so a deployment running it can be alerted on', () => {
    process.env['NODE_ENV'] = 'development';
    const info = gauge();

    expect(choosePaymentGateway(config({}), gateways, info)).toBe('simulated-adapter');
    expect(info.labels).toHaveBeenCalledWith('simulated');
    expect(info.set).toHaveBeenCalledWith(1);
  });

  it('a deployment charges through Stripe whatever it asks for', () => {
    process.env['NODE_ENV'] = 'production';
    const info = gauge();

    expect(choosePaymentGateway(config({ PAYMENT_PROVIDER: 'simulated' }), gateways, info)).toBe('stripe-adapter');
    expect(info.labels).toHaveBeenCalledWith('stripe');
  });
});
