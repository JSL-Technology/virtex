import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Set a statement line aside.
 *
 * The reason is required. A closed reconciliation whose proof depends on a line somebody dropped
 * has to record who dropped it and why, or the closure means nothing.
 */
export class ExcludeTransactionDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
