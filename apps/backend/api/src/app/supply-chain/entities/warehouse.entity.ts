
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

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
}
