import { IsString, IsArray, IsOptional, Length, IsIn, ArrayNotEmpty } from 'class-validator';
import { ALL_PERMISSIONS } from '../../shared/permissions';

export class CreateRoleDto {
  @IsString()
  @Length(3, 100)
  name: string;

  @IsString()
  @IsOptional()
  @Length(0, 255)
  description?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissions: string[];
}