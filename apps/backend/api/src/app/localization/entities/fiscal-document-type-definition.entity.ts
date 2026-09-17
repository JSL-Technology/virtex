import { Check, Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { FiscalRegion } from './fiscal-region.entity';
import type { FiscalDocumentSide } from '../fiscal/fiscal-document-type-catalogue';

/**
 * One fiscal document type an authority publishes — a comprobante, a DTE, a CFDI class.
 *
 * ## The table existed and nothing used it
 *
 * `fiscal_document_type_definitions` has been in the baseline schema since the beginning, related
 * to `fiscal_regions`, with `code`, `name`, `sequenceFormat` and `expirationRequired`. A search of
 * the repository found zero queries, zero inserts and zero seeds. Meanwhile the same data lived
 * hardcoded as `enum NcfType` in `compliance/`, persisted as a PostgreSQL enum on two tables — so
 * adding Peru's `01`/`03` or Chile's `33`/`34` meant `ALTER TYPE … ADD VALUE`, a migration and a
 * deploy, in a type that can never lose a value again.
 *
 * The shape was right. It is now populated, referenced by `ncf_sequences.type` and
 * `ecf_lifecycle_messages.ecf_type`, and the enum is gone from the schema.
 *
 * ## Why the added columns
 *
 * `name` alone could not drive a form: the invoicing adapter needs to know which types are
 * issuable as a sale, which credit an earlier document, which are transmitted electronically and
 * which require the buyer's tax id — facts that were encoded as `SALES_NCF_TYPES`,
 * `CREDIT_NOTE_NCF_TYPES`, `isElectronicNcfType()` and a `code === NcfType.E31` comparison. Those
 * are properties of the document type, so they belong on the document type.
 */
@Entity({ name: 'fiscal_document_type_definitions' })
@Index('UQ_fiscal_document_type_definitions', ['fiscalRegionId', 'code'], { unique: true })
@Check('CK_fiscal_document_type_definitions_side', `"side" IN ('sales', 'purchase', 'either')`)
export class FiscalDocumentTypeDefinition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The authority's own code, written verbatim into the document. `E31`, `01`, `33`, `55`. */
  @Column()
  code: string;

  /** The authority's own name, for support and for a fallback when no translation exists. */
  @Column()
  name: string;

  /**
   * Catalogue key for the label.
   *
   * `name` is the authority's wording and stays as it is; this is what a screen renders. Nullable
   * for a row an operator inserted without one, in which case `name` is shown.
   */
  @Column({ name: 'label_key', type: 'varchar', length: 128, nullable: true })
  labelKey: string | null;

  /** Mask for a number drawn from a range of this type, where the authority fixes one. */
  @Column({ nullable: true })
  sequenceFormat: string;

  @Column({ default: false })
  expirationRequired: boolean;

  /** True when the type must be signed and transmitted to the authority. */
  @Column({ name: 'is_electronic', type: 'boolean', default: false })
  isElectronic: boolean;

  /** `sales` | `purchase` | `either`. A purchase type offered on a sales document is rejected. */
  @Column({ name: 'side', type: 'varchar', length: 16, default: 'sales' })
  side: FiscalDocumentSide;

  /** True when the type credits a previously issued document. */
  @Column({ name: 'is_credit_note', type: 'boolean', default: false })
  isCreditNote: boolean;

  /** True when the authority refuses the document without the buyer's tax identifier. */
  @Column({ name: 'requires_buyer_tax_id', type: 'boolean', default: false })
  requiresBuyerTaxId: boolean;

  @Column({ name: 'sort_order', type: 'smallint', default: 0 })
  sortOrder: number;

  @Column({ name: 'fiscalRegionId', type: 'uuid', nullable: true })
  fiscalRegionId: string | null;

  @ManyToOne('FiscalRegion', 'documentDefinitions')
  fiscalRegion: FiscalRegion;
}
