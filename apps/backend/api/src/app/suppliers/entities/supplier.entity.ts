import { Organization } from '../../organizations/entities/organization.entity';
import { TaxpayerType } from '../../localization/fiscal/withholding-regimes';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// One supplier per tax id in an organization (audit 2026-11-07, CMP-03). `tax_id_key` is kept by a
// trigger from `taxId` (letters and digits, upper case), so a dash or a space cannot make two.
export enum SupplierStatus {
  ACTIVE = 'ACTIVE',
  BLOCKED = 'BLOCKED',
}

@Index('UQ_suppliers_org_tax_id_key', ['organizationId', 'taxIdKey'], { unique: true, where: '"tax_id_key" IS NOT NULL' })
@Check('CHK_suppliers_payment_term_days', `"payment_term_days" IS NULL OR ("payment_term_days" >= 0 AND "payment_term_days" <= 365)`)
@Check('CHK_suppliers_status', `"status" IN ('ACTIVE', 'BLOCKED')`)
@Entity({ name: 'suppliers' })
// Both halves of the document reference travel together: a code with no country cannot be
// resolved — a "cédula" is eleven Luhn-checked digits in Santo Domingo and six to ten
// unchecked ones in Bogotá — and a country with no code records a document whose kind is
// unknown.
@Check(
  'CK_suppliers_identity_document_pair',
  `("identity_document_type_code" IS NULL AND "identity_document_country" IS NULL)
    OR ("identity_document_type_code" IS NOT NULL AND "identity_document_country" IS NOT NULL)`,
)
export class Supplier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  contactPerson?: string;

  @Column({ nullable: true })
  email?: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  taxId?: string;

  /**
   * The kind of identifier `taxId` holds, from the identity-document catalogue.
   *
   * Purchasing had the same gap sales did: a bare varchar with no type and no validation, so a
   * supplier's RNC and a supplier's cédula were the same column with no way to tell them apart —
   * and the 606 filing that reports purchases needs to state which. See `Customer` for the full
   * reasoning; the two are deliberately modelled identically, because they are the same concept.
   */
  @Column({
    name: 'identity_document_type_code',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  identityDocumentTypeCode?: string | null;

  /**
   * The document's issuing country, which is the SUPPLIER's.
   *
   * Distinct from `country` below, which is where the supplier is established: a Dominican company
   * can hold a document issued elsewhere, and a payment abroad is reported on the 609 by where the
   * supplier is, not by which registry issued their identifier.
   */
  @Column({
    name: 'identity_document_country',
    type: 'char',
    length: 2,
    nullable: true,
  })
  identityDocumentCountry?: string | null;

  @Column({ nullable: true })
  address?: string;

  /**
   * ISO 3166-1 alpha-2 country of the supplier.
   *
   * Needed to tell a domestic purchase from a payment abroad: the DGII's 609 reports the latter
   * with the income tax withheld at source, and without a country there is no way to separate them.
   *
   * The column carried `DEFAULT 'DO'`, so a supplier created by a Chilean tenant was recorded as
   * Dominican unless somebody said otherwise — and "domestic or abroad" is precisely the question
   * this column exists to answer, so a wrong default here is a wrong filing. There is no default
   * now; `SuppliersService` fills it from the TENANT's country, which is the correct assumption
   * for a supplier created without one.
   */
  @Column({ type: 'varchar', length: 2, nullable: true })
  country?: string | null;

  /**
   * The supplier's fiscal classification — the fact that decides what we withhold from them.
   *
   * The customer record has carried this for some time and the supplier record did not, which is
   * why the withholding on a purchase arrived as a free number on the request: nothing on the
   * supplier could establish the rate. In the Dominican Republic it is the difference between
   * withholding 100 % of the ITBIS and 10 % of the fee on a service bought from a persona física,
   * and withholding nothing at all from a company.
   *
   * Assigned by the tax authority, recorded by the tenant, never inferred: the shape of an RNC and
   * the words in a company name establish nothing. Null means unclassified, and nothing is
   * withheld automatically — a bill may still state a withholding, as an exception with a reason.
   */
  @Column({
    name: 'taxpayer_type',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  taxpayerType?: TaxpayerType | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  /** `taxId` normalized; written by the database trigger, never by the application. */
  @Column({ name: 'tax_id_key', type: 'varchar', length: 40, nullable: true, insert: false, update: false, select: false })
  taxIdKey?: string | null;

  // ── Commercial terms (audit 2026-11-07, CMP-17) ─────────────────────────────

  /** Days of credit the supplier gives; a bill's due date defaults from it. */
  @Column({ name: 'payment_term_days', type: 'int', nullable: true })
  paymentTermDays?: number | null;

  /** The currency the supplier bills in; a bill with no currency takes it. */
  @Column({ name: 'currency_code', type: 'varchar', length: 3, nullable: true })
  currencyCode?: string | null;

  /** Where a free expense line from this supplier goes when the line names no account. */
  @Column({ name: 'default_expense_account_id', type: 'uuid', nullable: true })
  defaultExpenseAccountId?: string | null;

  // By name: the account is the chart-of-accounts module's (verify:boundaries).
  @ManyToOne('Account', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'default_expense_account_id', foreignKeyConstraintName: 'FK_suppliers_default_expense_account' })
  defaultExpenseAccount?: unknown;

  /** A BLOCKED supplier can be neither billed nor paid until it is reactivated. */
  @Column({ type: 'varchar', length: 10, default: SupplierStatus.ACTIVE })
  status: SupplierStatus;

  @Column({ name: 'blocked_reason', type: 'text', nullable: true })
  blockedReason?: string | null;
}
