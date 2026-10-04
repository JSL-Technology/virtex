import { IsBoolean, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { IsBic } from '../../common/validators/bank-identifiers.validator';

export class CreateBankDto {
  @IsString()
  @MinLength(1, { message: 'validation.constraints.min_length|{"min":1}' })
  @MaxLength(120, { message: 'validation.constraints.max_length|{"max":120}' })
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(11, { message: 'validation.constraints.max_length|{"max":11}' })
  @IsBic()
  swiftBic?: string;

  @IsString()
  @IsOptional()
  @Length(2, 2, { message: 'validation.constraints.length|{"min":2,"max":2}' })
  @Matches(/^[A-Za-z]{2}$/, { message: 'validation.constraints.country_code' })
  countryCode?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20, { message: 'validation.constraints.max_length|{"max":20}' })
  localCode?: string;
}

export class UpdateBankDto extends PartialType(CreateBankDto) {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
