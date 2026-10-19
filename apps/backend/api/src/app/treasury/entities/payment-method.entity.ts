import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
} from 'typeorm';
import { blankToNullTransformer } from '../../common/database/blank-to-null.transformer';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import type { PaymentSettlementKind } from '../../contracts/country-pack/country-pack';

/**
 * A way the company is paid or pays: cash, ACH, Zelle, a DGII «forma de pago».
 *
 * ## Why it is tenant data now
 *
 * The screen used to be a constant — the DGII's 606 catalogue, 01 to 07 — shown to every company in
 * every market under the line «Fixed by the DGII for fiscal documents; they are not added or edited»
 * (QA C-06). For a Dominican company that is true. For a US company it meant there was no ACH, no
 * wire, no Zelle, and no way to add them.
 *
 * Whether the list is the authority's or the company's is a property of the market, declared by its
 * country pack (`paymentMethods.catalogue`). Every company gets the rows its market starts with;
 * where the authority fixes them (`AUTHORITY_FIXED`) they are `is_system` and the service refuses to
 * change them, and everywhere else the company adds, renames and retires its own.
 *
 * ## Two codes, on purpose
 *
 * `code` is what the company's documents record — unique per company, chosen by whoever created the
 * method. `fiscal_code` is what the authority's documents carry for it: the 606 «Forma de pago», the
 * CFDI `c_FormaPago`, DIAN's «Medio de pago», NF-e's `tPag`. They coincide for the DGII rows and
 * differ elsewhere («ZELLE» has no fiscal code at all; a Mexican «Transferencia SPEI» the company
 * adds maps to SAT's `03`). Without the second column a company that names its own methods could not
 * produce a valid stamped document; with only the second it could not name them.
 *
 * `kind` is how the method settles, in the vocabulary the invoice and the e-invoicing adapters
 * already speak (`invoices.payment_method`): a document paid by «Zelle» is a bank transfer to every
 * consumer that does not know what Zelle is.
 */
@Entity({ name: 'payment_methods' })
@Index('UQ_payment_methods_org_code', ['organizationId', 'code'], { unique: true })
@Check(
  'CHK_payment_methods_kind',
  `"kind" IN ('CASH','CHECK','CREDIT_CARD','DEBIT_CARD','CREDIT','BANK_TRANSFER','GIFT_CARD','SWAP','OTHER')`,
)
export class PaymentMethod {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_payment_methods' })
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** Erased with its tenant. */
  @TenantOwned('FK_payment_methods_organization')
  organization?: TenantRef;

  /** What documents record: `ACH`, `01`. Upper case, unique per company. */
  @Column({ length: 20 })
  code: string;

  @Column({ length: 120 })
  name: string;

  @Column({ name: 'kind', type: 'varchar', length: 20 })
  kind: PaymentSettlementKind;

  /** The authority's code for it, where the market has a catalogue. */
  @Column({ name: 'fiscal_code', type: 'varchar', length: 10, nullable: true, transformer: blankToNullTransformer })
  fiscalCode: string | null;

  /** Seeded from an authority's fixed catalogue: not renamed, recoded or retired. */
  @Column({ name: 'is_system', default: false })
  isSystem: boolean;

  /** Retired methods leave the pickers; the documents that used them keep the code. */
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 100 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
