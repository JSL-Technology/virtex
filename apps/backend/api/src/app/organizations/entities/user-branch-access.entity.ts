import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Branch } from './branch.entity';
import { TenantOwned, TenantRef } from '../contracts/tenant-owned.contract';

/**
 * The branches a person may work in, within one company.
 *
 * No rows for a person means every branch — the default, and the right one for an owner or an
 * accountant. Rows mean only those: a cashier in Santiago sees and issues Santiago's documents and
 * nobody else's, the way NetSuite restricts an employee to their locations. The server applies it
 * on every list and every document it creates; the client only mirrors it.
 */
@Entity({ name: 'user_branch_access' })
@Index('IDX_user_branch_access_org_user', ['organizationId', 'userId'])
export class UserBranchAccess {
  @PrimaryColumn({ name: 'user_id', type: 'uuid', primaryKeyConstraintName: 'PK_user_branch_access' })
  userId: string;

  @PrimaryColumn({ name: 'branch_id', type: 'uuid', primaryKeyConstraintName: 'PK_user_branch_access' })
  branchId: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id', foreignKeyConstraintName: 'FK_user_branch_access_branch' })
  branch?: Branch;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_user_branch_access_organization')
  organization?: TenantRef;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
