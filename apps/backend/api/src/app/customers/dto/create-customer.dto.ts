
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { TaxpayerType } from '../../localization/fiscal/withholding-regimes';

export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty()
  companyName: string;

  @IsString()
  @IsOptional()
  contactPerson?: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsOptional()
  taxId?: string;

  /**
   * The buyer's fiscal classification, which decides what they withhold at source.
   *
   * Assigned by the tax authority — a withholding agent is one because it appears on a published
   * list — so it is stated rather than inferred. Absent, nothing is withheld automatically and a
   * document that withholds has to justify itself.
   */
  @IsEnum(TaxpayerType)
  @IsOptional()
  taxpayerType?: TaxpayerType;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  stateOrProvince?: string;

  @IsString()
  @IsOptional()
  postalCode?: string;

  @IsString()
  @IsNotEmpty()
  country: string;

  @IsNumber()
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  @IsOptional()
  totalBilled?: number;
}