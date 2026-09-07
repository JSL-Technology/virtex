import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';

/**
 * Which of the authority's two worlds the tenant is transmitting to.
 *
 * Every one of these regimes runs a certification environment alongside production, and a taxpayer
 * must pass it before their production traffic is accepted. Normalised here to two names because
 * the authorities cannot agree on the coding and each regime translates it: Colombia writes `1` for
 * production and `2` for tests; **Ecuador writes them the other way round**, `1` for tests and `2`
 * for production. A single stored digit reused across regimes would be right in one country and
 * silently wrong in the next — a document filed against the wrong environment is not a filing.
 */
export enum FiscalEnvironment {
  /** Real documents with legal effect. */
  PRODUCTION = 'PRODUCTION',
  /** The authority's test environment. Documents here have no fiscal effect. */
  CERTIFICATION = 'CERTIFICATION',
}

/**
 * The per-tenant configuration an e-invoicing regime needs and the signup does not collect.
 *
 * ## Why not `organizations.fiscal_profile`
 *
 * That column holds what `country-profiles.ts` asks for at registration — `regimenFiscal`,
 * `condicionIva`, `puntoVenta`, `cnae` — which is the tenant's fiscal identity. What a regime
 * needs to build a document is operational and arrives later, from a different administrative act:
 * the DIAN's technical key and resolution, the SRI's establishment and emission point, the IBGE
 * codes and série of a Brazilian establishment. Mixing the two would mean the signup form asking
 * for values the tenant cannot have yet, and blocking registration on them.
 *
 * ## The secret
 *
 * Colombia's `ClaveTécnica` is a shared secret and an input to the CUFE. It is stored on the
 * *range* it belongs to (`fiscal_document_ranges.encrypted_secret`), encrypted, and not here —
 * because it is issued with the resolution that grants the numbers, and it changes when the
 * resolution does.
 */
@Entity({ name: 'fiscal_regime_settings' })
@Index('UQ_fiscal_regime_settings_org_country', ['organizationId', 'countryCode'], { unique: true })
export class FiscalRegimeSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'organization_id',
    foreignKeyConstraintName: 'FK_fiscal_regime_settings_organization',
  })
  organization: Organization;

  /** ISO 3166-1 alpha-2 of the regime this configures. */
  @Column({ name: 'country_code', type: 'varchar', length: 2 })
  countryCode: string;

  /**
   * Production or certification.
   *
   * Defaults to certification, and deliberately: a tenant who has configured a certificate but not
   * yet passed homologation should be sending to the test environment, and a default of production
   * would have them filing documents with legal effect on their first attempt.
   */
  @Column({
    name: 'environment',
    type: 'varchar',
    length: 16,
    default: FiscalEnvironment.CERTIFICATION,
  })
  environment: FiscalEnvironment;

  /** Ecuador: the SRI's three-digit establishment code. */
  @Column({ name: 'establishment', type: 'varchar', length: 8, nullable: true })
  establishment?: string | null;

  /** Ecuador: the SRI's three-digit emission point within the establishment. */
  @Column({ name: 'emission_point', type: 'varchar', length: 8, nullable: true })
  emissionPoint?: string | null;

  /**
   * Ecuador and Brazil: the digits the issuer chooses that make two otherwise identical documents
   * distinguishable in the access key. Eight digits in both.
   */
  @Column({ name: 'numeric_code', type: 'varchar', length: 16, nullable: true })
  numericCode?: string | null;

  /** Brazil: IBGE code of the issuer's state — `35` São Paulo, `33` Rio de Janeiro. */
  @Column({ name: 'state_code', type: 'varchar', length: 8, nullable: true })
  stateCode?: string | null;

  /** Brazil: IBGE code of the issuing municipality, seven digits. */
  @Column({ name: 'municipality_code', type: 'varchar', length: 16, nullable: true })
  municipalityCode?: string | null;

  /** Colombia: the invoicing resolution the ranges were granted by. */
  @Column({ name: 'resolution_number', type: 'varchar', length: 64, nullable: true })
  resolutionNumber?: string | null;

  /** Chile: the tenant's economic activity code, which the SII requires on every DTE. */
  @Column({ name: 'activity_code', type: 'varchar', length: 16, nullable: true })
  activityCode?: string | null;

  /** Chile: the comuna of the issuing address, which the SII requires and an address line is not. */
  @Column({ name: 'origin_comuna', type: 'varchar', length: 64, nullable: true })
  originComuna?: string | null;

  /** Chile: the city of the issuing address. */
  @Column({ name: 'origin_city', type: 'varchar', length: 64, nullable: true })
  originCity?: string | null;
}
