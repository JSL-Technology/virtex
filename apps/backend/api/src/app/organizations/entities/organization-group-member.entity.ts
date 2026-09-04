import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Organization } from './organization.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

/**
 * One company's membership of another's group, and how much of it the parent owns.
 *
 * ## Why this has to be stored
 *
 * Two operations cross a tenant boundary: an intercompany transaction, which posts into another
 * company's books, and consolidation, which reads them. Both were taking the other company's id
 * from the caller — `POST /intercompany/transactions` read `toOrganizationId` straight out of the
 * request body and validated nothing about it, on a route that carried no permission at all. Any
 * authenticated user could name any tenant's uuid and have a journal entry posted into it. That is
 * the most serious shape a multi-tenant defect takes, and no amount of care at the call site fixes
 * it: the relationship has to be a fact somebody with authority recorded, which is what this is.
 *
 * ## Ownership is a number, not a flag
 *
 * Consolidation added every subsidiary at 100 % and logged the percentage without using it, so a
 * 60 %-owned subsidiary was consolidated whole and no non-controlling interest was computed —
 * required by IFRS 10 and by every local adoption of it in the region. The percentage lives here
 * because it is a property of the relationship, not of a consolidation run.
 */
@Entity({ name: 'organization_group_members' })
@Unique('UQ_organization_group_members', ['parentOrganizationId', 'memberOrganizationId'])
// Declared here as well as in the migration so `check:schema-drift` sees them: a constraint that
// exists only in the database is one the entity does not know it is relying on.
@Check('CK_organization_group_members_ownership', '"ownership_percentage" > 0 AND "ownership_percentage" <= 100')
@Check('CK_organization_group_members_distinct', '"parent_organization_id" <> "member_organization_id"')
@Index('IDX_organization_group_members_member', ['memberOrganizationId'])
export class OrganizationGroupMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'parent_organization_id', type: 'uuid' })
  parentOrganizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'parent_organization_id',
    foreignKeyConstraintName: 'FK_organization_group_members_parent',
  })
  parentOrganization: Organization;

  @Column({ name: 'member_organization_id', type: 'uuid' })
  memberOrganizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'member_organization_id',
    foreignKeyConstraintName: 'FK_organization_group_members_member',
  })
  memberOrganization: Organization;

  /**
   * The parent's share, 0 < x ≤ 100.
   *
   * Four decimals because a holding is routinely stated to two — 51.25 % — and a consolidation that
   * rounds the share before applying it produces a non-controlling interest that does not tie.
   */
  @Column({
    name: 'ownership_percentage',
    type: 'decimal',
    precision: 7,
    scale: 4,
    default: 100,
    transformer: numericTransformerNotNull,
  })
  ownershipPercentage: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
