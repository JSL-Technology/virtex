
import { Organization } from '../../organizations/entities/organization.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { PriceListItem } from './price-list-item.entity';

export enum PriceListStatus {
  DRAFT = 'Draft',
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
}

@Entity({ name: 'price_lists' })
export class PriceList {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  currency: string;

  @Column({ type: 'date' })
  validFrom: Date;

  @Column({ type: 'date' })
  validTo: Date;

  @Column({
    type: 'enum',
    enum: PriceListStatus,
    default: PriceListStatus.DRAFT,
  })
  status: PriceListStatus;

  @OneToMany(() => PriceListItem, (item) => item.priceList, {
    cascade: true,
    eager: true,
  })
  items: PriceListItem[];

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}