import { IsString, IsArray, IsOptional, Length, IsIn } from 'class-validator';
import { ALL_PERMISSIONS } from '../../shared/permissions';

export class UpdateRoleDto {
  @IsString()
  @Length(3, 100)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  @Length(0, 255)
  description?: string;

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissions?: string[];
}