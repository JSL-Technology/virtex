import { IsString, IsNotEmpty, IsNumber, IsOptional, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { IsIsoDate } from '../../common/validators/is-iso-date.validator';

export class CreateSubsidiaryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  legalName: string;

  @IsString()
  @IsNotEmpty()
  taxId: string;

  /** ISO 3166-1 alpha-2: the subsidiary's jurisdiction decides its fiscal rules (QA A-16). */
  @IsString()
  @Matches(/^[A-Za-z]{2}$/, { message: 'organizations.subsidiary_country_code' })
  country: string;

  @IsNumber()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(100, { message: 'validation.constraints.max|{"max":100}' })
  ownership: number;
}

/**
 * What the group records about a subsidiary after it is created: how much it owns, since when, at
 * what cost, against which investment account — and when control ended. Consolidation reads all of
 * it; without the acquisition date it can only warn that pre-acquisition equity cannot be separated.
 */
export class UpdateSubsidiaryDto {
  @IsNumber()
  @IsOptional()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(100, { message: 'validation.constraints.max|{"max":100}' })
  ownership?: number;

  @ValidateIf((_, value) => value !== null)
  @IsIsoDate()
  @IsOptional()
  acquisitionDate?: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  acquisitionCost?: number | null;

  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  @IsOptional()
  investmentAccountId?: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsIsoDate()
  @IsOptional()
  controlEndedOn?: string | null;
}
