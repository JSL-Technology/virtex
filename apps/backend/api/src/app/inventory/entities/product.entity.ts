
import { Organization } from '../../organizations/entities/organization.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';

export enum ProductStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
}


export enum TrackingMethod {
  NONE = 'NONE',
  LOT = 'LOT',
  SERIAL_NUMBER = 'SERIAL_NUMBER',
}

export enum CostingMethod {
  FIFO = 'FIFO',
  LIFO = 'LIFO',
  WEIGHTED_AVERAGE = 'WEIGHTED_AVERAGE',
  STANDARD = 'STANDARD',
}

@Entity({ name: 'products' })
@Index(['organizationId', 'sku'], { unique: true, where: '"sku" IS NOT NULL' })
@Index(['organizationId', 'name'], { unique: true })
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 50, nullable: true })
  sku?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ length: 100, nullable: true })
  category?: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0.0 })
  price: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0.0 })
  cost: number;

  @Column({ type: 'int', default: 0 })
  stock: number;

  @Column({ name: 'reorder_level', type: 'int', nullable: true })
  reorderLevel?: number;

  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl?: string;

  @Column({
    type: 'enum',
    enum: ProductStatus,
    default: ProductStatus.ACTIVE,
  })
  status: ProductStatus;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({
    type: 'enum',
    enum: TrackingMethod,
    default: TrackingMethod.NONE,
    comment:
      'Define si el producto se traza por lote, número de serie o ninguno.',
  })
  trackingMethod: TrackingMethod;

  @Column({
    type: 'enum',
    enum: CostingMethod,
    default: CostingMethod.WEIGHTED_AVERAGE,
    comment: 'Método de costeo para el producto.',
  })
  costingMethod: CostingMethod;
}
