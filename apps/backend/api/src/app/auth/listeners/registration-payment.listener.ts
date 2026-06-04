import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RegistrationService } from '../services/registration.service';
import { RegistrationPaymentCompletedEvent } from '../../payment/events/registration-payment-completed.event';

/**
 * Bridges a successful signup payment (emitted by the payment webhook) to
 * account creation. Lives in the auth module so payment stays decoupled from
 * auth. Account materialization is idempotent, so this can safely race with the
 * frontend confirm/reconcile call.
 */
@Injectable()
export class RegistrationPaymentListener {
  private readonly logger = new Logger(RegistrationPaymentListener.name);

  constructor(private readonly registrationService: RegistrationService) {}

  @OnEvent('registration.payment_completed')
  async handle(event: RegistrationPaymentCompletedEvent): Promise<void> {
    try {
      await this.registrationService.completePendingRegistration(event.pendingRegistrationId, event.subscription);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`Failed to materialize account for pending registration ${event.pendingRegistrationId}: ${message}`);
      throw e; // Let Stripe retry the webhook.
    }
  }
}
