import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Customer } from './customer.entity';

export enum AddressType {
  BILLING = 'BILLING',
  SHIPPING = 'SHIPPING',
  OTHER = 'OTHER',
}

@Entity({ name: 'customer_addresses' })
export class CustomerAddress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Customer, (customer) => customer.addresses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ name: 'customer_id' })
  customerId: string;

  @Column({ type: 'enum', enum: AddressType, default: AddressType.SHIPPING })
  type: AddressType;

  @Column()
  addressLine1: string;

  @Column({ nullable: true })
  addressLine2?: string;

  @Column()
  city: string;

  @Column()
  stateOrProvince: string;

  @Column()
  postalCode: string;

  @Column()
  country: string;

  @Column({ default: false })
  isPrimary: boolean;
}