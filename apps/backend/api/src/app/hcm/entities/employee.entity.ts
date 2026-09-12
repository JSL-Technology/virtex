import { Entity, Column, Index, DeleteDateColumn, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { encryptedColumnTransformer } from '../../common/database/encrypted-column.transformer';
import { EmployeeCompensation } from './employee-compensation.entity';

/** How the employment ended, or that it has not. Drives whether payroll picks the person up. */
export enum EmploymentStatus {
  ACTIVE = 'ACTIVE',
  /** On the books but not paid this period — unpaid leave, suspension. */
  SUSPENDED = 'SUSPENDED',
  /** Left the company. Kept for history (payslips, TSS filings) but never in a new run. */
  TERMINATED = 'TERMINATED',
}

/** The contract a person works under. Affects severance and some contributions. */
export enum ContractType {
  INDEFINITE = 'INDEFINITE',
  FIXED_TERM = 'FIXED_TERM',
  OCCASIONAL = 'OCCASIONAL',
}

export enum IdentityDocumentType {
  /** Dominican national id. */
  CEDULA = 'CEDULA',
  PASSPORT = 'PASSPORT',
  /** Tax id for a natural person acting as such. */
  RNC = 'RNC',
}

/**
 * A person on a tenant's payroll.
 *
 * ## What this entity carries now that it did not
 *
 * The register shipped with a name, an e-mail and a hire date — nothing you can run a payroll from.
 * A payroll needs the money (see {@link EmployeeCompensation}, a versioned history rather than a
 * single mutable `salary` column so a raise never rewrites what a past payslip was computed on), the
 * fiscal identity to declare (cédula), the account wages are paid into, and the social-security
 * enrolments to file against. The cédula and the bank account are the two fields whose leak causes
 * real harm, so they are **encrypted at rest** through {@link encryptedColumnTransformer} and never
 * stored in the clear.
 *
 * ## Tenant isolation
 *
 * `organization_id` is redeclared NOT NULL here — the base column is nullable, which is why the
 * row-level-security migration had to *exclude* `employees` and leave its isolation to the
 * application remembering a `WHERE`. Salaries and national ids are exactly the data that must not
 * rely on a forgettable clause, so this table now carries a real tenant and the payroll migration
 * brings it under the same `tenant_isolation` policy as the ledger.
 *
 * ## Leaving, not deleting
 *
 * A person referenced by a payslip, a journal entry and a TSS filing cannot be hard-deleted without
 * tearing a hole in the history those documents depend on. Termination is a state
 * ({@link EmploymentStatus.TERMINATED} + `terminationDate`); removal is a soft delete
 * (`@DeleteDateColumn`). The register's default scope hides deleted rows; history still resolves them.
 */
@Entity('employees')
// An employee's e-mail is unique WITHIN the tenant. The bare `unique: true` made it global, so two
// companies could never employ the same person, and a consultant on two tenants' payrolls was
// impossible to represent.
@Index('IDX_employees_org_email', ['organizationId', 'email'], { unique: true })
// One employee per national id per tenant, enforced on the blind index so the database never sees
// the cédula itself. Partial: only where a hash is present and the row is live.
@Index('IDX_employees_org_identity_hash', ['organizationId', 'identityDocumentHash'], {
  unique: true,
  where: '"identity_document_hash" IS NOT NULL AND "deleted_at" IS NULL',
})
export class Employee extends BaseEntity {
  // Redeclared NOT NULL so the tenant is a real column and RLS can protect the table. Every write
  // path (HcmService) already stamps it.
  @Column({ name: 'organization_id', type: 'uuid' })
  override organizationId: string = undefined!; // NOT NULL override; hydrated by TypeORM

  @Column({ name: 'first_name' })
  firstName: string;

  @Column({ name: 'last_name' })
  lastName: string;

  @Column()
  email: string;

  @Column({ name: 'job_title', nullable: true })
  jobTitle: string;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string;

  @Column({ name: 'hire_date', type: 'date', nullable: true })
  hireDate: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string;

  // ── Fiscal identity (sensitive) ──────────────────────────────────────────────

  @Column({
    name: 'identity_document',
    type: 'text',
    nullable: true,
    transformer: encryptedColumnTransformer,
  })
  identityDocument: string | null;

  @Column({
    name: 'identity_document_type',
    type: 'enum',
    enum: IdentityDocumentType,
    default: IdentityDocumentType.CEDULA,
  })
  identityDocumentType: IdentityDocumentType;

  /** HMAC of the cédula, for uniqueness and lookup without decryption. Set by HcmService. */
  @Column({ name: 'identity_document_hash', type: 'varchar', length: 64, nullable: true })
  identityDocumentHash: string | null;

  // ── Bank account for the wage payment (sensitive) ────────────────────────────

  @Column({ name: 'bank_name', type: 'varchar', nullable: true })
  bankName: string | null;

  @Column({
    name: 'bank_account_number',
    type: 'text',
    nullable: true,
    transformer: encryptedColumnTransformer,
  })
  bankAccountNumber: string | null;

  @Column({ name: 'bank_account_type', type: 'varchar', nullable: true })
  bankAccountType: string | null;

  // ── Social security enrolment ────────────────────────────────────────────────

  /** TSS number (NSS). Identifies the person in every TSS filing. */
  @Column({ name: 'tss_nss', type: 'varchar', nullable: true })
  tssNss: string | null;

  /** The pension fund (AFP) the person is enrolled in. */
  @Column({ name: 'afp_code', type: 'varchar', nullable: true })
  afpCode: string | null;

  /** The health fund (ARS/SFS) the person is enrolled in. */
  @Column({ name: 'sfs_code', type: 'varchar', nullable: true })
  sfsCode: string | null;

  // ── Employment ───────────────────────────────────────────────────────────────

  @Column({
    name: 'employment_status',
    type: 'enum',
    enum: EmploymentStatus,
    default: EmploymentStatus.ACTIVE,
  })
  employmentStatus: EmploymentStatus;

  @Column({ name: 'termination_date', type: 'date', nullable: true })
  terminationDate: string | null;

  @Column({
    name: 'contract_type',
    type: 'enum',
    enum: ContractType,
    default: ContractType.INDEFINITE,
  })
  contractType: ContractType;

  @OneToMany(() => EmployeeCompensation, (c) => c.employee)
  compensations: EmployeeCompensation[];

  /** Soft delete. A person with payroll history is deactivated, never physically removed. */
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
