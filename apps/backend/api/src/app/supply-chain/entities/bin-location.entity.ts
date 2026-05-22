
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Warehouse } from './warehouse.entity';

@Entity('bin_locations')
export class BinLocation extends BaseEntity {
  @ManyToOne(() => Warehouse)
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  @Column()
  code: string;

  @Column({ nullable: true })
  zone: string;

  @Column({ nullable: true })
  aisle: string;

  @Column({ nullable: true })
  rack: string;

  @Column({ nullable: true })
  shelf: string;
}
