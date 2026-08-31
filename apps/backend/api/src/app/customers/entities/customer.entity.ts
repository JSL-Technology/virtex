
import { Organization } from '../../organizations/entities/organization.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { CustomerAddress } from './customer-address.entity';
import { CustomerContact } from './customer-contact.entity';
import type { CustomerGroup } from './customer-group.entity';
import { User } from '../../users/entities/user.entity/user.entity';

export enum CustomerStatus {
  LEAD = 'LEAD',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ON_HOLD = 'ON_HOLD',
}

/**
 * A customer belongs to ONE tenant, and so does its uniqueness.
 *
 * `email` and `taxId` carried platform-wide unique constraints on a table that is scoped by
 * `organization_id`. Two consequences, both serious for a product sold to many companies in the
 * same market:
 *
 *   - two tenants could not have the same customer, which in Latin America is the ordinary case —
 *     a distributor and its competitor invoice the same supermarket chain, and the second one to
 *     type the RNC was refused;
 *   - the refusal was an oracle. Any tenant could probe a tax id and learn, from the conflict,
 *     that another tenant already had that customer.
 *
 * `organizations` had already been corrected the same way, to `(tax_id, fiscal_region_id)`. These
 * are the composite indexes that finish the job.
 */
@Entity({ name: 'customers' })
@Index('UQ_customers_org_email', ['organizationId', 'email'], { unique: true })
@Index('UQ_customers_org_tax_id', ['organizationId', 'taxId'], {
  unique: true,
  where: '"taxId" IS NOT NULL',
})
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;



  @Column({ nullable: true })
  companyName: string;

  @Column({ nullable: true })
  contactPerson?: string;

  @Column()
  email: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  taxId?: string;
  

  @Column({ nullable: true, type: 'text' })
  address?: string;

  @Column({ nullable: true })
  city?: string;

  @Column({ nullable: true })
  stateOrProvince?: string;

  @Column({ nullable: true })
  postalCode?: string;

  @Column({ nullable: true })
  country: string;



  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0.0 })
  totalBilled: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;



  @Column({
    type: 'enum',
    enum: CustomerStatus,
    default: CustomerStatus.LEAD,
  })
  status: CustomerStatus;

  @Column({ nullable: true })
  industry?: string;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'account_owner_id' })
  accountOwner?: User;

  @Column({ name: 'account_owner_id', type: 'uuid', nullable: true })
  accountOwnerId?: string;

  @OneToMany(() => CustomerContact, (contact) => contact.customer, { cascade: true, eager: true })
  contacts: CustomerContact[];

  @OneToMany(() => CustomerAddress, (address) => address.customer, { cascade: true, eager: true })
  addresses: CustomerAddress[];
  
  @ManyToOne('CustomerGroup', 'customers', { nullable: true })
  @JoinColumn({ name: 'customer_group_id' })
  group?: CustomerGroup;
  
  @Column({ name: 'customer_group_id', type: 'uuid', nullable: true })
  groupId?: string;

  @Column({ nullable: true })
  paymentTerms?: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  creditLimit?: number;

  @Column({ name: 'default_sales_account_id', type: 'uuid', nullable: true })
  defaultSalesAccountId?: string;
}