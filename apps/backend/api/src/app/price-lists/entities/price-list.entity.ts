
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
  Index,
} from 'typeorm';
import { PriceListItem } from './price-list-item.entity';

export enum PriceListStatus {
  DRAFT = 'Draft',
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
}

@Entity({ name: 'price_lists' })
@Index('IDX_price_lists_org_status', ['organizationId', 'status'])
// At most one default list per currency (FAC-PL-01).
@Index('UQ_price_lists_default_currency', ['organizationId', 'currency'], { unique: true, where: '"is_default"' })
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

  /**
   * The list for every customer that has none of its own, in this currency. At most one per
   * currency (partial unique index); setting it on one list clears it on the others.
   */
  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

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