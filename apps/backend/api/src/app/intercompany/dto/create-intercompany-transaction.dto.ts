
import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateIntercompanyTransactionDto {
  @IsUUID()
  @IsNotEmpty()
  toOrganizationId: string;

  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsString()
  @IsNotEmpty()
  @Length(3, 3, { message: 'validation.constraints.length|{"min":3,"max":3}' })
  currency: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  description: string;

  @IsUUID()
  @IsNotEmpty()
  fromAccountId: string;

  @IsUUID()
  @IsNotEmpty()
  toAccountId: string;
}