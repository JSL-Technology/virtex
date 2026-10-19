import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

/**
 * A unit of measure a company defined for itself — «saco de 50 kg», «bulto» — beside the shared
 * catalogue (QA M-18). Its name is the company's own words, not a catalogue key.
 */
@Entity({ name: 'tenant_units_of_measure' })
@Index('UQ_tenant_units_of_measure_org_symbol', ['organizationId', 'symbol'], { unique: true })
export class TenantUnitOfMeasure {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ type: 'varchar', length: 16 })
  symbol: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  category: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @TenantOwned('FK_tenant_units_of_measure_organization')
  organization?: TenantRef;
}
