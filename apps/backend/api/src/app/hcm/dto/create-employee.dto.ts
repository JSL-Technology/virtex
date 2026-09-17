import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsISO31661Alpha2,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
  IsUUID,
} from 'class-validator';
import { ContractType, EmploymentStatus } from '../entities/employee.entity';

export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  jobTitle?: string;

  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @IsDateString()
  @IsOptional()
  hireDate?: string;

  @IsUUID()
  @IsOptional()
  userId?: string;

  // ── Fiscal identity (sensitive; encrypted at rest) ───────────────────────────

  /**
   * The identity document's value.
   *
   * Shape and check digit are NOT asserted here. class-validator runs before anything knows which
   * tenant this is, and the rule that applies depends on the tenant's country and on the catalogue
   * row for `identityDocumentType` — neither of which a synchronous decorator can reach. It used
   * to try, with `@IsIdentityDocumentForType()`, and the way it resolved that problem was to apply
   * the Dominican JCE algorithm to every country's employees.
   *
   * `HcmService` validates it against `IdentityDocumentService` once the organization is known,
   * and stores the catalogue's canonical form.
   */
  @IsString()
  @IsOptional()
  identityDocument?: string;

  /**
   * The catalogue code of the document type: `CEDULA`, `CC`, `CURP`, `PASSPORT`…
   *
   * A string, not an enum. An enum here is what made `CEDULA`, `PASSPORT` and `RNC` the only three
   * documents nineteen markets could express, and what made adding a twentieth a schema migration.
   * The value is checked against `identity_document_types` for the resolved country — an unknown
   * code is rejected, so this is not a hole.
   */
  @IsString()
  @IsOptional()
  @Length(1, 32)
  identityDocumentType?: string;

  /**
   * The issuing jurisdiction, when it is not the tenant's own.
   *
   * Defaults to the organization's country. Set explicitly for a foreign hire whose document was
   * issued elsewhere — a passport in particular belongs to the traveller's state, which is why the
   * catalogue files it under `XX` rather than duplicating it per market.
   */
  @IsISO31661Alpha2()
  @IsOptional()
  identityDocumentCountry?: string;

  // ── Bank account for the wage payment (sensitive; encrypted at rest) ─────────

  @IsString()
  @IsOptional()
  bankName?: string;

  @IsString()
  @IsOptional()
  bankAccountNumber?: string;

  @IsString()
  @IsOptional()
  bankAccountType?: string;

  // ── Social security enrolment ────────────────────────────────────────────────
  //
  // Shapes are NOT asserted here. `@Matches(/^\d{7,11}$/)` used to sit on `tssNss`, imposing the
  // Dominican NSS format on every market's employees. The rule now comes from the country's
  // payroll jurisdiction strategy (`statutoryIdentifiers`) and `HcmService` applies it once the
  // tenant — and therefore the country — is known.

  /** The worker's number in the national social security system. NSS, IMSS, NIT, PIS… */
  @IsString()
  @IsOptional()
  socialSecurityNumber?: string;

  /** The pension carrier the person is enrolled with (AFP, AFORE, fondo de pensiones…). */
  @IsString()
  @IsOptional()
  pensionFundCode?: string;

  /** The health carrier the person is enrolled with (ARS/SFS, EPS, ISAPRE, obra social…). */
  @IsString()
  @IsOptional()
  healthFundCode?: string;

  /**
   * Any further statutory identifier the country's filings need, keyed by its spec's `field`.
   *
   * `@IsObject()` and nothing more: which keys are legitimate is a property of the country, and
   * the jurisdiction strategy is what knows them. An unrecognised key is inert — it is stored and
   * never read — which is a smaller problem than a fourth nullable column per market.
   */
  @IsObject()
  @IsOptional()
  statutoryEnrolment?: Record<string, string>;

  // ── Employment ───────────────────────────────────────────────────────────────

  @IsEnum(EmploymentStatus)
  @IsOptional()
  employmentStatus?: EmploymentStatus;

  @IsEnum(ContractType)
  @IsOptional()
  contractType?: ContractType;

  @IsDateString()
  @IsOptional()
  terminationDate?: string;
}
