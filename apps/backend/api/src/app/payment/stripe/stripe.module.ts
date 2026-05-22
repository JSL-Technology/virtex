import { Module } from '@nestjs/common';
import { stripeProvider } from './stripe.provider';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [stripeProvider],
  exports: [stripeProvider],
})
export class StripeModule {}
