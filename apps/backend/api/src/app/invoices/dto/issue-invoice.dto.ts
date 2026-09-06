import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Options for turning a draft into an issued fiscal document. */
export class IssueInvoiceDto {
  /**
   * Fiscal document type to draw the number from, as the authority's own code.
   *
   * Absent, the market's adapter decides — for the Dominican Republic, crédito fiscal or consumo
   * according to the buyer's verified identifier.
   *
   * Validated as a code rather than against `NcfType`: the enum is the DGII's, and a Chilean `33`,
   * a Mexican `I` or a Brazilian `55` are all legitimate values in their own market that an
   * `@IsEnum(NcfType)` would refuse with a message about Dominican comprobantes. Whether the code
   * means anything is the adapter's to say, and each one refuses a code that is not its own.
   */
  @IsString()
  @MaxLength(8)
  @Matches(/^[A-Za-z0-9]+$/, { message: 'INVOICES.TIPO_COMPROBANTE_FORMATO_INVALIDO' })
  @IsOptional()
  fiscalDocumentType?: string;
}
