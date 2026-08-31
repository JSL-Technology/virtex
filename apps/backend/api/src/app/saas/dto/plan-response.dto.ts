import { Expose, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * What a plan looks like to somebody who has not signed in.
 *
 * `GET /saas/plans` is `@Public()` — the signup page needs it before an account exists — and it
 * returned `planRepository.find()` directly: the whole entity, including `stripe_product_id`,
 * `monthly_price_id` and `annual_price_id`, to anonymous callers. Every other response in the
 * product goes through `plainToInstance(..., { excludeExtraneousValues: true })`, and
 * `OrganizationResponseDto` excludes those same Stripe identifiers on purpose, with a comment
 * about how that endpoint "handed both to any authenticated member of the organization". This one
 * handed them to everyone.
 *
 * Nothing here is a secret in the cryptographic sense — a price id cannot be used to charge
 * anybody — but it is internal billing configuration, it identifies the payment processor and the
 * account behind it, and it has no business on a public marketing surface. An allow-list DTO also
 * means a column added to `Plan` later is not published by accident.
 */
export class PlanLimitResponseDto {
  @ApiProperty() @Expose() resource!: string;
  @ApiProperty() @Expose() limit!: number;
  @ApiProperty() @Expose() period!: string;
  @ApiProperty() @Expose() isUnlimited!: boolean;
}

export class PlanFeatureResponseDto {
  @ApiProperty() @Expose() featureKey!: string;
  @ApiProperty() @Expose() isEnabled!: boolean;
}

export class PlanResponseDto {
  @ApiProperty() @Expose() id!: string;
  @ApiProperty() @Expose() slug!: string;
  @ApiProperty() @Expose() name!: string;
  @ApiProperty() @Expose() description!: string;

  /**
   * Amount in the smallest unit of `currency` — and the amount Checkout will actually charge,
   * because both are resolved from one table by one function and verified against Stripe at boot.
   */
  @ApiProperty() @Expose() monthlyPrice!: number | null;
  @ApiProperty({ example: 'USD' }) @Expose() currency!: string;

  /**
   * How many minor units make one unit of `currency`: 1 for CLP and PYG, 100 for the rest.
   *
   * Published rather than left to the client to know. The plan card divided every amount by 100
   * regardless, which understates a Chilean or Paraguayan price by a factor of a hundred.
   */
  @ApiProperty({ example: 100 }) @Expose() minorUnits!: number;

  /**
   * The yearly amount, in the same currency and units — `null` when the plan has no annual Stripe
   * Price or no amount configured for this currency. The client shows the annual option only when
   * this is present, so it can never offer a period the checkout cannot charge.
   */
  @ApiProperty({ required: false }) @Expose() annualPrice!: number | null;
  @ApiProperty() @Expose() annualBillingAvailable!: boolean;

  @ApiProperty() @Expose() trialPeriodDays!: number | null;

  @ApiProperty({ type: [PlanLimitResponseDto] })
  @Expose()
  @Type(() => PlanLimitResponseDto)
  limits!: PlanLimitResponseDto[];

  @ApiProperty({ type: [PlanFeatureResponseDto] })
  @Expose()
  @Type(() => PlanFeatureResponseDto)
  features!: PlanFeatureResponseDto[];

  // Deliberately absent: externalProductId, monthlyPriceId, annualPriceId, isActive.
}
