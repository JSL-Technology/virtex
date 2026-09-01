import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { NcfType } from '../entities/ncf-sequence.entity';

/**
 * Registers a DGII-authorized NCF / e-NCF range for the current tenant.
 * `prefix` is the series + document-type code as authorized by the DGII (e.g. `B01`, `E31`).
 */
export class ProvisionNcfSequenceDto {
  @IsEnum(NcfType)
  type: NcfType;

  @IsString()
  @Matches(/^[BE]\d{2}$/, { message: 'El prefijo debe tener el formato de serie DGII, p. ej. B01 o E31.' })
  prefix: string;

  @IsInt()
  @Min(1)
  startsAt: number;

  @IsInt()
  @Min(1)
  endsAt: number;

  /**
   * Expiry of the DGII authorization, `YYYY-MM-DD`.
   *
   * This is `FechaVencimientoSecuencia`, a mandatory element of every e-CF. The column existed and
   * the issuance path validated it, but nothing could ever set it — so the check never fired and
   * the transmitted XML omitted the element the DGII requires.
   */
  @IsISO8601({ strict: true })
  @IsOptional()
  expiresAt?: string;

  /** Authorization reference the DGII issued for the range, kept for audit and support. */
  @IsString()
  @IsOptional()
  @MaxLength(64)
  authorizationCode?: string;
}
