import { IsNotEmpty, IsString, Length } from 'class-validator';

export class CreateCurrencyDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  @Length(3, 3)
  code: string;

  @IsNotEmpty()
  @IsString()
  symbol: string;
}