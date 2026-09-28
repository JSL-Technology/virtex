
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Warehouse } from './warehouse.entity';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

@Entity('bin_locations')
export class BinLocation extends BaseEntity {
  @ManyToOne(() => Warehouse, { onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
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

  // Tenant-owned: deleting the tenant deletes this row (see TenantOwned).
  @TenantOwned('FK_bin_locations_organization')
  organization?: TenantRef;
}
