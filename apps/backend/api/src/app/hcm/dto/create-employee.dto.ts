import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import {
  ContractType,
  EmploymentStatus,
  IdentityDocumentType,
} from '../entities/employee.entity';

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
