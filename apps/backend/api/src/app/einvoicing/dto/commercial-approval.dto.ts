import {
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { CommercialApprovalVerdict } from '../entities/ecf-lifecycle-message.entity';

/** The buyer's verdict on a comprobante a supplier issued to them. */
export class CommercialApprovalDto {
  /** RNC of the supplier. Accepted with or without separators; stored as digits. */
  @IsString()
  @Matches(/^[\d-]{9,13}$/, { message: 'validation.commercial_approval.issuer_rnc_not_valid_format' })
  issuerRnc: string;

  /** The supplier's e-NCF: `E` + two type digits + ten sequence digits. */
  @IsString()
  @Matches(/^E\d{12}$/, {
    message: 'validation.commercial_approval.ncf_must_followed_12_digits_example',
  })
  ncf: string;

  /** Issue date the supplier stated, `YYYY-MM-DD`. */
  @IsISO8601({ strict: true }, { message: 'validation.commercial_approval.issue_date_must_iso_date_yyyy' })
  documentDate: string;

  /**
   * Total the supplier stated.
   *
   * The DGII matches it against the comprobante it holds; a mismatch of one cent is a rejection, so
   * it is taken from the operator rather than recomputed from anything on this side.
   */
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  documentTotal: number;

  @IsEnum(CommercialApprovalVerdict, { message: 'validation.commercial_approval.status_must_approved_rejected' })
  verdict: CommercialApprovalVerdict;

  /** Required on a rejection; the service refuses one without it. */
  @ValidateIf((dto: CommercialApprovalDto) => dto.verdict === CommercialApprovalVerdict.REJECTED)
  @IsString()
  @MaxLength(250, { message: 'validation.constraints.max_length|{"max":250}' })
  @IsOptional()
  rejectionReason?: string;
}
