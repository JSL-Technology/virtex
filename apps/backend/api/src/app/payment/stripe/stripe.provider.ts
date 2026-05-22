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
      apiVersion: '2025-01-27.acacia', // Ensure this matches expected version
    });
  },
  inject: [ConfigService],
};
