import { IsString, IsArray, IsOptional, Length } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @Length(3, 100)
  name: string;

  @IsString()
  @IsOptional()
  @Length(0, 255)
  description?: string;

  @IsArray()
  permissions: string[];
}