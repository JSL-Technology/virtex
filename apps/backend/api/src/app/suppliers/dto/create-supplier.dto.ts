import {
  IsEmail,
  IsEnum,
  IsISO31661Alpha2,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
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

  /**
   * The supplier's fiscal identifier.
   *
   * Shape and check digit are NOT asserted here: which rule applies depends on
   * `identityDocumentTypeCode` and on a country, neither of which a synchronous decorator can
   * reach. `SuppliersService` validates it against the catalogue. It previously carried
   * `@IsString()` and nothing else, so a mistyped RNC was stored and surfaced when the 606 filing
   * built from it was rejected.
   */
  @IsString()
  @IsOptional()
  taxId?: string;

  /** Which identifier `taxId` is: `RNC`, `CEDULA`, `NIT`, `CNPJ`… The catalogue's default if omitted. */
  @IsString()
  @IsOptional()
  @Length(1, 32)
  identityDocumentTypeCode?: string;

  /** The issuing country of that document — the SUPPLIER's. Defaults to the supplier's country. */
  @IsISO31661Alpha2()
  @IsOptional()
  identityDocumentCountry?: string;

  @IsString()
  @IsOptional()
  address?: string;

  /**
   * ISO 3166-1 alpha-2. Tells a domestic purchase from a payment abroad, which the 609 reports
   * separately. The column existed and no DTO carried it, so the form could never set it.
   */
  @IsString()
  @IsOptional()
  @Length(2, 2, { message: 'validation.constraints.country_code' })
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