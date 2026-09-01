import { IsString, IsNotEmpty, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class CreateSubsidiaryDto {
  @IsString()
  @IsNotEmpty()
  legalName: string;

  @IsString()
  @IsNotEmpty()
  taxId: string;

  @IsString()
  @IsNotEmpty()
  country: string;

  @IsNumber()
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  @Max(100, { message: 'VALIDATION.CONSTRAINTS.MAX|{"max":100}' })
  ownership: number;
}
