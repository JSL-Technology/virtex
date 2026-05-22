
import { IsString, IsNotEmpty, IsOptional, IsEmail } from 'class-validator';

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  topic: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  companyName?: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  phone?: string;
}