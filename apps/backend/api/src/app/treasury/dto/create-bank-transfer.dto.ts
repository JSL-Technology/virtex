import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * A movement between two of the tenant's own accounts.
 *
 * `fromAccountId` and `toAccountId` are **bank accounts**, not chart-of-accounts ids. They used to
 * be the latter, which meant the endpoint could move a number between any two ledger rows — an
 * expense account to a revenue account, say — and call it a treasury transfer.
 */
export class CreateBankTransferDto {
  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsUUID()
  @IsNotEmpty()
  fromBankAccountId: string;

  @IsUUID()
  @IsNotEmpty()
  toBankAccountId: string;

  /**
   * What the destination actually received, when the two accounts are in different currencies.
   *
   * A transfer between a USD and a DOP account is two different amounts, and one rate does not
   * describe both sides of what the bank actually did. Omitted for a same-currency transfer.
   */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @IsOptional()
  amountReceived?: number;

  /** Bank charge deducted from the transfer, if any. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  fee?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description: string;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  reference?: string;
}
