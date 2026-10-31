import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { stripeProvider } from './stripe/stripe.provider';
import { Organization } from '../organizations/entities/organization.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { StripePaymentAdapter } from './adapters/stripe-payment.adapter';
import { SimulatedPaymentAdapter } from './adapters/simulated-payment.adapter';
import { AzulPaymentAdapter } from './adapters/azul-payment.adapter';
import { AzulRenewalService } from './azul/azul-renewal.service';
import { AzulController } from './azul/azul.controller';
import { BillingPaymentIntent } from './entities/billing-payment-intent.entity';
import { resolvePaymentProvider } from './payment-provider';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { RegistrationPaymentPort } from '../auth/ports/registration-payment.port';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Organization, WebhookEvent, BillingPaymentIntent]),
    forwardRef(() => AuthModule),
    forwardRef(() => AuditModule),
  ],
  controllers: [PaymentController, AzulController],
  providers: [
    PaymentService,
    // Bind the port token so AuthModule consumers can inject RegistrationPaymentPort without
    // knowing about PaymentService or causing a reverse dependency.
    { provide: RegistrationPaymentPort, useExisting: PaymentService },
    stripeProvider,
    StripePaymentAdapter,
    SimulatedPaymentAdapter,
    AzulPaymentAdapter,
    AzulRenewalService,
    // One gateway per process, chosen once at boot. `resolvePaymentProvider` answers `stripe` or
    // `azul` outside development and test — never `simulated`.
    {
      provide: 'PAYMENT_GATEWAY',
      inject: [ConfigService, StripePaymentAdapter, SimulatedPaymentAdapter, AzulPaymentAdapter],
      useFactory: (
        config: ConfigService,
        stripe: StripePaymentAdapter,
        simulated: SimulatedPaymentAdapter,
        azul: AzulPaymentAdapter,
      ) => {
        const provider = resolvePaymentProvider(config);
        return provider === 'simulated' ? simulated : provider === 'azul' ? azul : stripe;
      },
    }
  ],
  exports: [PaymentService, RegistrationPaymentPort]
})
export class PaymentModule {}
