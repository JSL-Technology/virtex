import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class AgreementLineDto {
  @IsUUID()
  @IsOptional()
  productId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  description: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  unitPrice: number;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(1, { message: 'validation.constraints.max|{"max":1}' })
  @IsOptional()
  taxRate?: number;

  /** Ceiling over the whole agreement. Omitted: no ceiling on this line. */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  maxQuantity?: number;

  @IsString()
  @IsOptional()
  @MaxLength(16, { message: 'validation.constraints.max_length|{"max":16}' })
  unitOfMeasure?: string;
}

/** A purchase agreement / blanket order (CMP-15). */
export class CreateAgreementDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200, { message: 'validation.constraints.max_length|{"max":200}' })
  title: string;

  @IsUUID()
  supplierId: string;

  @IsDateString()
  validFrom: string;

  @IsDateString()
  validTo: string;

  @IsString()
  @IsOptional()
  @Length(3, 3, { message: 'validation.constraints.length|{"min":3,"max":3}' })
  currencyCode?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  maxAmount?: number;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'validation.constraints.max_length|{"max":2000}' })
  notes?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'validation.constraints.array_min_size|{"min":1}' })
  @ArrayMaxSize(200, { message: 'validation.constraints.array_max_size|{"max":200}' })
  @ValidateNested({ each: true })
  @Type(() => AgreementLineDto)
  lines: AgreementLineDto[];
}

export class ReleaseLineDto {
  @IsUUID()
  agreementLineId: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001, { message: 'validation.constraints.min|{"min":0}' })
  quantity: number;
}

/** An order released against an agreement, at its prices. */
export class ReleaseAgreementDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'validation.constraints.array_min_size|{"min":1}' })
  @ArrayMaxSize(200, { message: 'validation.constraints.array_max_size|{"max":200}' })
  @ValidateNested({ each: true })
  @Type(() => ReleaseLineDto)
  lines: ReleaseLineDto[];

  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsDateString()
  @IsOptional()
  expectedDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'validation.constraints.max_length|{"max":2000}' })
  notes?: string;
}
