import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { blankToNullTransformer } from '../../common/database/blank-to-null.transformer';
import { TenantOwned, TenantRef } from '../contracts/tenant-owned.contract';

/**
 * An establishment of the company: a store, an office, a plant — a place it operates from.
 *
 * ## Not a subsidiary
 *
 * A subsidiary is another legal entity — its own tax id, its own books — linked to this one for
 * consolidation (`organization_subsidiaries`). A branch is the same legal entity operating from
 * another address: same tax id, same books, one more place documents are issued and goods are held.
 * Every reference ERP keeps the two apart — NetSuite *Subsidiaries* vs *Locations*, SAP *company
 * code* vs *plant/business place*, SAP Business One *Branches* — because conflating them forces a
 * second set of books on a company that merely opened a second store.
 *
 * A document records the branch it was issued from (`branch_id` on invoices, quotes, receipts,
 * supplier bills, purchase orders and point-of-sale shifts and sales), warehouses belong to one,
 * and a person can be limited to the branches they work at (`user_branch_access`).
 *
 * ## Fiscal establishment
 *
 * Several markets number fiscal documents per establishment and emission point — Ecuador's
 * `001-001-…`, Peru's series per establishment, Mexico's place of issue. Both codes are optional
 * here because the Dominican e-NCF is numbered per taxpayer, not per establishment.
 */
@Entity({ name: 'branches' })
@Index('UQ_branches_org_code', ['organizationId', 'code'], { unique: true })
@Index('UQ_branches_org_headquarters', ['organizationId'], { unique: true, where: '"is_headquarters" = true' })
export class Branch {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_branches' })
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** Erased with its tenant. */
  @TenantOwned('FK_branches_organization')
  organization?: TenantRef;

  /** Short and stable, printed on documents and used in filters: `MATRIZ`, `STI-01`. */
  @Column({ length: 20 })
  code: string;

  @Column({ length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true, transformer: blankToNullTransformer })
  address: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true, transformer: blankToNullTransformer })
  city: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true, transformer: blankToNullTransformer })
  state: string | null;

  @Column({ name: 'postal_code', type: 'varchar', length: 20, nullable: true, transformer: blankToNullTransformer })
  postalCode: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true, transformer: blankToNullTransformer })
  phone: string | null;

  /** The tax authority's establishment code, where the market numbers documents by it. */
  @Column({ name: 'fiscal_establishment_code', type: 'varchar', length: 10, nullable: true, transformer: blankToNullTransformer })
  fiscalEstablishmentCode: string | null;

  /** The emission point within the establishment, where the market has one. */
  @Column({ name: 'emission_point_code', type: 'varchar', length: 10, nullable: true, transformer: blankToNullTransformer })
  emissionPointCode: string | null;

  /**
   * The warehouse goods sold or received here move through by default — one of this branch's own
   * warehouses (`warehouses.branch_id`). A column, not a relation: warehouses belong to supply
   * chain, which already points at branches; `BranchesService` checks the pairing instead.
   */
  @Column({ name: 'default_warehouse_id', type: 'uuid', nullable: true })
  defaultWarehouseId: string | null;

  /** The registered address. At most one per company; documents fall back to it. */
  @Column({ name: 'is_headquarters', default: false })
  isHeadquarters: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
