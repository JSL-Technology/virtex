
import { Entity, PrimaryColumn, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Account } from '../../chart-of-accounts/entities/account.entity';
import { AccountingPeriod } from './accounting-period.entity';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

@Entity({ name: 'account_period_locks' })
@Index(['organizationId', 'accountId', 'periodId'], { unique: true })
export class AccountPeriodLock {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @PrimaryColumn({ type: 'uuid' })
  accountId: string;

  @PrimaryColumn({ type: 'uuid' })
  periodId: string;

  @Column({ default: true })
  isLocked: boolean;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accountId' })
  account: Account;

  @ManyToOne(() => AccountingPeriod, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'periodId' })
  period: AccountingPeriod;

  // Tenant-owned: deleting the tenant deletes this row (see TenantOwned).
  @TenantOwned('FK_account_period_locks_organization')
  organization?: TenantRef;
}