import { Entity, PrimaryGeneratedColumn, Column, OneToMany, Index } from 'typeorm';
import { Customer } from './customer.entity';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

@Entity({ name: 'customer_groups' })
// Unique per company, not across the platform: a global unique name let one tenant block — and
// detect — another's group names (audit 2026-11).
@Index('UQ_customer_groups_org_name', ['organizationId', 'name'], { unique: true })
export class CustomerGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @OneToMany(() => Customer, (customer) => customer.group)
  customers: Customer[];

  // Tenant-owned: deleting the tenant deletes this row (see TenantOwned).
  @TenantOwned('FK_customer_groups_organization')
  organization?: TenantRef;
}