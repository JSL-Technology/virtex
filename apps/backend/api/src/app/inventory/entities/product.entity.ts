
import { Organization } from '../../organizations/entities/organization.entity';
import {
  numericTransformer,
  numericTransformerNotNull,
} from '../../common/database/numeric.transformer';
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

/**
 * Whether the item is a good or a service.
 *
 * Every fiscal regime the product targets asks for this per line — the DGII's
 * `IndicadorBienoServicio`, the 606/607 split between "monto facturado en bienes" and "en
 * servicios", Mexico's CFDI `ClaveProdServ`. The catalogue had no such attribute, so every e-CF was
 * transmitted declaring goods, including a consultancy hour.
 */
export enum ProductKind {
  GOOD = 'GOOD',
  SERVICE = 'SERVICE',
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

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 6,
    default: 0.0,
    transformer: numericTransformerNotNull,
  })
  price: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 6,
    default: 0.0,
    transformer: numericTransformerNotNull,
  })
  cost: number;

  /**
   * On-hand quantity, at six decimals.
   *
   * It was an integer while the invoice line now bills fractional quantities: selling 1.5 kg of a
   * stocked good failed with `invalid input syntax for type integer`. Weight, volume and time are
   * ordinary units of sale.
   */
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  stock: number;

  /**
   * Good or service. Services are not stocked: the invoice does not move inventory for them and
   * does not post cost of goods sold.
   */
  @Column({ type: 'enum', enum: ProductKind, default: ProductKind.GOOD })
  kind: ProductKind;

  /** Unit of measure code (`UND`, `KG`, `HR`, `LT`…), mapped to the authority's catalogue on send. */
  @Column({ name: 'unit_of_measure', type: 'varchar', length: 16, default: 'UND' })
  unitOfMeasure: string;

  /**
   * How this item is treated for consumption tax, and at what rate.
   *
   * Until now the rate came from the client on every request and the server could only check it
   * against the country's list of legal rates — which cannot tell an exempt book from an evasive
   * zero on a taxable good. Holding the classification on the catalogue makes the invoice derive
   * the rate instead of trusting it, and gives the 606/607 the exempt/taxed split they require.
   */
  @Column({ name: 'tax_treatment', type: 'varchar', length: 16, default: 'TAXED' })
  taxTreatment: string;

  /** Consumption-tax rate as a fraction (0.18 = 18 %). Ignored when the treatment is not TAXED. */
  @Column({
    name: 'tax_rate',
    type: 'decimal',
    precision: 9,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  taxRate: number;

  /** Excise duty (ISC) rate as a fraction, where the item is subject to one. */
  @Column({
    name: 'excise_rate',
    type: 'decimal',
    precision: 9,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  exciseRate: number;

  /** Item code as declared to the fiscal authority, where a catalogue applies (CFDI ClaveProdServ). */
  @Column({ name: 'fiscal_item_code', type: 'varchar', length: 32, nullable: true })
  fiscalItemCode?: string | null;

  @Column({
    name: 'reorder_level',
    type: 'decimal',
    precision: 18,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  reorderLevel?: number | null;

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
