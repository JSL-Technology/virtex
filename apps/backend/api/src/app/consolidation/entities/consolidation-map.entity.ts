
import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { Account } from '../../chart-of-accounts/entities/account.entity';

@Entity({ name: 'consolidation_maps' })
export class ConsolidationMap {
  @PrimaryColumn({ type: 'uuid' })
  parentOrganizationId: string;

  @PrimaryColumn({ type: 'uuid' })
  subsidiaryOrganizationId: string;

  @PrimaryColumn({ type: 'uuid' })
  subsidiaryAccountId: string;



  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_organization_id' })
  parentOrganization: Organization;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subsidiary_organization_id' })
  subsidiaryOrganization: Organization;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subsidiary_account_id' })
  subsidiaryAccount: Account;

  @Column({ type: 'uuid' })
  parentAccountId: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_account_id' })
  parentAccount: Account;
}