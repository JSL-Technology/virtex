import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import type { Invoice } from './invoice.entity';
import { Product } from '../../inventory/entities/product.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

/**
 * How a line is treated for consumption tax. The distinction is not cosmetic: the DGII's
 * `IndicadorFacturacion` has separate codes for "taxed at the standard rate", "taxed at the reduced
 * rate", "zero-rated" (exports, which carry the right to deduct input tax) and "exempt" (which does
 * not), and the 606/607 reports separate them too. Collapsing all of them onto a 0 % rate — which
 * is what a single `taxRate` field forces — misstates the return.
 */
export enum TaxTreatment {
  /** Levied at the market's standard or reduced rate; the rate is on the line. */
  TAXED = 'TAXED',
  /** Rate of zero WITH right to deduct input tax: exports, certain basic goods. */
  ZERO_RATED = 'ZERO_RATED',
  /** Outside the scope of the tax: no output tax, no right to deduct. */
  EXEMPT = 'EXEMPT',
}

@Entity({ name: 'invoice_line_item' })
@Index('IDX_invoice_line_item_invoice', ['invoiceId'])
export class InvoiceLineItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('Invoice', 'lineItems', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoiceId' })
  invoice: Invoice;

  @Column({ name: 'invoiceId', type: 'uuid', nullable: true })
  invoiceId?: string | null;

  /**
   * Optional: a line may bill a free-text concept — a service, a shipping charge, a rebate — that
   * is not an inventory item. Requiring a `productId` made it impossible to invoice anything that
   * is not stocked, which rules out every services business the product is sold to.
   */
  @ManyToOne(() => Product, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product?: Product | null;

  @Column({ name: 'productId', type: 'uuid', nullable: true })
  productId?: string | null;

  @Column()
  description: string;

  /** Order the line is printed and transmitted in; the DGII numbers items from 1. */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  /**
   * Six decimal places, because a quantity is not an integer.
   *
   * This was `int`, while the DTO accepted any number: a line for 1.5 hours computed its total from
   * 1.5 and stored 2, so the document's own detail contradicted its total. Weight, time, volume and
   * fractional packs are the ordinary case in most of the sectors this product serves.
   */
  @Column('decimal', {
    precision: 18,
    scale: 6,
    transformer: numericTransformerNotNull,
  })
  quantity: number;

  /** Unit of measure, as a code. Mapped to the fiscal authority's catalogue when transmitting. */
  @Column({ name: 'unit_of_measure', type: 'varchar', length: 16, nullable: true })
  unitOfMeasure?: string | null;

  /** Unit price before discount, at six decimals: fuel and pharma routinely need more than two. */
  @Column('decimal', {
    precision: 18,
    scale: 6,
    transformer: numericTransformerNotNull,
  })
  price: number;

  /** Discount granted on this line, as a fraction (0.10 = 10 %). */
  @Column('decimal', {
    name: 'discount_rate',
    precision: 9,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  discountRate: number;

  @Column('decimal', {
    name: 'discount_amount',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  discountAmount: number;

  /** quantity × price − discount. The taxable (or exempt) base of the line. */
  @Column('decimal', {
    name: 'line_subtotal',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  lineSubtotal: number;

  /** Consumption-tax rate as a fraction (0.18 = 18 %). Zero when exempt or zero-rated. */
  @Column('decimal', {
    precision: 9,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  taxRate: number;

  @Column('decimal', {
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  taxAmount: number;

  @Column({
    name: 'tax_treatment',
    type: 'enum',
    enum: TaxTreatment,
    default: TaxTreatment.TAXED,
  })
  taxTreatment: TaxTreatment;

  /**
   * Whether the line bills a service rather than a good.
   *
   * The e-CF carries `IndicadorBienoServicio` per line and the 606/607 split the amount invoiced in
   * goods from the amount invoiced in services. Every line used to be transmitted as a good.
   */
  @Column({ name: 'is_service', default: false })
  isService: boolean;

  /** Excise duty (ISC in the Dominican Republic) charged on the line, if any. */
  @Column('decimal', {
    name: 'excise_amount',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  exciseAmount: number;

  /** Unit cost at the moment of sale, used to post cost of goods sold. */
  @Column('decimal', {
    name: 'unit_cost',
    precision: 18,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  unitCost: number;

  /** Quantity already returned by credit notes, so a line cannot be credited twice. */
  @Column('decimal', {
    name: 'credited_quantity',
    precision: 18,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  creditedQuantity: number;

  /** On a credit-note line: the invoice line it credits. */
  @Column({ name: 'source_line_id', type: 'uuid', nullable: true })
  sourceLineId?: string | null;
}
