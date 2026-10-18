import { Check, Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { numericTransformer } from '../../common/database/numeric.transformer';

/** One company's replenishment agent: off until someone turns it on. */
@Entity({ name: 'replenishment_agent_settings' })
@Check('CHK_replenishment_agent_settings_max', '"max_order_amount" IS NULL OR "max_order_amount" > 0')
export class ReplenishmentAgentSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_replenishment_agent_settings_organization')
  organization?: TenantRef;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  /** Only these warehouses; every warehouse when empty. */
  @Column({ name: 'warehouse_ids', type: 'jsonb', default: [] })
  warehouseIds: string[];

  /** Send each order for approval (within the limit), instead of leaving it as a draft. */
  @Column({ name: 'submit_for_approval', type: 'boolean', default: false })
  submitForApproval: boolean;

  /** An order above this stays a draft for a person; no limit when null. */
  @Column({ name: 'max_order_amount', type: 'numeric', precision: 18, scale: 2, nullable: true, transformer: numericTransformer })
  maxOrderAmount: number | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
