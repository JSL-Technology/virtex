import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Clear a group of statement lines against a group of ledger lines.
 *
 * The two sides are arrays because the everyday cases are not one-to-one: a deposit slip covering
 * five cheques is one statement line against five ledger lines, and a transfer whose fee the bank
 * charged separately is one ledger entry against two statement lines. The service requires the two
 * sides to sum to the same figure before it writes anything.
 */
export class ConfirmMatchDto {
  @IsUUID()
  @IsNotEmpty()
  statementId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  bankTransactionIds: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  journalEntryLineIds: string[];

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
