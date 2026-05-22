
import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsArray, ValidateNested, IsOptional, IsUUID } from 'class-validator';

export class CreateDimensionValueDto {
  @IsString()
  @IsNotEmpty()
  value: string;
}

export class CreateDimensionDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDimensionValueDto)
  values: CreateDimensionValueDto[];
}

export class UpdateDimensionValueDto {
    @IsUUID()
    @IsOptional()
    id?: string;

    @IsString()
    @IsNotEmpty()
    value: string;
}

export class UpdateDimensionDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateDimensionValueDto)
  @IsOptional()
  values?: UpdateDimensionValueDto[];
}