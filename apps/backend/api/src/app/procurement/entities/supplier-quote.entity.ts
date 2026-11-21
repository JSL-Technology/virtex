import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { PurchaseRfq } from './purchase-rfq.entity';

export enum SupplierQuoteStatus {
  RECEIVED = 'RECEIVED',
  AWARDED = 'AWARDED',
  /** Another quotation won. */
  DECLINED = 'DECLINED',
}

/**
 * A supplier's answer to a request for quotation (CMP-15): its price per line, how long it holds,
 * and how soon it delivers. One per supplier and RFQ; recording it again replaces it while the RFQ
 * is open. Totals are computed here from the lines, never taken from the request.
 */
@Entity('supplier_quotes')
@Index('UQ_supplier_quotes_rfq_supplier', ['rfqId', 'supplierId'], { unique: true })
@Check('CHK_supplier_quotes_status', `"status" IN ('RECEIVED', 'AWARDED', 'DECLINED')`)
@Check('CHK_supplier_quotes_validity', `"valid_until" >= "received_on"`)
export class SupplierQuote extends BaseEntity {
  @Column({ name: 'rfq_id', type: 'uuid' })
  rfqId: string;

  @ManyToOne(() => PurchaseRfq, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rfq_id', foreignKeyConstraintName: 'FK_supplier_quotes_rfq' })
  rfq?: PurchaseRfq;

  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId: string;

  @ManyToOne('Supplier', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'supplier_id', foreignKeyConstraintName: 'FK_supplier_quotes_supplier' })
  supplier?: unknown;

  /** The supplier's own reference for the quotation. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  reference: string | null;

  @Column({ name: 'received_on', type: 'date' })
  receivedOn: string;

  @Column({ name: 'valid_until', type: 'date' })
  validUntil: string;

  @Column({ name: 'lead_time_days', type: 'int', nullable: true })
  leadTimeDays: number | null;

  @Column({ type: 'varchar', length: 16, default: SupplierQuoteStatus.RECEIVED })
  status: SupplierQuoteStatus;

  @Column('decimal', { precision: 18, scale: 2, default: 0, transformer: numericTransformerNotNull })
  subtotal: number;

  @Column('decimal', { name: 'tax_total', precision: 18, scale: 2, default: 0, transformer: numericTransformerNotNull })
  taxTotal: number;

  @Column('decimal', { precision: 18, scale: 2, default: 0, transformer: numericTransformerNotNull })
  total: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @OneToMany(() => SupplierQuoteLine, (line) => line.quote, { cascade: true })
  lines: SupplierQuoteLine[];

  @TenantOwned('FK_supplier_quotes_organization')
  organization?: TenantRef;
}

@Entity('supplier_quote_lines')
@Index('UQ_supplier_quote_lines', ['quoteId', 'rfqLineId'], { unique: true })
@Check('CHK_supplier_quote_lines_amounts', `"unit_price" >= 0 AND "tax_rate" >= 0 AND "tax_rate" <= 1`)
export class SupplierQuoteLine extends BaseEntity {
  @Column({ name: 'quote_id', type: 'uuid' })
  quoteId: string;

  @ManyToOne(() => SupplierQuote, (quote) => quote.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quote_id', foreignKeyConstraintName: 'FK_supplier_quote_lines_quote' })
  quote: SupplierQuote;

  @Column({ name: 'rfq_line_id', type: 'uuid' })
  rfqLineId: string;

  @ManyToOne('PurchaseRfqLine', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rfq_line_id', foreignKeyConstraintName: 'FK_supplier_quote_lines_rfq_line' })
  rfqLine?: unknown;

  @Column('decimal', { name: 'unit_price', precision: 18, scale: 6, transformer: numericTransformerNotNull })
  unitPrice: number;

  @Column('decimal', { name: 'tax_rate', precision: 9, scale: 6, default: 0, transformer: numericTransformerNotNull })
  taxRate: number;

  @TenantOwned('FK_supplier_quote_lines_organization')
  organization?: TenantRef;
}
