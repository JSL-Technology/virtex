import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Warehouse } from './warehouse.entity';

/**
 * A named zone inside a warehouse (rack, aisle, bin).
 *
 * Moved from inventory/entities/warehouse.entity.ts — locations are part of the
 * warehouse model owned by supply-chain, not the product catalogue owned by inventory.
 */
@Entity({ name: 'locations' })
export class Location {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  /**
   * One-directional on purpose.
   *
   * The original file had an inverse side `warehouse => warehouse.locations` against a property
   * `Warehouse` does not have, which TypeORM refused to build. Nothing needs the reverse
   * traversal, so the relation says what it is.
   */
  @ManyToOne(() => Warehouse)
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse;

  @Column()
  warehouseId: string;
}
