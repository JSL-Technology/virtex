import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import type { DeliveryNote } from './delivery-note.entity';
import { SalesOrderLine } from './sales-order-line.entity';

/** One line of a conduce: a quantity of an order line that left. */
@Entity({ name: 'delivery_note_lines' })
@Check('CHK_delivery_note_lines_quantity', `"quantity" > 0`)
export class DeliveryNoteLine {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_delivery_note_lines' })
  id: string;

  @Column({ name: 'delivery_note_id', type: 'uuid' })
  deliveryNoteId: string;

  @ManyToOne('DeliveryNote', 'lines', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'delivery_note_id', foreignKeyConstraintName: 'FK_delivery_note_lines_note' })
  deliveryNote?: DeliveryNote;

  @Column({ name: 'order_line_id', type: 'uuid' })
  orderLineId: string;

  @ManyToOne(() => SalesOrderLine, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'order_line_id', foreignKeyConstraintName: 'FK_delivery_note_lines_order_line' })
  orderLine?: SalesOrderLine;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @Column({ type: 'varchar', length: 500 })
  description: string;

  @Column({ type: 'numeric', precision: 18, scale: 6, transformer: numericTransformerNotNull })
  quantity: number;
}
