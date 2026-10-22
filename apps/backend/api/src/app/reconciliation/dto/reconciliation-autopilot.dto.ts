import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';

/** One bank account's own settings. `null` goes back to the company's. */
export class ReconciliationAccountSettingsDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsBoolean({ message: 'validation.constraints.is_boolean' })
  autoConfirm?: boolean | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt({ message: 'validation.constraints.is_int' })
  @Min(90, { message: 'validation.constraints.min' })
  @Max(100, { message: 'validation.constraints.max' })
  minScore?: number | null;

  /** Confirm on its own again after a pause. */
  @IsOptional()
  @IsBoolean({ message: 'validation.constraints.is_boolean' })
  resume?: boolean;
}

export class ApplyCategoryDto {
  @IsUUID('4', { message: 'validation.constraints.is_uuid' })
  accountId: string;
}
