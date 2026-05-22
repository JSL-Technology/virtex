
import { IsString, IsNotEmpty, IsInt, Min, IsBoolean, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAccountSegmentDefinitionDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @Min(1)
  length: number;

  @IsBoolean()
  isRequired: boolean;
}

export class ConfigureAccountSegmentsDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateAccountSegmentDefinitionDto)
    segments: CreateAccountSegmentDefinitionDto[];
}