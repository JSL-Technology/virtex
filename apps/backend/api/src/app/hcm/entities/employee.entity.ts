import {
  Check,
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { IdentityDocumentType } from '../../localization/entities/identity-document-type.entity';
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

/**
 * `IdentityDocumentType` used to be declared here as a PostgreSQL enum of `CEDULA`, `PASSPORT` and
 * `RNC` — two Dominican documents on a table shared by nineteen markets. Adding a country's
 * document meant `ALTER TYPE … ADD VALUE`: a schema migration and a deploy, in a type PostgreSQL
 * never lets you shrink again. The document type is now a reference into
 * `identity_document_types`, so a new country is rows.
 */

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
@Index(
  'IDX_employees_org_identity_hash',
  ['organizationId', 'identityDocumentHash'],
  {
    unique: true,
    where: '"identity_document_hash" IS NOT NULL AND "deleted_at" IS NULL',
  },
)
// Both halves of the document reference travel together: a code with no country cannot be
// resolved — a "cédula" is eleven Luhn-checked digits in Santo Domingo and six to ten
// unchecked ones in Bogotá — and a country with no code records a document whose kind is
// unknown.
@Check(
  'CK_employees_identity_document_pair',
  `("identity_document_type_code" IS NULL AND "identity_document_country" IS NULL)
    OR ("identity_document_type_code" IS NOT NULL AND "identity_document_country" IS NOT NULL)`,
)
export class Employee extends BaseEntity {
  // Redeclared NOT NULL so the tenant is a real column and RLS can protect the table. Every write
  // path (HcmService) already stamps it.
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

  /**
   * The catalogue code of the document: `CEDULA`, `CC`, `CURP`, `CPF`, `PASSPORT`…
   *
   * Nullable with no default. The enum it replaces was `NOT NULL DEFAULT 'CEDULA'`, so every
   * employee of every country was born holding a Dominican document even when no document had been
   * captured, and "not stated" was indistinguishable from "is a Dominican cédula".
   */
  @Column({
    name: 'identity_document_type_code',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  identityDocumentTypeCode: string | null;

  /**
   * The issuing jurisdiction. The tenant's own country in the ordinary case, `XX` for a passport.
   *
   * Stored beside the code because the code alone does not identify a document: a "cédula" is
   * eleven digits with a Luhn check in Santo Domingo, six to ten digits with none in Bogotá, and a
   * tax identifier in San José. `(country, code)` is the catalogue's natural key and the pair is
   * what the foreign key points at.
   */
  @Column({
    name: 'identity_document_country',
    type: 'char',
    length: 2,
    nullable: true,
  })
  identityDocumentCountry: string | null;

  /** HMAC of the document, for uniqueness and lookup without decryption. Set by HcmService. */
  @Column({
    name: 'identity_document_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
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
  //
  // These three columns were `tss_nss`, `afp_code` and `sfs_code` — the Tesorería de la Seguridad
  // Social, the Administradora de Fondos de Pensiones and the Seguro Familiar de Salud, three
  // Dominican institutions named in the schema of a table shared by nineteen markets. A Peruvian
  // tenant stored an ESSALUD code in a column called `sfs_code`. The concepts generalise — every
  // system has a worker number, a pension carrier and a health carrier — so the columns now carry
  // the concept and the country's own name for it comes from its payroll strategy's
  // `statutoryIdentifiers`.

  /** The worker's number in the national social security system. NSS, IMSS, NIT, PIS… */
  @Column({ name: 'social_security_number', type: 'varchar', nullable: true })
  socialSecurityNumber: string | null;

  /** The pension carrier the person is enrolled with (AFP, AFORE, fondo de pensiones…). */
  @Column({ name: 'pension_fund_code', type: 'varchar', nullable: true })
  pensionFundCode: string | null;

  /** The health carrier the person is enrolled with (ARS/SFS, EPS, ISAPRE, obra social…). */
  @Column({ name: 'health_fund_code', type: 'varchar', nullable: true })
  healthFundCode: string | null;

  /**
   * Anything else the country's filings need, keyed by the strategy's `StatutoryIdentifierSpec`.
   *
   * A fourth identifier — a Brazilian PIS alongside the CTPS, a Colombian ARL alongside the EPS —
   * is a key here rather than a fourth column and a migration. The three columns above stay
   * columns because every system has them and they are queried and exported; this is the escape
   * hatch that keeps the next country from adding schema.
   */
  @Column({ name: 'statutory_enrolment', type: 'jsonb', nullable: true })
  statutoryEnrolment: Record<string, string> | null;

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
