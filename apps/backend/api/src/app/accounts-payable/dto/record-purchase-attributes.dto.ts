import { IsObject } from 'class-validator';

/**
 * What the market's authority asks about a purchase, answered on a bill already posted — by the
 * keys the market declares (`MarketPurchases.fiscalAttributes`), checked against that schema.
 */
export class RecordPurchaseAttributesDto {
  @IsObject()
  fiscalAttributes!: Record<string, unknown>;
}
