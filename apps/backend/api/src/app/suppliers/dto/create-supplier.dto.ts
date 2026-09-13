import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import { TaxpayerType } from '../../localization/fiscal/withholding-regimes';

export class CreateSupplierDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  contactPerson?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  taxId?: string;

  @IsString()
  @IsOptional()
  address?: string;

  /**
   * ISO 3166-1 alpha-2. Tells a domestic purchase from a payment abroad, which the 609 reports
   * separately. The column existed and no DTO carried it, so the form could never set it.
   */
  @IsString()
  @IsOptional()
  @Length(2, 2, { message: 'VALIDATION.CONSTRAINTS.COUNTRY_CODE' })
  country?: string;

  /**
   * The supplier's fiscal classification, which decides what we withhold when we pay them.
   *
   * Assigned by the tax authority and recorded by the tenant. Absent, nothing is withheld
   * automatically, and a bill that withholds has to justify itself.
   */
  @IsEnum(TaxpayerType)
  @IsOptional()
  taxpayerType?: TaxpayerType;
}