import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { FiscalEnvironment } from '../entities/fiscal-regime-settings.entity';
import { FiscalRangeSecretKind } from '../entities/fiscal-document-range.entity';

/**
 * The tenant's operational configuration for their market's e-invoicing regime.
 *
 * Every field is optional because the seven regimes need different subsets and asking a Chilean
 * tenant for an IBGE municipality code would be nonsense. What is NOT optional is the refusal
 * downstream: each adapter names exactly what it is missing when it cannot build, rather than
 * emitting a document with a blank where a mandatory element goes.
 */
export class UpsertFiscalRegimeSettingsDto {
  /**
   * Production or the authority's certification environment.
   *
   * Defaults to certification on the entity, deliberately: a tenant who has uploaded a certificate
   * but not passed homologation should be sending to the test environment, and a default of
   * production would have them filing documents with legal effect on their first attempt.
   */
  @IsEnum(FiscalEnvironment)
  @IsOptional()
  environment?: FiscalEnvironment;

  /** Ecuador: the SRI's three-digit establishment. */
  @IsString()
  @Matches(/^\d{3}$/, { message: 'EINVOICING.SRI_ESTABLECIMIENTO_TRES_DIGITOS' })
  @IsOptional()
  establishment?: string;

  /** Ecuador: the SRI's three-digit emission point. */
  @IsString()
  @Matches(/^\d{3}$/, { message: 'EINVOICING.SRI_PUNTO_EMISION_TRES_DIGITOS' })
  @IsOptional()
  emissionPoint?: string;

  /**
   * Ecuador and Brazil: eight digits the issuer chooses.
   *
   * Part of the access key in both, which is why the length is enforced here rather than padded
   * later: a seven-digit code padded to eight silently produces a different key than the one the
   * taxpayer believes they issued under.
   */
  @IsString()
  @Matches(/^\d{8}$/, { message: 'EINVOICING.CODIGO_NUMERICO_OCHO_DIGITOS' })
  @IsOptional()
  numericCode?: string;

  /** Brazil: IBGE code of the issuer's state, two digits. */
  @IsString()
  @Matches(/^\d{2}$/, { message: 'EINVOICING.NFE_CODIGO_ESTADO_DOS_DIGITOS' })
  @IsOptional()
  stateCode?: string;

  /** Brazil: IBGE code of the issuing municipality, seven digits. */
  @IsString()
  @Matches(/^\d{7}$/, { message: 'EINVOICING.NFE_CODIGO_MUNICIPIO_SIETE_DIGITOS' })
  @IsOptional()
  municipalityCode?: string;

  /** Colombia: the invoicing resolution the ranges were granted by. */
  @IsString()
  @MaxLength(64)
  @IsOptional()
  resolutionNumber?: string;

  /** Chile: the economic activity code the SII requires on every DTE. */
  @IsString()
  @MaxLength(16)
  @IsOptional()
  activityCode?: string;

  /** Chile: comuna of the issuing address, which the SII requires and an address line is not. */
  @IsString()
  @MaxLength(64)
  @IsOptional()
  originComuna?: string;

  /** Chile: city of the issuing address. */
  @IsString()
  @MaxLength(64)
  @IsOptional()
  originCity?: string;
}

/**
 * A range of document numbers the authority authorised.
 *
 * This is the form that unblocks invoicing in six markets: without a row there is no number to
 * assign, and the product refuses to issue — correctly, but with no way out except SQL.
 */
export class RegisterFiscalRangeDto {
  /** The authority's own document-type code: `01`, `33`, `55`. */
  @IsString()
  @MaxLength(8)
  @Matches(/^[A-Za-z0-9]+$/, { message: 'INVOICES.TIPO_COMPROBANTE_FORMATO_INVALIDO' })
  documentType!: string;

  /**
   * The series the numbers belong to: `F001` in Peru, the resolution prefix in Colombia, the série
   * in Brazil. Empty where the market has none.
   */
  @IsString()
  @MaxLength(16)
  @IsOptional()
  series?: string;

  @IsInt()
  @Min(1)
  startsAt!: number;

  @IsInt()
  @Min(1)
  endsAt!: number;

  /**
   * When the authorisation expires, where the market time-boxes it.
   *
   * A DIAN resolution and an SII CAF both expire; a Brazilian série does not. Omitting it on a
   * market that does expire means the product cannot warn before the authority refuses.
   */
  @IsISO8601()
  @IsOptional()
  validUntil?: string;

  /** The administrative act that granted the range: resolution number, CAF id, authorisation. */
  @IsString()
  @MaxLength(128)
  @IsOptional()
  authorizationCode?: string;

  /**
   * The material the authority issued with the range: the CAF XML in Chile, the ClaveTécnica in
   * Colombia.
   *
   * Encrypted before it reaches a column, and never returned by any read endpoint. Anyone holding
   * a CAF can stamp documents in the taxpayer's name, and anyone holding a technical key can
   * compute a CUFE the DIAN accepts as theirs.
   */
  @IsString()
  @Length(1, 100_000)
  @IsOptional()
  secret?: string;

  @IsEnum(FiscalRangeSecretKind)
  @IsOptional()
  secretKind?: FiscalRangeSecretKind;
}
