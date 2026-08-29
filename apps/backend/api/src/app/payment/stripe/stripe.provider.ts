import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

export const STRIPE_CLIENT = 'STRIPE_CLIENT';

export const stripeProvider: Provider = {
  provide: STRIPE_CLIENT,
  useFactory: (configService: ConfigService) => {
    const secretKey = configService.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
        return null;
    }
    return new Stripe(secretKey, {
      // Pinned to whatever the installed SDK declares, so upgrading the package cannot leave the
      // client announcing a version it no longer implements.
      apiVersion: Stripe.API_VERSION as Stripe.StripeConfig['apiVersion'],
    });
  },
  inject: [ConfigService],
};
