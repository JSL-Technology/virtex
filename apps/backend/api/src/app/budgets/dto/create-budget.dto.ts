
import { IsArray, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class BudgetLineDto {
  @IsUUID()
  @IsNotEmpty()
  accountId: string;

  @IsNumber()
  @Min(0)
  amount: number;
  
  @IsObject()
  @IsOptional()
  dimensions?: Record<string, string>;
}

export class CreateBudgetDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  period: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  lines: BudgetLineDto[];
}