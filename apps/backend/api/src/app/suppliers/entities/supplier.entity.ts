import { Organization } from '../../organizations/entities/organization.entity';
import { TaxpayerType } from '../../localization/fiscal/withholding-regimes';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'suppliers' })
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

  @Column({ nullable: true })
  address?: string;

  /**
   * ISO 3166-1 alpha-2 country of the supplier.
   *
   * Needed to tell a domestic purchase from a payment abroad: the DGII's 609 reports the latter
   * with the income tax withheld at source, and without a country there is no way to separate them.
   */
  @Column({ type: 'varchar', length: 2, nullable: true, default: 'DO' })
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