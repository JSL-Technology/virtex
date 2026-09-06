
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsObject, IsString, IsUUID, ValidateNested } from 'class-validator';

export class ColumnMappingDto {
    @IsString()
    @IsNotEmpty()
    code: string;

    @IsString()
    @IsNotEmpty()
    name: string;

    @IsString()
    @IsNotEmpty()
    type: string;

    @IsString()
    @IsNotEmpty()
    category: string;

    @IsString()
    @IsNotEmpty()
    nature: string;

    @IsString()
    @IsNotEmpty()
    isPostable: string;

    @IsString()
    description: string;

    @IsString()
    parentCode: string;
}

/**
 * Why one row of the file cannot be imported.
 *
 * A message key with its parameters, not a sentence. The importer answered in hardcoded English —
 * `'Code is required.'`, `'Invalid Account Type.'` — for a product sold across Latin America, and
 * those strings reached the screen exactly as written.
 */
export class ImportRowErrorDto {
    messageKey: string;
    params?: Record<string, string | number>;
}

export class ValidatedRow {
    lineNumber: number;
    data: Record<string, string>;
    isValid: boolean;
    errors: ImportRowErrorDto[];
}


export class ImportBatch {
    id: string;
    organizationId: string;
    userId: string;
    mapping: ColumnMappingDto;
    rows: ValidatedRow[];
    createdAt: Date;
}


export class PreviewCoaImportResponseDto {
    batchId: string;
    totalRows: number;
    validCount: number;
    invalidCount: number;
    validatedRows: ValidatedRow[];
}

export class PreviewCoaImportDto {
    @IsObject()
    @ValidateNested()
    @Type(() => ColumnMappingDto)
    @ApiProperty({ description: 'Mapping of file columns to required fields.'})
    columnMapping: ColumnMappingDto;
}

export class ConfirmCoaImportDto {
  @IsUUID()
  @IsNotEmpty()
  @ApiProperty({ description: 'The batch ID received from the preview endpoint.' })
  batchId: string;
}