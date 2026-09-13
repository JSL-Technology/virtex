import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * One variable reference from a sheet.
 *
 * Validated rather than taken as `any`. The previous controller accepted
 * `@Body('variables') variables: { name: string, params: any[] }[]` — no DTO, no `ValidationPipe`
 * coverage, no bound on how many variables one request could ask for, and `params` reaching a
 * repository query as whatever the caller sent.
 */
export class VariableReferenceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64, { message: 'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":64}' })
  name: string;

  /** At most two, which is the most any variable in the registry declares. */
  @IsArray()
  @ArrayMaxSize(2, { message: 'VALIDATION.CONSTRAINTS.ARRAY_MAX_SIZE|{"max":2}' })
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  @IsOptional()
  params?: string[];
}

export class ResolveVariablesDto {
  /**
   * Bounded: a sheet with ten thousand formulas must not become ten thousand aggregate queries in
   * one request. The client pages its recalculation.
   */
  @IsArray()
  @ArrayMinSize(1, { message: 'VALIDATION.CONSTRAINTS.ARRAY_MIN_SIZE|{"min":1}' })
  @ArrayMaxSize(200, { message: 'VALIDATION.CONSTRAINTS.ARRAY_MAX_SIZE|{"max":200}' })
  @ValidateNested({ each: true })
  @Type(() => VariableReferenceDto)
  variables: VariableReferenceDto[];
}

export class ImportDatasetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40, { message: 'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":40}' })
  module: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40, { message: 'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":40}' })
  set: string;

  /** Column keys from the dataset's own catalogue; anything else is rejected by the service. */
  @IsArray()
  @ArrayMinSize(1, { message: 'VALIDATION.CONSTRAINTS.ARRAY_MIN_SIZE|{"min":1}' })
  @ArrayMaxSize(50, { message: 'VALIDATION.CONSTRAINTS.ARRAY_MAX_SIZE|{"max":50}' })
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  columns: string[];

  @IsInt()
  @Min(1, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":1}' })
  @IsOptional()
  page?: number;

  @IsInt()
  @Min(1, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":1}' })
  @IsOptional()
  pageSize?: number;
}
