import { IsObject, IsOptional as IsOptionalField } from 'class-validator';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DATASET_ID = /^[a-z][a-z0-9_-]{1,63}$/;

export class ExportRequestDto {
  @IsString()
  @Matches(DATASET_ID)
  dataset: string;

  @IsIn(['csv', 'xlsx'])
  format: 'csv' | 'xlsx';
}

export class ImportQueryDto {
  @IsString()
  @Matches(DATASET_ID)
  dataset: string;

  /** `validate` runs every check and writes nothing. */
  @IsOptional()
  @IsIn(['validate', 'commit'])
  mode?: 'validate' | 'commit';
}

export class RunsQueryDto {
  @IsOptional()
  @IsIn(['EXPORT', 'IMPORT'])
  kind?: 'EXPORT' | 'IMPORT';
}

export class TemplateParamsDto {
  @IsString()
  @MaxLength(64)
  @Matches(DATASET_ID)
  dataset: string;
}

/**
 * The form fields beside an imported file. FastifyFileInterceptor parses a field that holds a JSON
 * object, so the confirmed mapping arrives as an object — the controller used to JSON.parse it again
 * and every import with a confirmed mapping failed with `mapping_invalid`.
 */
export class ImportFormDto {
  @IsOptionalField()
  @IsObject()
  mapping?: Record<string, unknown>;
}
