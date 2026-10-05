import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { Warehouse } from '../../supply-chain/entities/warehouse.entity';
import { Product } from './product.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

export enum StockTransferStatus {
  DRAFT = 'DRAFT',
  POSTED = 'POSTED',
  CANCELLED = 'CANCELLED',
}

/**
 * Goods moved from one warehouse to another inside the same company.
 *
 * Nothing changes in the books — the goods stay in the same inventory account at the same cost —
 * so there is no journal entry; what changes is where they are, which is exactly what the
 * warehouse balances and the kardex must show (SAP 301/311, NetSuite Transfer Order, Odoo internal
 * transfer). Posted in one step: both legs happen together, so the company total never moves.
 */
@Entity({ name: 'stock_transfers' })
@Check('CHK_stock_transfers_distinct_warehouses', '"from_warehouse_id" <> "to_warehouse_id"')
@Index('UQ_stock_transfers_org_number', ['organizationId', 'number'], { unique: true })
@Index('IDX_stock_transfers_org_date', ['organizationId', 'date'])
export class StockTransfer extends BaseEntity {
  @Column({ type: 'varchar', length: 40 })
  number: string;

  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => Warehouse, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'from_warehouse_id', foreignKeyConstraintName: 'FK_stock_transfers_from_warehouse' })
  fromWarehouse?: Warehouse;

  @Column({ name: 'from_warehouse_id', type: 'uuid' })
  fromWarehouseId: string;

  @ManyToOne(() => Warehouse, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'to_warehouse_id', foreignKeyConstraintName: 'FK_stock_transfers_to_warehouse' })
  toWarehouse?: Warehouse;

  @Column({ name: 'to_warehouse_id', type: 'uuid' })
  toWarehouseId: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 16, default: StockTransferStatus.DRAFT })
  status: StockTransferStatus;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @Column({ name: 'posted_by_user_id', type: 'uuid', nullable: true })
  postedByUserId: string | null;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt: Date | null;

  @OneToMany(() => StockTransferLine, (line) => line.transfer, { cascade: true })
  lines: StockTransferLine[];

  // Tenant-owned: deleting the tenant deletes this row (see TenantOwned).
  @TenantOwned('FK_stock_transfers_organization')
  organization?: TenantRef;
}

@Entity({ name: 'stock_transfer_lines' })
@Check('CHK_stock_transfer_lines_positive', '"quantity" > 0')
export class StockTransferLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => StockTransfer, (transfer) => transfer.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transfer_id', foreignKeyConstraintName: 'FK_stock_transfer_lines_transfer' })
  transfer?: StockTransfer;

  @Column({ name: 'transfer_id', type: 'uuid' })
  transferId: string;

  @ManyToOne(() => Product, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'product_id', foreignKeyConstraintName: 'FK_stock_transfer_lines_product' })
  product?: Product;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'decimal', precision: 18, scale: 6, transformer: numericTransformerNotNull })
  quantity: number;
}
