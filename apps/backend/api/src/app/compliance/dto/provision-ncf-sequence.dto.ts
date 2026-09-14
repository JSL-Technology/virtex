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
  @Matches(/^[BE]\d{2}$/, { message: 'validation.provision_ncf_sequence.prefix_must_follow_dgii_series_format' })
  prefix: string;

  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  startsAt: number;

  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
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
  @MaxLength(64, { message: 'validation.constraints.max_length|{"max":64}' })
  authorizationCode?: string;
}
