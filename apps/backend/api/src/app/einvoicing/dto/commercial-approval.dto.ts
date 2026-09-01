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
  @Matches(/^[\d-]{9,13}$/, { message: 'VALIDATION.COMMERCIAL_APPROVAL.RNC_EMISOR_NO_TIENE_FORMATO_VALIDO' })
  issuerRnc: string;

  /** The supplier's e-NCF: `E` + two type digits + ten sequence digits. */
  @IsString()
  @Matches(/^E\d{12}$/, {
    message: 'VALIDATION.COMMERCIAL_APPROVAL.E_NCF_DEBE_TENER_FORMATO_E_12_DIGITOS',
  })
  ncf: string;

  /** Issue date the supplier stated, `YYYY-MM-DD`. */
  @IsISO8601({ strict: true }, { message: 'VALIDATION.COMMERCIAL_APPROVAL.FECHA_EMISION_DEBE_FECHA_ISO_YYYY_MM_DD' })
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

  @IsEnum(CommercialApprovalVerdict, { message: 'VALIDATION.COMMERCIAL_APPROVAL.ESTADO_DEBE_1_APROBADO_2_RECHAZADO' })
  verdict: CommercialApprovalVerdict;

  /** Required on a rejection; the service refuses one without it. */
  @ValidateIf((dto: CommercialApprovalDto) => dto.verdict === CommercialApprovalVerdict.REJECTED)
  @IsString()
  @MaxLength(250, { message: 'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":250}' })
  @IsOptional()
  rejectionReason?: string;
}
