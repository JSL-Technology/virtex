
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
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

  /**
   * Optional, as the supplier's has always been.
   *
   * Requiring it did not produce email addresses; it produced `ventas@example.com` typed to get
   * past the field — which is worse than an empty column, because the next invoice run sends to
   * it. See the `CustomerContactOptional` migration.
   */
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

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
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  totalBilled?: number;

  /** The terms as they are printed on the document: "Neto 30", "Contado". */
  @IsString()
  @IsOptional()
  @MaxLength(60, { message: 'validation.constraints.max_length|{"max":60}' })
  paymentTerms?: string;

  /**
   * How many days after issue this customer's invoices fall due.
   *
   * Null leaves the organization's own default in force; zero means due on receipt, which is a
   * real answer and not the same as "not set".
   */
  @IsInt()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(365, { message: 'validation.constraints.max|{"max":365}' })
  @IsOptional()
  paymentTermDays?: number | null;
}