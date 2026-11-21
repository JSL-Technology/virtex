import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DatasheetMode } from '../entities/datasheet-book.entity';

/**
 * What a client may write on a datasheet book, and nothing else.
 *
 * Both routes took `Partial<DatasheetBook>`, which is no DTO at all: the global whitelist does not
 * apply to it, so every column reached `repository.create({ ...data })` + `save()`. A body naming the
 * `id` of ANOTHER tenant's book made `save()` update that row with the caller's organization and
 * owner — moving the book, sheets included, into the caller's tenant (reproduced 2026-11-08 between
 * qa-do-a and qa-do-b). `id`, `organizationId` and `ownerId` are not declared here, so a request
 * carrying them is refused with 400 before it reaches the service.
 */
export class DatasheetSheetInputDto {
  /** Present only to update a sheet that already belongs to the book being updated. */
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsInt()
  @Min(0)
  index!: number;

  @IsOptional()
  @IsBoolean()
  protected?: boolean;

  @IsOptional()
  @IsObject()
  cells?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  conditionalFormats?: unknown[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  charts?: unknown[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  namedRanges?: unknown[];
}

export class CreateDatasheetBookDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(DatasheetMode)
  mode?: DatasheetMode;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  tags?: string[];

  /** New sheets only: a sheet with an `id` is refused on create (see the service). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DatasheetSheetInputDto)
  sheets?: DatasheetSheetInputDto[];
}

export class UpdateDatasheetBookDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(DatasheetMode)
  mode?: DatasheetMode;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DatasheetSheetInputDto)
  sheets?: DatasheetSheetInputDto[];
}

export class CreateDatasheetVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
