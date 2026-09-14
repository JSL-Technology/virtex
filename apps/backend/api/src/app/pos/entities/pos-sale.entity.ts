import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { Organization } from '../../organizations/entities/organization.entity';

export enum PosSaleStatus {
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

export interface PosSaleItem {
  productId: string;
  productName: string;
  price: number;
  quantity: number;
}

/**
 * A completed point-of-sale transaction and the lines that made it up.
 *
 * Consolidated from special-enigma's `PosSale`/`PosSaleItem`. The lines are stored as JSON rather
 * than a child table: a POS ticket is an immutable record of what was rung up, never edited
 * line-by-line afterwards, so the relational overhead buys nothing. `invoiceId` links to a fiscal
 * invoice when one is issued for the sale, and is null for a plain till receipt.
 */
@Entity({ name: 'pos_sales' })
@Index('IDX_pos_sales_org_created', ['organizationId', 'createdAt'])
@Index('IDX_pos_sales_org_shift', ['organizationId', 'shiftId'])
export class PosSale {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** `uuid` with the migration's own index and foreign-key names. See `PosShift`. */
  @Index('IDX_pos_sales_org')
  @Column({ type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'organizationId',
    foreignKeyConstraintName: 'FK_pos_sales_organization',
  })
  organization: Organization;

  @Column({ length: 120 })
  terminalId: string;

  @Column({ type: 'uuid', nullable: true })
  shiftId: string | null;

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

  @Column({ type: 'uuid', nullable: true })
  invoiceId: string | null;

  @Column({ type: 'enum', enum: PosSaleStatus, default: PosSaleStatus.PAID })
  status: PosSaleStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
