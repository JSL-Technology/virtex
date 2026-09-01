import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';

/**
 * The DGII digital certificate a tenant signs its e-CF with, stored encrypted at rest.
 *
 * The raw PKCS#12 (.p12/.pfx) bytes and its import password are AES-256-GCM encrypted with a
 * key derived from `ECF_CERT_ENCRYPTION_KEY` before they ever touch the database — the columns
 * hold ciphertext, never the private key in the clear. `CertificateVaultService` is the only place
 * that decrypts them, and only in memory, at signing time.
 */
@Entity({ name: 'ecf_certificates' })
@Index('IDX_ecf_certificates_org_active', ['organizationId', 'isActive'])
export class EcfCertificate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * `uuid`, matching `organizations.id`, with a foreign key.
   *
   * Twenty tables held the tenant reference as `character varying` while the column it points at
   * is a uuid. A join between them was a type error PostgreSQL refused outright, and a row whose
   * organization had been deleted was perfectly storable.
   */
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  /** Human label chosen by the tenant. */
  @Column()
  alias: string;

  /** AES-256-GCM ciphertext (base64) of the PKCS#12 bytes: `iv:authTag:ciphertext`. */
  @Column({ name: 'encrypted_pfx', type: 'text' })
  encryptedPfx: string;

  /** AES-256-GCM ciphertext (base64) of the PKCS#12 import password. */
  @Column({ name: 'encrypted_password', type: 'text' })
  encryptedPassword: string;

  /** Certificate metadata, extracted at upload for display and pre-flight expiry checks. */
  @Column({ name: 'subject_common_name', nullable: true })
  subjectCommonName?: string;

  @Column({ name: 'serial_number', nullable: true })
  serialNumber?: string;

  @Column({ name: 'not_before', type: 'timestamptz', nullable: true })
  notBefore?: Date;

  @Column({ name: 'not_after', type: 'timestamptz', nullable: true })
  notAfter?: Date;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
