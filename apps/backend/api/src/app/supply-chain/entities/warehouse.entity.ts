
import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { BranchRef, IssuedAtBranch } from '../../organizations/contracts/branch.contract';

@Index('IDX_warehouses_org_branch', ['organizationId', 'branchId'])
@Entity('warehouses')
export class Warehouse extends BaseEntity {
  @Column()
  name: string;

  @Column({ nullable: true })
  code: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ name: 'address_line1', nullable: true })
  addressLine1: string;

  @Column({ name: 'city', nullable: true })
  city: string;

  @Column({ name: 'country_code', nullable: true })
  countryCode: string;

  /** The branch this warehouse serves. Null for a company without branches. */
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @IssuedAtBranch('FK_warehouses_branch')
  branch?: BranchRef | null;

  // Tenant-owned: deleting the tenant deletes this row (see TenantOwned).
  @TenantOwned('FK_warehouses_organization')
  organization?: TenantRef;
}
