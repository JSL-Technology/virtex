import { IsEnum, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { PosFiscalMode } from '../entities/pos-settings.entity';

/** A change to the point of sale's configuration. `null` clears an account. */
export class UpdatePosSettingsDto {
  @IsOptional()
  @IsEnum(PosFiscalMode, { message: 'validation.constraints.is_enum' })
  fiscalMode?: PosFiscalMode;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID('all', { message: 'validation.constraints.is_uuid' })
  cashBankAccountId?: string | null;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID('all', { message: 'validation.constraints.is_uuid' })
  cardBankAccountId?: string | null;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID('all', { message: 'validation.constraints.is_uuid' })
  transferBankAccountId?: string | null;
}
