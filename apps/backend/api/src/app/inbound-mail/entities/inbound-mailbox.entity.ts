import { Check, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import type { InboundMailPurpose } from '../../contracts/inbound-mail/inbound-mail.contract';

/** One address a company receives mail at, for one purpose. */
@Entity({ name: 'inbound_mailboxes' })
@Unique('UQ_inbound_mailboxes_token', ['token'])
@Unique('UQ_inbound_mailboxes_org_purpose', ['organizationId', 'purpose'])
@Check('CHK_inbound_mailboxes_purpose', `"purpose" IN ('BILLS', 'ORDERS')`)
export class InboundMailbox {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_inbound_mailboxes' })
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_inbound_mailboxes_organization')
  organization?: TenantRef;

  @Column({ type: 'varchar', length: 16 })
  purpose: InboundMailPurpose;

  /** The secret part of the address. Rotating it retires the old address at once. */
  @Column({ type: 'varchar', length: 64 })
  token: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  /** Addresses or `@domains` allowed to write; empty for anyone. */
  @Column({ name: 'allowed_senders', type: 'jsonb', default: [] })
  allowedSenders: string[];

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
