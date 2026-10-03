
import { Entity, Column, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { BillOfMaterialItem } from './bill-of-material-item.entity';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

@Entity('bill_of_materials')
export class BillOfMaterial extends BaseEntity {
  @Column()
  name: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ default: '1.0' })
  version: string;

  @Column({ default: true })
  isActive: boolean;

  @OneToMany(() => BillOfMaterialItem, (item) => item.billOfMaterial, { cascade: true })
  items: BillOfMaterialItem[];

  // Tenant-owned: deleting the tenant deletes this row (see TenantOwned).
  @TenantOwned('FK_bill_of_materials_organization')
  organization?: TenantRef;
}
