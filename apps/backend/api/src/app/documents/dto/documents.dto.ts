import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DocumentTemplateType } from '../entities/document-node.entity';

/**
 * A name that can be part of a path.
 *
 * Slashes would make one node look like two, and the reserved characters below are what make a
 * downloaded file unopenable on Windows.
 */
/*
 * `no-control-regex` assumes a control character in a pattern is a typo. Here the control range is
 * the point: a name carrying a NUL or an ESC is what makes a downloaded file unopenable, and on
 * some platforms what lets a name lie about itself in a terminal.
 */
// eslint-disable-next-line no-control-regex
const SAFE_NAME = /^[^/\\:*?"<>|\u0000-\u001f]+$/;

export class ListDocumentsDto {
  /** The folder to look in. Absent means the root. */
  @IsUUID()
  @IsOptional()
  parentId?: string;

  /** Free-text filter on the name, searched across the whole tree rather than one folder. */
  @IsString()
  @IsOptional()
  @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  search?: string;

  @IsEnum(DocumentTemplateType)
  @IsOptional()
  templateType?: DocumentTemplateType;

  /** Only files tagged as a template of some kind. */
  @IsOptional()
  @Type(() => Boolean)
  templatesOnly?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(200, { message: 'validation.constraints.max|{"max":200}' })
  @IsOptional()
  pageSize?: number;
}

export class CreateFolderDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1, { message: 'validation.constraints.min_length|{"min":1}' })
  @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  @Matches(SAFE_NAME, { message: 'documents.name_not_allowed' })
  name: string;

  @IsUUID()
  @IsOptional()
  parentId?: string;
}

export class RenameDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1, { message: 'validation.constraints.min_length|{"min":1}' })
  @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  @Matches(SAFE_NAME, { message: 'documents.name_not_allowed' })
  name: string;
}

export class MoveDocumentDto {
  /** The folder to move into. Absent moves to the root. */
  @IsUUID()
  @IsOptional()
  parentId?: string;
}

export class UpdateDocumentDto {
  @IsEnum(DocumentTemplateType)
  @IsOptional()
  templateType?: DocumentTemplateType;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'validation.constraints.max_length|{"max":2000}' })
  description?: string;
}
