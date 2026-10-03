import { IsOptional, IsUUID } from 'class-validator';

/**
 * Which account the net wages leave from.
 *
 * `bankAccountId` — a treasury bank account — is what the screen sends: it is what a person picks,
 * and it is checked to belong to the tenant, to be active and to be kept in the books' currency.
 * `bankGlAccountId` is the ledger account behind it, still accepted for integrations that already
 * send it, and checked to be one a bank account or the cash role actually owns (QA C-09: the
 * screen had no way to choose at all, and the endpoint accepted any account id it was given).
 */
export class PayPayrollRunDto {
  @IsUUID('4')
  @IsOptional()
  bankAccountId?: string;

  @IsUUID('4')
  @IsOptional()
  bankGlAccountId?: string;
}
