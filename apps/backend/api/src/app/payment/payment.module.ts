import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { stripeProvider } from './stripe/stripe.provider';
import { Organization } from '../organizations/entities/organization.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { SaasModule } from '../saas/saas.module';
import { StripePaymentAdapter } from './adapters/stripe-payment.adapter';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Organization, WebhookEvent])
  ],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    stripeProvider,
    {
      provide: 'PAYMENT_GATEWAY',
      useClass: StripePaymentAdapter
    }
  ],
  exports: [PaymentService]
})
export class PaymentModule {}
