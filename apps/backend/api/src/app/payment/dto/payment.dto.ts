import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BILLING_PERIODS, type BillingPeriod } from '../../saas/enums/billing-period.enum';

/**
 * Start a Checkout session for an existing organization.
 *
 * The client names a plan; it does not name a Stripe price and it does not choose the redirect
 * targets. Both used to be free-form strings on the request body that went straight to Stripe,
 * which turned this endpoint into an attacker-controlled redirect issued from a real payment
 * processor's origin, and let any caller subscribe to any price on the account. The server
 * resolves the price from the plan and builds the URLs from FRONTEND_URL.
 */
export class CreateCheckoutSessionDto {
  @ApiProperty({ example: 'pro', description: 'Slug of the plan to subscribe to' })
  @IsString({ message: 'VALIDATION.PAYMENT.PLAN_SELECCIONADO_NO_VALIDO' })
  @IsNotEmpty({ message: 'VALIDATION.PAYMENT.DEBES_SELECCIONAR_PLAN' })
  @MaxLength(64, { message: 'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":64}' })
  // Slugs are internal identifiers: lowercase, digits and hyphens. Constraining the shape keeps
  // anything that is not a plan slug from reaching the lookup at all.
  @Matches(/^[a-z0-9][a-z0-9-]*$/, { message: 'VALIDATION.PAYMENT.PLAN_SELECCIONADO_NO_VALIDO' })
  planSlug!: string;

  /** Monthly or annual. Defaults to monthly. */
  @ApiProperty({ enum: BILLING_PERIODS, required: false, default: 'monthly' })
  @IsOptional()
  @IsIn(BILLING_PERIODS, { message: 'VALIDATION.PAYMENT.PERIODO_FACTURACION_NO_VALIDO' })
  billingPeriod?: BillingPeriod;
}

/** Reconcile an organization's subscription after the browser returns from Checkout. */
export class ConfirmCheckoutDto {
  @ApiProperty({ example: 'cs_test_a1B2c3', description: 'Stripe Checkout session id' })
  @IsString({ message: 'VALIDATION.PAYMENT.SESION_PAGO_NO_VALIDA' })
  @IsNotEmpty({ message: 'VALIDATION.PAYMENT.SESION_PAGO_NO_VALIDA' })
  @MaxLength(255, { message: 'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":255}' })
  // Stripe checkout session ids are `cs_` followed by an alphanumeric body.
  @Matches(/^cs_[A-Za-z0-9_]+$/, { message: 'VALIDATION.PAYMENT.SESION_PAGO_NO_VALIDA' })
  sessionId!: string;
}
