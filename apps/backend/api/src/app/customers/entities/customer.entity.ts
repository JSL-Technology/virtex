import { Organization } from '../../organizations/entities/organization.entity';
import {
  Check,
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
import type { LanguageCode } from '@virteex/shared/types';
import { TaxpayerType } from '../../localization/fiscal/withholding-regimes';
import {
  numericTransformer,
  numericTransformerNotNull,
} from '../../common/database/numeric.transformer';
import { blankToNullTransformer } from '../../common/database/blank-to-null.transformer';

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
// Both halves of the document reference travel together: a code with no country cannot be
// resolved — a "cédula" is eleven Luhn-checked digits in Santo Domingo and six to ten
// unchecked ones in Bogotá — and a country with no code records a document whose kind is
// unknown.
@Check(
  'CK_customers_identity_document_pair',
  `("identity_document_type_code" IS NULL AND "identity_document_country" IS NULL)
    OR ("identity_document_type_code" IS NOT NULL AND "identity_document_country" IS NOT NULL)`,
)
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  companyName: string;

  @Column({ nullable: true })
  contactPerson?: string;

  /**
   * Optional, like the supplier's. See `CustomerContactOptional` for why the product held two
   * rules for the same idea, and why this is the one that survived.
   */
  //  `type` stated explicitly: a `string | null` property reflects as `Object`, which TypeORM
  //  cannot map to a Postgres type, and the failure only shows up when a migration runs.
  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ nullable: true })
  phone: string;

  /**
   * The customer's fiscal identifier, unique among this tenant's customers when given.
   *
   * `blankToNullTransformer` because the unique index exempts NULL and not `''`: an untouched
   * form field arrives as the empty string, so the second customer saved without a tax id was
   * refused as a duplicate of the first.
   */
  @Column({ nullable: true, transformer: blankToNullTransformer })
  taxId?: string;

  /**
   * The kind of identifier `taxId` holds, from the identity-document catalogue.
   *
   * Sales carried a bare `taxId` varchar with `@IsString()` and nothing else — no type, no
   * validation, no country. Three things followed from that, all of which a reader of the row can
   * now tell apart:
   *
   *   - a Dominican customer can identify with an RNC (a company) or a cédula (a person), and the
   *     e-CF carries which one it is. Stored untyped, the only way to tell was the length — the
   *     same heuristic `create-invoice.dto.ts` records having removed from the document type for
   *     being wrong;
   *   - a mistyped NIT was accepted, stored, and surfaced months later when the DIAN rejected the
   *     invoice built from it;
   *   - the field had to be labelled "RNC / Cédula" in Spanish and "CNPJ / CPF" in Portuguese,
   *     because one input was doing the work of two.
   */
  @Column({
    name: 'identity_document_type_code',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  identityDocumentTypeCode?: string | null;

  /**
   * The document's issuing country, which is the CUSTOMER's, not the tenant's.
   *
   * An exporter's customers are abroad by definition, and validating a Panamanian buyer's RUC
   * against Dominican rules would reject every one of them. Null falls back to the tenant's
   * country, which is the ordinary domestic case.
   */
  @Column({
    name: 'identity_document_country',
    type: 'char',
    length: 2,
    nullable: true,
  })
  identityDocumentCountry?: string | null;

  /**
   * The buyer's fiscal classification, which decides what they withhold.
   *
   * Withholding is not a commercial term: the rate follows from who the payer is, who the payee is
   * and what is sold. Until this was recorded, the invoicing client supplied the rate and the
   * server checked only that it was between 0 and 1 — so a buyer who withholds nothing could be
   * invoiced with a withholding, and a buyer designated a withholding agent could be invoiced
   * without one, and neither is a difference the books can later reconstruct.
   *
   * `WITHHOLDING_AGENT` in particular is a designation the tax authority publishes; it is recorded
   * here because it is a fact about this customer, and it cannot be inferred from anything else on
   * the record. Null means the tenant has not classified this customer, and nothing is withheld
   * automatically — a document may still state a rate, as an exception with a reason.
   */
  @Column({
    name: 'taxpayer_type',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  taxpayerType?: TaxpayerType | null;

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

  /**
   * The language this customer's documents are written in.
   *
   * A document follows its recipient — a Dominican company invoicing a Brazilian customer sends
   * Portuguese — which is a different axis from the interface language of whoever pressed the
   * button and from the statutory language of the ledger. Null means "not stated", and the
   * country is then the better guess.
   */
  @Column({
    name: 'preferred_language',
    type: 'varchar',
    length: 5,
    nullable: true,
  })
  preferredLanguage?: LanguageCode | null;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0.0,
    transformer: numericTransformerNotNull,
  })
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

  @OneToMany(() => CustomerContact, (contact) => contact.customer, {
    cascade: true,
    eager: true,
  })
  contacts: CustomerContact[];

  @OneToMany(() => CustomerAddress, (address) => address.customer, {
    cascade: true,
    eager: true,
  })
  addresses: CustomerAddress[];

  @ManyToOne('CustomerGroup', 'customers', { nullable: true })
  @JoinColumn({ name: 'customer_group_id' })
  group?: CustomerGroup;

  @Column({ name: 'customer_group_id', type: 'uuid', nullable: true })
  groupId?: string;

  /**
   * The terms as the tenant words them on the document: "Neto 30", "Contado", "2/10 neto 30".
   *
   * Kept alongside the number of days because the two answer different questions: this is what is
   * printed, the number is what a date is computed from. A discount for early payment lives in
   * this sentence and nowhere else, which is honest — the product does not model it yet, and
   * inventing a field for something nothing computes would be worse.
   */
  @Column({ nullable: true })
  paymentTerms?: string;

  /**
   * How many days after the issue date this customer's invoices fall due.
   *
   * The free-text field above has existed for as long as the customer record has, and nothing has
   * ever read it — a string cannot be added to a date. So every invoice opened with a due date
   * equal to its issue date, which says "due on receipt" about a customer the tenant may have
   * given thirty days, and the ageing report then called the invoice overdue the next morning.
   *
   * Null means the tenant has not set terms for this customer, and the organization's own default
   * applies. Zero is a real value and means due on receipt.
   */
  @Column({ name: 'payment_term_days', type: 'int', nullable: true })
  paymentTermDays?: number | null;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  creditLimit?: number;

  @Column({ name: 'default_sales_account_id', type: 'uuid', nullable: true })
  defaultSalesAccountId?: string;
}
