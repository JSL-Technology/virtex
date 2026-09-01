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
  @Matches(/^[\d-]{9,13}$/, { message: 'El RNC del emisor no tiene un formato válido.' })
  issuerRnc: string;

  /** The supplier's e-NCF: `E` + two type digits + ten sequence digits. */
  @IsString()
  @Matches(/^E\d{12}$/, {
    message: 'El e-NCF debe tener el formato E + 12 dígitos (por ejemplo E310000000001).',
  })
  ncf: string;

  /** Issue date the supplier stated, `YYYY-MM-DD`. */
  @IsISO8601({ strict: true }, { message: 'La fecha de emisión debe ser una fecha ISO (YYYY-MM-DD).' })
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

  @IsEnum(CommercialApprovalVerdict, { message: 'El estado debe ser 1 (aprobado) o 2 (rechazado).' })
  verdict: CommercialApprovalVerdict;

  /** Required on a rejection; the service refuses one without it. */
  @ValidateIf((dto: CommercialApprovalDto) => dto.verdict === CommercialApprovalVerdict.REJECTED)
  @IsString()
  @MaxLength(250)
  @IsOptional()
  rejectionReason?: string;
}
