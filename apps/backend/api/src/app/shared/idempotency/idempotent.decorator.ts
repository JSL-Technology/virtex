import { SetMetadata, UseInterceptors, applyDecorators } from '@nestjs/common';
import { IdempotencyInterceptor } from './idempotency.interceptor';

export const IDEMPOTENT_KEY = 'idempotent';

/**
 * The route may be retried without repeating its effect.
 *
 * ## Why it is not optional on a transition
 *
 * Issuing an invoice posts a journal entry, consumes a fiscal sequence and moves stock. Voiding one
 * reverses all three. None of that is safe to run twice, and running it twice is not a rare event:
 * it is a double click, a proxy retry, a mobile connection that drops after the server committed
 * but before the response arrived. The client cannot tell those apart from a genuine failure, so it
 * retries — correctly — and the ledger ends up with two entries for one sale.
 *
 * The decorator applies the interceptor itself, for the same reason `HasPermission` applies its
 * guard: declaring the requirement and enforcing it have to be one act, or they come apart. This
 * repository has measured that drift three times now — CSRF at "4 of 50", entitlement at "1 of 67",
 * permissions at 47 of 76.
 *
 * A route marked `@Idempotent()` REQUIRES the `Idempotency-Key` header; a request without one is
 * refused rather than executed, because a transition the client cannot safely retry is a transition
 * that will eventually be executed twice.
 */
export const Idempotent = () =>
  applyDecorators(SetMetadata(IDEMPOTENT_KEY, true), UseInterceptors(IdempotencyInterceptor));
