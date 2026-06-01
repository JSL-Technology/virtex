import { IsString, IsArray, IsOptional, Length, IsIn, ArrayNotEmpty } from 'class-validator';
import { ALL_PERMISSIONS, Permission } from '../../shared/permissions';

export class CreateRoleDto {
  @IsString()
  @Length(3, 100)
  name: string;

  @IsString()
  @IsOptional()
  @Length(0, 255)
  description?: string;

  // H8 FIX: Validate each permission against the known catalog; prevents privilege escalation via arbitrary permissions.
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissions: Permission[];
}