import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Reopen a statement that was reconciled.
 *
 * The reason is required, and the closing details are kept rather than erased. Reopening reverses
 * a control somebody signed off; the previous version asked for no justification and nulled
 * `reconciled_at` and `reconciled_by_user_id` on the way through, so the only record that the
 * statement had ever been reconciled — and by whom — was deleted by the act of undoing it.
 */
export class ReopenStatementDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
