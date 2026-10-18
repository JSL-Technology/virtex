import { IsIn, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/** The categories the catalogue groups units by; a company unit joins one of them. */
export const UNIT_CATEGORIES = ['Units', 'Weight', 'Length', 'Area', 'Volume', 'Time'] as const;

export class CreateTenantUnitOfMeasureDto {
  /** Short code products carry, e.g. `SC50`. Upper case, letters, digits and hyphens. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  @Matches(/^[A-Z0-9][A-Z0-9-]*$/, { message: 'uom.errors.symbol_format' })
  symbol: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsIn(UNIT_CATEGORIES)
  category: (typeof UNIT_CATEGORIES)[number];
}
