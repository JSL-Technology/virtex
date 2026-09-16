import type {
  CheckoutSessionInfo,
  CheckoutSessionResult,
  CreateRegistrationCheckoutDto,
} from '../../payment/interfaces/payment-gateway.interface';

/**
 * The payment surface registration needs during account signup.
 *
 * ## Why this exists
 *
 * `AuthModule` imported `PaymentModule` via `forwardRef` so `RegistrationService` could inject
 * `PaymentService`. `PaymentModule` in turn imports `AuthModule` for JWT guards on its
 * controller, creating a bidirectional cycle that prevents either from being extracted.
 *
 * Extracting this narrow contract into a port breaks the cycle:
 * - `AuthModule` provides `RegistrationPaymentPort` and expects `PaymentModule` to bind it.
 * - `PaymentService` implements the port and is bound by `PaymentModule`.
 * - The forwardRef in `AuthModule` is replaced by a token import (no cycle).
 *
 * `PaymentModule` still imports `AuthModule` (for guards on its controller); that direction is
 * unchanged. The reverse is eliminated.
 */
export abstract class RegistrationPaymentPort {
  abstract createRegistrationCheckoutSession(
    dto: CreateRegistrationCheckoutDto,
  ): Promise<CheckoutSessionResult>;

  abstract createCheckoutSession(
    organizationId: string,
    userEmail: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<CheckoutSessionResult>;

  abstract getCheckoutSession(sessionId: string): Promise<CheckoutSessionInfo>;

  abstract voidOrphanedSubscription(subscriptionId: string, reason: string): Promise<void>;
}
