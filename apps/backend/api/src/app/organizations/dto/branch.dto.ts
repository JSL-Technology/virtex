import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PartialType } from '@nestjs/swagger';

export class CreateBranchDto {
  /** Uppercase letters, digits and dashes: it is printed on documents and typed into filters. */
  @IsString()
  @MinLength(1, { message: 'validation.constraints.min_length|{"min":1}' })
  @MaxLength(20, { message: 'validation.constraints.max_length|{"max":20}' })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9-]*$/, { message: 'organizations.branches.code_format' })
  code: string;

  @IsString()
  @MinLength(1, { message: 'validation.constraints.min_length|{"min":1}' })
  @MaxLength(120, { message: 'validation.constraints.max_length|{"max":120}' })
  name: string;

  @IsString() @IsOptional() @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  address?: string;

  @IsString() @IsOptional() @MaxLength(120, { message: 'validation.constraints.max_length|{"max":120}' })
  city?: string;

  @IsString() @IsOptional() @MaxLength(120, { message: 'validation.constraints.max_length|{"max":120}' })
  state?: string;

  @IsString() @IsOptional() @MaxLength(20, { message: 'validation.constraints.max_length|{"max":20}' })
  postalCode?: string;

  @IsString() @IsOptional() @MaxLength(40, { message: 'validation.constraints.max_length|{"max":40}' })
  phone?: string;

  @IsString() @IsOptional() @MaxLength(10, { message: 'validation.constraints.max_length|{"max":10}' })
  @Matches(/^[0-9A-Za-z]*$/, { message: 'organizations.branches.fiscal_code_format' })
  fiscalEstablishmentCode?: string;

  @IsString() @IsOptional() @MaxLength(10, { message: 'validation.constraints.max_length|{"max":10}' })
  @Matches(/^[0-9A-Za-z]*$/, { message: 'organizations.branches.fiscal_code_format' })
  emissionPointCode?: string;

  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  @IsOptional()
  defaultWarehouseId?: string | null;

  @IsBoolean()
  @IsOptional()
  isHeadquarters?: boolean;
}

export class UpdateBranchDto extends PartialType(CreateBranchDto) {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

/** The branches one person may work in, and where their documents come from by default. */
export class SetUserBranchAccessDto {
  /** Empty means every branch. */
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  branchIds: string[];

  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  @IsOptional()
  defaultBranchId?: string | null;
}
