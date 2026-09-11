import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterPluginDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @IsString()
  @MaxLength(50)
  version: string;

  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requestedEgress?: string[];

  @IsOptional()
  @IsObject()
  sbom?: unknown;

  @IsOptional()
  @IsObject()
  dependencies?: Record<string, string>;

  /** Client-side UI (JavaScript run in a sandboxed iframe). Optional; headless extensions omit it. */
  @IsOptional()
  @IsString()
  uiEntry?: string;

  /** Contribution manifest, e.g. `{ points: [{ type: 'page', title: '…' }] }`. */
  @IsOptional()
  @IsObject()
  contributes?: unknown;
}
