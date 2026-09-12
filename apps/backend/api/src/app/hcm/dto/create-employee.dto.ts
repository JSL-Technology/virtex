import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import {
  ContractType,
  EmploymentStatus,
  IdentityDocumentType,
} from '../entities/employee.entity';
import { IsIdentityDocumentForType } from '../validators/identity-document.validator';

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

  @IsString()
  @IsOptional()
  @IsIdentityDocumentForType()
  identityDocument?: string;

  @IsEnum(IdentityDocumentType)
  @IsOptional()
  identityDocumentType?: IdentityDocumentType;

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

  @IsString()
  @IsOptional()
  @Matches(/^\d{7,11}$/, { message: 'tssNss must be 7–11 digits (NSS)' })
  tssNss?: string;

  @IsString()
  @IsOptional()
  afpCode?: string;

  @IsString()
  @IsOptional()
  sfsCode?: string;

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
