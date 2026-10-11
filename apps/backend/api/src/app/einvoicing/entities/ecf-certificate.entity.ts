import { Check, Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';

/** The regime of a certificate issued for Dominican e-CF documents. */
export const DGII_CERTIFICATE_REGIME = 'DGII';

/**
 * The DGII digital certificate a tenant signs its e-CF with, stored encrypted at rest.
 *
 * The raw PKCS#12 (.p12/.pfx) bytes and its import password are AES-256-GCM encrypted with a
 * key derived from `ECF_CERT_ENCRYPTION_KEY` before they ever touch the database — the columns
 * hold ciphertext, never the private key in the clear. `CertificateVaultService` is the only place
 * that decrypts them, and only in memory, at signing time.
 */
// The lookup is always "the active certificate of this regime for this tenant".
@Index('IDX_ecf_certificates_org_regime_active', ['organizationId', 'regime', 'isActive'])
// Declared here as well as in the migration, so the schema-drift check sees it.
@Check('CK_ecf_certificates_holder_kind', `"holder_kind" IS NULL OR "holder_kind" IN ('company', 'person')`)
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
  /**
   * Which regime this certificate signs for.
   *
   * A taxpayer operating in more than one market holds more than one certificate — a DGII one for
   * the Dominican Republic, a CSD for Mexico, a certificado de firma digital for Colombia — and
   * they are not interchangeable: each is issued by that country's authority for that country's
   * documents. Without a discriminator the table held one certificate per tenant and the second
   * market silently signed with the first market's key.
   *
   * `DGII` for every existing row, which is what they all are.
   */
  @Column({ name: 'regime', type: 'varchar', length: 16, default: DGII_CERTIFICATE_REGIME })
  regime: string;

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

  /**
   * The identifier that ties the certificate to the company, digits only: its RNC, or the cédula
   * of the person it authorised. Null for certificates loaded before this was checked.
   */
  @Column({ name: 'holder_tax_id', type: 'varchar', length: 20, nullable: true })
  holderTaxId?: string | null;

  /** `company` (issued to the RNC) or `person` (issued to a cédula). */
  @Column({ name: 'holder_kind', type: 'varchar', length: 16, nullable: true })
  holderKind?: 'company' | 'person' | null;

  @Column({ name: 'issuer_common_name', type: 'varchar', length: 255, nullable: true })
  issuerCommonName?: string | null;

  /**
   * Self-signed, accepted only because a development process allowed it. Such a certificate never
   * signs anywhere else, even if the row survives into another environment.
   */
  @Column({ name: 'is_test', type: 'boolean', default: false })
  isTest: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
