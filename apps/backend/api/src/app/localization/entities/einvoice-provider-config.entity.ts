import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

@Entity({ name: 'einvoice_provider_configs' })
export class EInvoiceProviderConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column()
  providerName: string;

  @Column()
  isSandbox: boolean;

  @Column({ type: 'text' })
  apiUrl: string;

  @Column({ type: 'text', comment: 'ID del certificado en un Keystore seguro' })
  certificateId: string;

  @Column({ type: 'jsonb' })
  credentials: Record<string, any>;

  // Tenant-owned: deleting the tenant deletes this row (see TenantOwned).
  @TenantOwned('FK_einvoice_provider_configs_organization')
  organization?: TenantRef;
}