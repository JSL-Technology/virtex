import { IsString, IsArray, IsOptional, Length } from 'class-validator';

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
  permissions?: string[];
}