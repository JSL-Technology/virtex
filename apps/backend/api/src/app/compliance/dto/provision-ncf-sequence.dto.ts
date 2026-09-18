import { IsInt, IsISO8601, IsOptional, IsString, Length, Matches, MaxLength, Min } from 'class-validator';

/**
 * Registers an authority-authorized fiscal document range for the current tenant.
 * `prefix` is the series + document-type code the authority granted (e.g. `B01`, `E31`, `01`, `33`).
 */
export class ProvisionNcfSequenceDto {
  // Validated against `fiscal_document_type_definitions` for the tenant's region in
  // `ComplianceService`, NOT against `NcfType`: a Chilean `33`, a Mexican `I` or a Peruvian `01`
  // are legitimate codes their own authorities publish that `@IsEnum(NcfType)` would refuse with a
  // message about Dominican comprobantes. The border checks the shape; the service checks the
  // meaning against the region's catalogue (C-03).
  @IsString()
  @Length(1, 8)
  type: string;

  @IsString()
  // The exact shape of a series is a property of the authority (the catalogue's `sequenceFormat`),
  // not a fixed `/^[BE]\d{2}$/` that only the DGII satisfies. A generic code shape here; the service
  // requires it to match the document type.
  @Matches(/^[A-Za-z0-9]{1,8}$/, { message: 'validation.provision_ncf_sequence.prefix_must_follow_dgii_series_format' })
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
