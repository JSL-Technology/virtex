
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateCustomerGroupDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;
}