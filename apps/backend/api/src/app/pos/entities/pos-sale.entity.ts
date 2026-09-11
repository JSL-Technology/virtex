import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../../common/database/numeric.transformer';

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
@Index(['organizationId', 'createdAt'])
@Index(['organizationId', 'shiftId'])
export class PosSale {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  organizationId: string;

  @Column({ length: 120 })
  terminalId: string;

  @Column({ type: 'uuid', nullable: true })
  shiftId: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  items: PosSaleItem[];

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer, default: 0 })
  subtotal: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer, default: 0 })
  tax: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer, default: 0 })
  total: number;

  @Column({ type: 'varchar', length: 60, nullable: true })
  paymentMethod: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customerName: string | null;

  @Column({ type: 'uuid', nullable: true })
  invoiceId: string | null;

  @Column({ type: 'enum', enum: PosSaleStatus, default: PosSaleStatus.PAID })
  status: PosSaleStatus;

  @CreateDateColumn()
  createdAt: Date;
}
