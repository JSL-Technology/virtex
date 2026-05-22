import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'einvoice_provider_configs' })
export class EInvoiceProviderConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
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
}