
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
} from 'typeorm';
import { CustomerAddress } from './customer-address.entity';
import { CustomerContact } from './customer-contact.entity';
import { CustomerGroup } from './customer-group.entity';
import { User } from '../../users/entities/user.entity/user.entity';

export enum CustomerStatus {
  LEAD = 'LEAD',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ON_HOLD = 'ON_HOLD',
}

@Entity({ name: 'customers' })
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;



  @Column({ nullable: true })
  companyName: string;

  @Column({ nullable: true })
  contactPerson?: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true, unique: true })
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
  
  @ManyToOne(() => CustomerGroup, (group) => group.customers, { nullable: true })
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