import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';

/**
 * What the range's secret material is, when it carries any.
 *
 * Two of the seven regimes hand the taxpayer a secret along with the numbers:
 *
 * - **`AUTHORISED_FOLIOS`** — Chile. The SII's *Código de Autorización de Folios* is an XML that contains the
 *   authorised range **and an RSA private key**. Every DTE drawn from that range carries a `TED`
 *   sealed with that key, and the SII verifies the seal against the public key it issued with the
 *   range. Losing it means the folios cannot be used; leaking it means someone else can stamp
 *   documents in the taxpayer's name.
 * - **`TECHNICAL_KEY`** — Colombia. The *ClaveTécnica* is issued with the invoicing resolution
 *   and is an input to the CUFE. It is not a signing key, but it is a shared secret, and a CUFE
 *   computed with someone else's is a forgery.
 *
 * Both are stored encrypted, never in a plain column. That is not caution for its own sake: a
 * database dump with these in the clear lets the reader issue fiscal documents as the taxpayer.
 */
export enum FiscalRangeSecretKind {
  AUTHORISED_FOLIOS = 'AUTHORISED_FOLIOS',
  TECHNICAL_KEY = 'TECHNICAL_KEY',
}

/**
 * A range of document numbers an authority authorised a tenant to issue — in every market that
 * numbers from one: the DGII's NCF, a DIAN resolution, a SUNAT series, an SRI emission point, an
 * SII CAF, a SEFAZ série.
 *
 * ## One table for every market
 *
 * The Dominican Republic used to keep its own (`ncf_sequences`), typed by the DGII's comprobante
 * enum and with no room for a series, a resolution or a secret, beside this one for everybody else:
 * the same idea in two tables, read by two services with two sets of rules. Its rows moved here
 * (migration `UnifiedFiscalRanges`): country `DO`, no series, the type being the NCF's own prefix.
 *
 * ## The invariant that matters
 *
 * A fiscal number is handed out exactly once. `current_sequence` is advanced under a row lock in
 * the same transaction that issues the document (`FiscalRangeService.drawNext`), because two
 * concurrent issuances that both read the counter before either writes it produce two documents
 * with the same number, and an authority that receives the second one rejects it and asks the
 * taxpayer to explain the first. A range is registered only if it overlaps no range registered
 * before for its type and series and none of its numbers is already on a document.
 *
 * *Verificar con contabilidad/legal*: every one of these ranges is issued by a specific
 * administrative act, and the act's own reference is recorded in `authorizationCode` so the
 * document can be traced back to the permission that allowed it.
 */
@Entity({ name: 'fiscal_document_ranges' })
// One active range per (tenant, market, document type, series). Two active ranges for the same
// series is how the same number gets issued twice from different rows: the draw would pick one
// non-deterministically, and each row would advance its own counter.
@Index(
  'UQ_fiscal_document_ranges_active',
  ['organizationId', 'countryCode', 'documentType', 'series'],
  { unique: true, where: `"is_active" = true` },
)
@Index('IDX_fiscal_document_ranges_org_country', ['organizationId', 'countryCode'])
// A range that ends before it starts authorises nothing, and a counter outside its own range hands
// out a number the authority never granted. Both are storable without this and neither is valid.
@Check('CK_fiscal_document_ranges_bounds', `"ends_at" >= "starts_at"`)
@Check(
  'CK_fiscal_document_ranges_cursor',
  `"current_sequence" >= "starts_at" - 1 AND "current_sequence" <= "ends_at"`,
)
export class FiscalDocumentRange {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'organization_id',
    // Named, or TypeORM generates a hash name that will never match the migration's and the
    // schema-drift check proposes dropping and recreating the constraint on every run.
    foreignKeyConstraintName: 'FK_fiscal_document_ranges_organization',
  })
  organization: Organization;

  /** ISO 3166-1 alpha-2 of the authority that issued the range. */
  @Column({ name: 'country_code', type: 'varchar', length: 2 })
  countryCode: string;

  /**
   * The authority's own document-type code, as the market's catalogue declares it (`B01`, `01`,
   * `33`, `55`).
   *
   * Deliberately a code and not an enum. These come from catalogues each authority revises by
   * resolution, and an enum in the schema means a migration every time an authority adds a type.
   */
  @Column({ name: 'document_type', type: 'varchar', length: 8 })
  documentType: string;

  /**
   * The series the numbers belong to, in the form the market's authority uses (`F001`, a
   * resolution prefix, `001-001`, a série), as `MarketNumbering.acceptsSeries` allows it. Empty
   * where the market has none — the type and the numbers alone identify the document.
   */
  @Column({ name: 'series', type: 'varchar', length: 16, default: '' })
  series: string;

  @Column({ name: 'starts_at', type: 'bigint' })
  startsAt: number;

  @Column({ name: 'ends_at', type: 'bigint' })
  endsAt: number;

  /**
   * The last number handed out. `starts_at - 1` means none has been.
   *
   * Read and written under `SELECT … FOR UPDATE` inside the issuing transaction, never outside it.
   */
  @Column({ name: 'current_sequence', type: 'bigint' })
  currentSequence: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /**
   * When the authorisation expires, `YYYY-MM-DD`, where the market time-boxes it.
   *
   * A DIAN resolution and an SII CAF both expire; a Brazilian série does not. When set and past,
   * the range is unusable regardless of how many numbers remain — which is a refusal the tenant
   * needs to see before the authority produces it.
   */
  @Column({ name: 'valid_until', type: 'date', nullable: true })
  validUntil?: string | null;

  /** The administrative act that granted the range: resolution number, CAF id, authorisation. */
  @Column({ name: 'authorization_code', type: 'varchar', length: 128, nullable: true })
  authorizationCode?: string | null;

  /** Which secret `encryptedSecret` holds, or null when the range carries none. */
  @Column({ name: 'secret_kind', type: 'varchar', length: 24, nullable: true })
  secretKind?: FiscalRangeSecretKind | null;

  /**
   * The secret, AES-256-GCM through `CertificateVaultService`, or null.
   *
   * Same envelope as the stored PKCS#12s — `iv:tag:ciphertext`, base64 — so one key rotation
   * covers everything the vault holds rather than each secret having its own scheme.
   */
  @Column({ name: 'encrypted_secret', type: 'text', nullable: true })
  encryptedSecret?: string | null;

  /** Numbers left before the range is exhausted. */
  get remaining(): number {
    return Math.max(0, Number(this.endsAt) - Number(this.currentSequence));
  }
}
