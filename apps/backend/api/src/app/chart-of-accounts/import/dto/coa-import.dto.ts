
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

export class ValidatedRow {
    lineNumber: number;
    data: any;
    isValid: boolean;
    errors: string[];
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