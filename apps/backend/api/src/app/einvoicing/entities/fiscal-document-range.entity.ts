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
 * - **`CAF_XML`** — Chile. The SII's *Código de Autorización de Folios* is an XML that contains the
 *   authorised range **and an RSA private key**. Every DTE drawn from that range carries a `TED`
 *   sealed with that key, and the SII verifies the seal against the public key it issued with the
 *   range. Losing it means the folios cannot be used; leaking it means someone else can stamp
 *   documents in the taxpayer's name.
 * - **`DIAN_TECHNICAL_KEY`** — Colombia. The *ClaveTécnica* is issued with the invoicing resolution
 *   and is an input to the CUFE. It is not a signing key, but it is a shared secret, and a CUFE
 *   computed with someone else's is a forgery.
 *
 * Both are stored encrypted, never in a plain column. That is not caution for its own sake: a
 * database dump with these in the clear lets the reader issue fiscal documents as the taxpayer.
 */
export enum FiscalRangeSecretKind {
  CAF_XML = 'CAF_XML',
  DIAN_TECHNICAL_KEY = 'DIAN_TECHNICAL_KEY',
}

/**
 * A range of document numbers an authority authorised a tenant to issue.
 *
 * ## Why this is not `ncf_sequences`
 *
 * `ncf_sequences` is the Dominican version of exactly this idea, and it is correct — for the DGII.
 * It types its range with `NcfType`, an enum of DGII comprobante codes, and it has no room for a
 * series prefix (`F001`), an establishment and emission point (`001-001`), a resolution number, or
 * a secret. Widening it would have meant six markets' concepts crowding into a table named after
 * one, so the Dominican table keeps its shape and this one carries the rest.
 *
 * ## The invariant that matters
 *
 * A fiscal number is handed out exactly once. `current_sequence` is advanced under a row lock in
 * the same transaction that issues the document — the pattern `ComplianceService.getNextNcf`
 * already uses — because two concurrent issuances that both read the counter before either writes
 * it produce two documents with the same number, and an authority that receives the second one
 * rejects it and asks the taxpayer to explain the first.
 *
 * *Verificar con contabilidad/legal*: every one of these ranges is issued by a specific
 * administrative act — a DIAN resolution, a SUNAT series authorisation, an SRI establishment, a
 * SEFAZ série, an SII CAF — and the act's own reference is recorded in `authorizationCode` so the
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
   * The authority's own document-type code: `01` factura (CO/PE/EC/AR), `33` DTE afecta (CL),
   * `55` NF-e (BR), `I` ingreso (MX).
   *
   * Deliberately a code and not an enum. These come from catalogues each authority revises by
   * resolution, and an enum in the schema means a migration every time one of seven authorities
   * adds a document type.
   */
  @Column({ name: 'document_type', type: 'varchar', length: 8 })
  documentType: string;

  /**
   * The series the numbers belong to, in whatever form the market uses.
   *
   * `F001` in Peru, the resolution prefix in Colombia, `001-001` (establecimiento-punto de emisión)
   * in Ecuador, the série in Brazil, the punto de venta in Argentina. Empty where the market has no
   * series — the numbers alone identify the document.
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
