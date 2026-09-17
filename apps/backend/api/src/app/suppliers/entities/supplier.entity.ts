import { Organization } from '../../organizations/entities/organization.entity';
import { TaxpayerType } from '../../localization/fiscal/withholding-regimes';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'suppliers' })
// Both halves of the document reference travel together: a code with no country cannot be
// resolved — a "cédula" is eleven Luhn-checked digits in Santo Domingo and six to ten
// unchecked ones in Bogotá — and a country with no code records a document whose kind is
// unknown.
@Check(
  'CK_suppliers_identity_document_pair',
  `("identity_document_type_code" IS NULL AND "identity_document_country" IS NULL)
    OR ("identity_document_type_code" IS NOT NULL AND "identity_document_country" IS NOT NULL)`,
)
export class Supplier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  contactPerson?: string;

  @Column({ nullable: true })
  email?: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  taxId?: string;

  /**
   * The kind of identifier `taxId` holds, from the identity-document catalogue.
   *
   * Purchasing had the same gap sales did: a bare varchar with no type and no validation, so a
   * supplier's RNC and a supplier's cédula were the same column with no way to tell them apart —
   * and the 606 filing that reports purchases needs to state which. See `Customer` for the full
   * reasoning; the two are deliberately modelled identically, because they are the same concept.
   */
  @Column({
    name: 'identity_document_type_code',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  identityDocumentTypeCode?: string | null;

  /**
   * The document's issuing country, which is the SUPPLIER's.
   *
   * Distinct from `country` below, which is where the supplier is established: a Dominican company
   * can hold a document issued elsewhere, and a payment abroad is reported on the 609 by where the
   * supplier is, not by which registry issued their identifier.
   */
  @Column({
    name: 'identity_document_country',
    type: 'char',
    length: 2,
    nullable: true,
  })
  identityDocumentCountry?: string | null;

  @Column({ nullable: true })
  address?: string;

  /**
   * ISO 3166-1 alpha-2 country of the supplier.
   *
   * Needed to tell a domestic purchase from a payment abroad: the DGII's 609 reports the latter
   * with the income tax withheld at source, and without a country there is no way to separate them.
   *
   * The column carried `DEFAULT 'DO'`, so a supplier created by a Chilean tenant was recorded as
   * Dominican unless somebody said otherwise — and "domestic or abroad" is precisely the question
   * this column exists to answer, so a wrong default here is a wrong filing. There is no default
   * now; `SuppliersService` fills it from the TENANT's country, which is the correct assumption
   * for a supplier created without one.
   */
  @Column({ type: 'varchar', length: 2, nullable: true })
  country?: string | null;

  /**
   * The supplier's fiscal classification — the fact that decides what we withhold from them.
   *
   * The customer record has carried this for some time and the supplier record did not, which is
   * why the withholding on a purchase arrived as a free number on the request: nothing on the
   * supplier could establish the rate. In the Dominican Republic it is the difference between
   * withholding 100 % of the ITBIS and 10 % of the fee on a service bought from a persona física,
   * and withholding nothing at all from a company.
   *
   * Assigned by the tax authority, recorded by the tenant, never inferred: the shape of an RNC and
   * the words in a company name establish nothing. Null means unclassified, and nothing is
   * withheld automatically — a bill may still state a withholding, as an exception with a reason.
   */
  @Column({
    name: 'taxpayer_type',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  taxpayerType?: TaxpayerType | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;
}
