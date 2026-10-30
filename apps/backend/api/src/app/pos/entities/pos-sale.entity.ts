import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer, numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { Organization } from '../../organizations/entities/organization.entity';
import { BranchRef, IssuedAtBranch } from '../../organizations/contracts/branch.contract';

export enum PosSaleStatus {
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

/**
 * One line as the SERVER priced it. Name, price and tax come from the catalogue at the moment of
 * sale, never from the till: the till only says which product and how many.
 */
export interface PosSaleItem {
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  taxRate: number;
  lineSubtotal: number;
  lineTax: number;
  /** A service line: reported as services in the 607 and credited to service revenue. */
  isService?: boolean;
}

/** One tender of a till sale. */
export interface PosPayment {
  method: 'cash' | 'card' | 'transfer' | 'other';
  amount: number;
  /** Card or transfer reference, when the cashier keyed one in. */
  reference?: string | null;
}

/**
 * A completed point-of-sale transaction and the lines that made it up.
 *
 * Consolidated from special-enigma's `PosSale`/`PosSaleItem`. The lines are stored as JSON rather
 * than a child table: a POS ticket is an immutable record of what was rung up, never edited
 * line-by-line afterwards, so the relational overhead buys nothing. `invoiceId` links to a fiscal
 * invoice when one is issued for the sale, and is null for a plain till receipt.
 */
@Index('IDX_pos_sales_org_branch', ['organizationId', 'branchId'])
@Entity({ name: 'pos_sales' })
@Index('IDX_pos_sales_org_created', ['organizationId', 'createdAt'])
@Index('IDX_pos_sales_org_shift', ['organizationId', 'shiftId'])
export class PosSale {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** `uuid` with the migration's own index and foreign-key names. See `PosShift`. */
  @Index('IDX_pos_sales_org')
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** The branch this was issued from — see `IssuedAtBranch`. Null for a company without branches, and for documents that predate them. */
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @IssuedAtBranch('FK_pos_sales_branch')
  branch?: BranchRef | null;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'organization_id',
    foreignKeyConstraintName: 'FK_pos_sales_organization',
  })
  organization: Organization;

  @Column({ length: 120 })
  terminalId: string;

  @Column({ type: 'uuid', nullable: true })
  shiftId: string | null;

  /** Who rang the sale. */
  @Column({ type: 'uuid', nullable: true })
  cashierId: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  items: PosSaleItem[];

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformerNotNull, default: 0 })
  subtotal: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformerNotNull, default: 0 })
  tax: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformerNotNull, default: 0 })
  total: number;

  @Column({ type: 'varchar', length: 60, nullable: true })
  paymentMethod: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customerName: string | null;

  /** Each tender of the sale — one for a plain payment, several for a mixed one (QA C-04). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  payments: PosPayment[];

  /** What the customer handed over in cash, when they paid in cash. */
  @Column({ name: 'amount_tendered', type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer, nullable: true })
  amountTendered: number | null;

  /** The change returned, always out of the cash tendered. */
  @Column({ name: 'change_due', type: 'numeric', precision: 14, scale: 2, transformer: numericTransformerNotNull, default: 0 })
  changeDue: number;

  @Column({ type: 'uuid', nullable: true })
  invoiceId: string | null;

  @Column({ type: 'enum', enum: PosSaleStatus, default: PosSaleStatus.PAID })
  status: PosSaleStatus;

  /** When a supervisor voided the sale; null while it stands. */
  @Column({ name: 'voided_at', type: 'timestamptz', nullable: true })
  voidedAt: Date | null;

  /** Who voided it — always a holder of `pos:manage_shifts`. */
  @Column({ name: 'voided_by_id', type: 'uuid', nullable: true })
  voidedById: string | null;

  /** Why, in the supervisor's words. Required to void. */
  @Column({ name: 'void_reason', type: 'varchar', length: 255, nullable: true })
  voidReason: string | null;

  /** The revenue entry: cash/bank against revenue and output tax (QA R3-C02). */
  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  /** The cost-of-sale entry, when stocked goods left the warehouse. */
  @Column({ name: 'cost_journal_entry_id', type: 'uuid', nullable: true })
  costJournalEntryId: string | null;

  /** What the goods cost when they left, valued as the kardex valued them. */
  @Column({ name: 'cost_of_sale', type: 'numeric', precision: 14, scale: 2, transformer: numericTransformerNotNull, default: 0 })
  costOfSale: number;

  /** The comprobante fiscal printed on the ticket (B02 in the Dominican Republic), when drawn. */
  @Column({ name: 'fiscal_number', type: 'varchar', length: 19, nullable: true })
  fiscalNumber: string | null;

  @Column({ name: 'fiscal_document_type', type: 'varchar', length: 8, nullable: true })
  fiscalDocumentType: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
