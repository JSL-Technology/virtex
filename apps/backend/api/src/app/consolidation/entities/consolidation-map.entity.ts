import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { Account } from '../../chart-of-accounts/entities/account.entity';

/**
 * Which parent account a subsidiary account rolls up into.
 *
 * ## Every id was stored twice, and the wrong copy carried the foreign key
 *
 * The four id properties declared no `name`, so TypeORM created `parentOrganizationId`,
 * `subsidiaryOrganizationId`, `subsidiaryAccountId` and `parentAccountId` — while the four
 * `@JoinColumn`s beside them named `parent_organization_id`, `subsidiary_organization_id`,
 * `subsidiary_account_id` and `parent_account_id`. Eight columns for four facts, and the split was
 * not cosmetic:
 *
 * - Writes and the primary key went to the camelCase columns.
 * - The foreign keys were on the snake_case columns, which were therefore **always null** — so a
 *   map could reference an account or an organization that had been deleted, and nothing stopped
 *   it.
 * - `relations: ['parentAccount']` joins on the null column, so **every** eager load of the parent
 *   account came back null. Consolidation read the map, found no parent account on any row, and
 *   treated every subsidiary account as unmapped.
 *
 * The map could be written and could not be read. One column per fact, carrying both the value and
 * the constraint.
 */
@Index('IDX_consolidation_maps_parent_subsidiary', [
  'parentOrganizationId',
  'subsidiaryOrganizationId',
])
@Entity({ name: 'consolidation_maps' })
export class ConsolidationMap {
  @PrimaryColumn({ name: 'parent_organization_id', type: 'uuid' })
  parentOrganizationId: string;

  @PrimaryColumn({ name: 'subsidiary_organization_id', type: 'uuid' })
  subsidiaryOrganizationId: string;

  @PrimaryColumn({ name: 'subsidiary_account_id', type: 'uuid' })
  subsidiaryAccountId: string;

  @Column({ name: 'parent_account_id', type: 'uuid' })
  parentAccountId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_organization_id' })
  parentOrganization: Organization;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subsidiary_organization_id' })
  subsidiaryOrganization: Organization;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subsidiary_account_id' })
  subsidiaryAccount: Account;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_account_id' })
  parentAccount: Account;
}
