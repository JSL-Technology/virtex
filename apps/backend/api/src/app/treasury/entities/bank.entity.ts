import {
  Check,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { blankToNullTransformer } from '../../common/database/blank-to-null.transformer';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

/**
 * The kind of institution, in the categories banking regulators license them under. Kept as the
 * category rather than a national label («banco múltiple», «asociación») so one list serves every
 * country; the label is the client's to translate.
 */
export const BANK_KINDS = [
  'multiple_bank',
  'savings_credit_bank',
  'savings_loan_association',
  'credit_corporation',
  'other',
] as const;
export type BankKind = (typeof BANK_KINDS)[number];

/**
 * A bank the tenant deals with: the institution, not an account at it.
 *
 * ## Why it is a catalogue of its own
 *
 * «Bancos» used to be a page that deduced the list from the tenant's own bank accounts — one row
 * per distinct `bank_name` typed into them, with no table behind it. So the same bank typed twice
 * («Banco Popular», «Popular») was two banks, and a bank the company pays suppliers or employees
 * into, without holding an account there itself, could not exist at all.
 *
 * A bank directory is a master in its own right in SAP (FI12) and Odoo (Contactos › Bancos): the
 * institution's name, its SWIFT/BIC and its local clearing code, kept once and referenced by every
 * account that lives there. Bank accounts point at it (`bank_accounts.bank_id`) and copy its name
 * and BIC, so a statement can still be matched by those fields after the catalogue entry changes.
 */
@Entity({ name: 'banks' })
@Index('UQ_banks_org_name', ['organizationId', 'name'], { unique: true })
@Check(
  'CHK_banks_kind',
  `"kind" IS NULL OR "kind" IN ('multiple_bank','savings_credit_bank','savings_loan_association','credit_corporation','other')`,
)
export class Bank {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_banks' })
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** Erased with its tenant. */
  @TenantOwned('FK_banks_organization')
  organization?: TenantRef;

  /** «Banco Popular Dominicano». Unique per tenant: one institution, one entry. */
  @Column({ length: 120 })
  name: string;

  /**
   * The registered name («Banco Popular Dominicano, S. A. - Banco Múltiple»), which is what a
   * statement, a withholding certificate or a tax form names the bank by.
   */
  @Column({ name: 'legal_name', type: 'varchar', length: 200, nullable: true, transformer: blankToNullTransformer })
  legalName: string | null;

  /** The institution's taxpayer number (the RNC in the Dominican Republic), as entered. */
  @Column({ name: 'tax_id', type: 'varchar', length: 20, nullable: true, transformer: blankToNullTransformer })
  taxId: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, transformer: blankToNullTransformer })
  kind: BankKind | null;

  @Column({ name: 'swift_bic', type: 'varchar', length: 11, nullable: true, transformer: blankToNullTransformer })
  swiftBic: string | null;

  /** ISO 3166-1 alpha-2 of the country the institution is chartered in. */
  @Column({ name: 'country_code', type: 'varchar', length: 2, nullable: true, transformer: blankToNullTransformer })
  countryCode: string | null;

  /**
   * The local clearing identifier: the ACH routing code, the CLABE bank prefix, the code the
   * central bank assigns. Free text because its shape is national.
   */
  @Column({ name: 'local_code', type: 'varchar', length: 20, nullable: true, transformer: blankToNullTransformer })
  localCode: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
