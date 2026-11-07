import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Customer } from '../../customers/entities/customer.entity';
import { User } from '../../users/entities/user.entity/user.entity';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

/**
 * Who a portal user is, as a customer (audit 2026-10-31, CS-01).
 *
 * The portal had no customer identity: its "my-*" endpoints answered with every case and every
 * invoice of the tenant to anyone holding `customer_portal:access`. A portal user now reads only
 * what belongs to the one customer this row binds them to, and without a live row reads nothing.
 * Revoking keeps the row (who granted what, and when) and frees the user for another binding.
 */
@Entity({ name: 'customer_portal_accounts' })
@Index('UQ_customer_portal_accounts_live_user', ['organizationId', 'userId'], {
  unique: true,
  where: '"revoked_at" IS NULL',
})
export class CustomerPortalAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_customer_portal_accounts_user' })
  user?: User;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  /** A customer with a portal account is not deleted from under it: revoke first. */
  @ManyToOne(() => Customer, { onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
  @JoinColumn({ name: 'customer_id', foreignKeyConstraintName: 'FK_customer_portal_accounts_customer' })
  customer?: Customer;

  @Column({ name: 'granted_by_user_id', type: 'uuid', nullable: true })
  grantedByUserId: string | null;

  @CreateDateColumn({ name: 'granted_at', type: 'timestamptz' })
  grantedAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'revoked_by_user_id', type: 'uuid', nullable: true })
  revokedByUserId: string | null;

  @TenantOwned('FK_customer_portal_accounts_organization')
  organization?: TenantRef;
}
