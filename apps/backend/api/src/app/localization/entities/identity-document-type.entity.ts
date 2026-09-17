import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type {
  CanonicalForm,
  DocumentAppliesTo,
  DocumentContext,
  DocumentRequirement,
} from '../fiscal/identity-document-catalogue';

/**
 * One identity document a jurisdiction issues.
 *
 * Global reference data, not tenant-scoped: the fact that Colombia issues a cédula de ciudadanía
 * is not a property of any customer. Seeded at boot from `IDENTITY_DOCUMENT_TYPES`, and readable
 * at runtime from here — which is what makes adding a document an INSERT rather than a deploy.
 *
 * The natural key is `(country_code, code)`, and it is the key the business tables reference. A
 * surrogate `id` exists because the rest of the schema uses one, but nothing joins on it: a
 * foreign key to `(country_code, code)` is what makes `employees.identity_document_type_code`
 * readable in a query and impossible to point at a document the country does not issue.
 *
 * ## Why the label is a key and not a word
 *
 * `fiscal_regions.tax_id_name` stored `'RNC'` — the word — with a DEFAULT of `'Tax ID'` in
 * English. Anything rendering it showed untranslatable text. Here the label is `label_key`, and
 * `label_verbatim` is the deliberate exception: terminology the authority prints, which must
 * survive translation intact because the user is copying it off a physical document.
 */
@Entity({ name: 'identity_document_types' })
// The natural key. A unique INDEX rather than a unique CONSTRAINT: PostgreSQL accepts either as
// the target of a foreign key, and an index is what TypeORM models — declaring it as a constraint
// meant the schema-drift check saw an object the entities did not describe and wanted to drop it.
@Index('UQ_identity_document_types_country_code', ['countryCode', 'code'], { unique: true })
@Index('IDX_identity_document_types_country', ['countryCode', 'sortOrder'])
// The three closed vocabularies, as CHECKs rather than PostgreSQL enums. A CHECK can be dropped
// and rewritten inside an ordinary transaction; an enum can never lose a value, which is the
// defect this whole table exists to undo. Repeating it one level down would be an odd fix.
@Check('CK_identity_document_types_applies_to', `"applies_to" IN ('individual', 'company', 'both')`)
@Check('CK_identity_document_types_requirement', `"requirement" IN ('required', 'optional')`)
@Check(
  'CK_identity_document_types_canonical_form',
  `"canonical_form" IN ('digits', 'alphanumeric', 'segmented')`,
)
export class IdentityDocumentType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** ISO 3166-1 alpha-2 of the issuing jurisdiction, or `XX` for a supranational document. */
  @Column({ name: 'country_code', type: 'char', length: 2 })
  countryCode: string;

  /** The authority's own code. Declared, never derived from the label. */
  @Column({ name: 'code', type: 'varchar', length: 32 })
  code: string;

  @Column({ name: 'label_key', type: 'varchar', length: 128 })
  labelKey: string;

  /** Authority terminology that must not be translated. Wins over `labelKey` when present. */
  @Column({ name: 'label_verbatim', type: 'varchar', length: 64, nullable: true })
  labelVerbatim: string | null;

  /** Placeholder shaped like a real value. Never a real issued identifier. */
  @Column({ name: 'example', type: 'varchar', length: 64, nullable: true })
  example: string | null;

  /** Anchored both ends. Shape only; `checksum` is the authoritative check and runs server-side. */
  @Column({ name: 'pattern', type: 'varchar', length: 256 })
  pattern: string;

  /**
   * The NAME of a check-digit algorithm, resolved through `CHECKSUM_ALGORITHMS`.
   *
   * Null means the pattern is the whole check — correct for a passport, and an acknowledged
   * weakness for a document whose published rule this product has not implemented yet. It is
   * never a licence to skip validation: a row naming an algorithm that does not resolve is
   * rejected outright rather than degraded to pattern-only.
   */
  @Column({ name: 'checksum', type: 'varchar', length: 48, nullable: true })
  checksum: string | null;

  @Column({ name: 'canonical_form', type: 'varchar', length: 32, default: 'alphanumeric' })
  canonicalForm: CanonicalForm;

  /** `individual` | `company` | `both`. Ternary, because a Chilean RUT identifies both. */
  @Column({ name: 'applies_to', type: 'varchar', length: 16 })
  appliesTo: DocumentAppliesTo;

  /** `required` | `optional`. "Not issued here" is the ABSENCE of the row, never a third value. */
  @Column({ name: 'requirement', type: 'varchar', length: 16 })
  requirement: DocumentRequirement;

  /** Contexts the document is asked for: payroll, invoicing, registration. */
  @Column({ name: 'used_for', type: 'text', array: true, default: () => "'{}'" })
  usedFor: DocumentContext[];

  /** Pre-selected in a form. Replaces the `DEFAULT 'CEDULA'` the enum carried. */
  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @Column({ name: 'issuing_authority', type: 'varchar', length: 64, nullable: true })
  issuingAuthority: string | null;

  /**
   * Superseded documents are deactivated, never deleted.
   *
   * A reform that replaces a document does not un-issue the ones already recorded: an employee
   * hired in 2019 has the old one on their file, and a row that disappears turns that stored value
   * into an unresolvable reference. `valid_until` in the past hides it from new forms and leaves
   * historical rows readable.
   */
  @Column({ name: 'valid_from', type: 'date', nullable: true })
  validFrom: string | null;

  @Column({ name: 'valid_until', type: 'date', nullable: true })
  validUntil: string | null;

  @Column({ name: 'sort_order', type: 'smallint', default: 0 })
  sortOrder: number;
}
