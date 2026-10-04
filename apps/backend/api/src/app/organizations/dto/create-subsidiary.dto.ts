import { IsString, IsNotEmpty, IsNumber, Matches, Max, MaxLength, Min } from 'class-validator';

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
