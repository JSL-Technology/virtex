import { Check, Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

/** One company's reconciliation settings (one row, or none: the defaults). */
@Entity({ name: 'reconciliation_settings' })
@Check('CHK_reconciliation_settings_min_score', '"min_score" BETWEEN 90 AND 100')
export class ReconciliationSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_reconciliation_settings_organization')
  organization?: TenantRef;

  /** Confirm unambiguous matches on import, without a person. */
  @Column({ name: 'auto_confirm', type: 'boolean', default: false })
  autoConfirm: boolean;

  @Column({ name: 'min_score', type: 'integer', default: 95 })
  minScore: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
