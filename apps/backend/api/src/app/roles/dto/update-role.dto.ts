import { IsString, IsArray, IsOptional, Length, IsIn } from 'class-validator';
import { ALL_PERMISSIONS, Permission } from '../../shared/permissions';

export class UpdateRoleDto {
  @IsString()
  @Length(3, 100)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  @Length(0, 255)
  description?: string;

  // H8 FIX: Validate each permission against the known catalog.
  @IsArray()
  @IsOptional()
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissions?: Permission[];
}