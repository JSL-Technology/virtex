
import { IsString, IsNotEmpty } from 'class-validator';

export class CreateUnitOfMeasureDto {
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsNotEmpty()
  nameKey: string;
}