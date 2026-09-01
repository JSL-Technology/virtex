import { IsEnum, IsOptional } from 'class-validator';
import { NcfType } from '../../compliance/entities/ncf-sequence.entity';

/** Options for turning a draft into an issued fiscal document. */
export class IssueInvoiceDto {
  /**
   * Fiscal document type to draw the number from. Absent, the market's adapter decides — for the
   * Dominican Republic, crédito fiscal or consumo according to the buyer's verified identifier.
   */
  @IsEnum(NcfType)
  @IsOptional()
  fiscalDocumentType?: NcfType;
}
