import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateBinLocationDto {
  @IsUUID()
  @IsNotEmpty()
  warehouseId: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsOptional()
  zone?: string;

  @IsString()
  @IsOptional()
  aisle?: string;

  @IsString()
  @IsOptional()
  rack?: string;

  @IsString()
  @IsOptional()
  shelf?: string;
}
