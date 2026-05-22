import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { TaxType } from '../entities/tax.entity';

export class CreateTaxDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0)
  rate: number;

  @IsEnum(TaxType)
  @IsOptional()
  type?: TaxType;

  @IsString()
  @IsOptional()
  countryCode?: string;
}