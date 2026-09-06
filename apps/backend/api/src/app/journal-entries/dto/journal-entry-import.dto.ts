
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty, IsObject, ValidateNested, IsString, IsOptional, IsIn, Length } from 'class-validator';
import { Type } from 'class-transformer';

export class CsvParsingOptionsDto {
  @IsString()
  @Length(1, 1, { message: 'VALIDATION.CONSTRAINTS.LENGTH|{"min":1,"max":1}' })
  @IsOptional()
  delimiter?: string;

  @IsString()
  @Length(1, 1, { message: 'VALIDATION.CONSTRAINTS.LENGTH|{"min":1,"max":1}' })
  @IsOptional()
  quoteChar?: string;
}


/**
 * Why one row of the file cannot be posted.
 *
 * A message key with its parameters, not a sentence. The importer used to answer with hardcoded
 * Spanish — `'La cuenta con código X no existe.'` — for a product sold in the United States and
 * Brazil, and that string reached the screen exactly as written.
 */
export class ImportRowErrorDto {
  @ApiProperty({ description: 'Clave de mensaje traducible.' })
  messageKey: string;

  @ApiProperty({ required: false, description: 'Parámetros de la clave.' })
  params?: Record<string, string | number>;
}

class ValidatedImportRowDto {
  @ApiProperty()
  lineNumber: number;

  @ApiProperty()
  isValid: boolean;

  @ApiProperty({ required: false, type: ImportRowErrorDto })
  error?: ImportRowErrorDto;

  @ApiProperty()
  data: Record<string, string>;
}



export class PreviewedJournalEntryDto {
  @ApiProperty()
  entryId: string;

  @ApiProperty()
  isBalanced: boolean;

  @ApiProperty()
  totalDebit: number;

  @ApiProperty()
  totalCredit: number;

  /** Whole-entry problems: an unreadable date, an entry that does not balance. */
  @ApiProperty({ type: [ImportRowErrorDto] })
  errors: ImportRowErrorDto[];

  @ApiProperty({ type: [ValidatedImportRowDto] })
  rows: ValidatedImportRowDto[];
}


export class PreviewImportResponseDto {
  @ApiProperty()
  batchId: string;

  @ApiProperty()
  totalEntries: number;

  @ApiProperty()
  validEntriesCount: number;

  @ApiProperty()
  invalidEntriesCount: number;

  @ApiProperty({ type: [PreviewedJournalEntryDto] })
  previews: PreviewedJournalEntryDto[];
}



class ColumnMappingDto {
    @IsString()
    @IsNotEmpty()
    entryId: string;

    @IsString()
    @IsNotEmpty()
    date: string;

    @IsString()
    @IsNotEmpty()
    description: string;

    @IsString()
    @IsNotEmpty()
    accountCode: string;

    @IsString()
    @IsNotEmpty()
    debit: string;

    @IsString()
    @IsNotEmpty()
    credit: string;

    @IsString()
    @IsOptional()
    lineDescription?: string;
}

export class PreviewImportRequestDto {
    @IsObject()
    @ValidateNested()
    @Type(() => ColumnMappingDto)
    @ApiProperty({ description: 'Mapeo de las columnas del archivo a los campos requeridos.'})
    columnMapping: ColumnMappingDto;

    /**
     * How the file writes a date, in `date-fns` tokens — `dd/MM/yyyy`, `MM/dd/yyyy`, `yyyy-MM-dd`.
     *
     * There is no safe default and the importer used to hand the string to `new Date()`, which
     * reads `03/04/2026` as 4 March in the United States and 3 April almost everywhere else. On a
     * product sold across Latin America and the United States that silently moves an entry by up
     * to eleven months — into another month's return, and often into a period that is closed.
     */
    @IsString()
    @IsNotEmpty()
    @Length(1, 32)
    @ApiProperty({ example: 'dd/MM/yyyy' })
    dateFormat: string;

    /**
     * How the file writes a decimal point.
     *
     * `parseFloat` read one convention and failed silently on the other: `1.234,56` — the ordinary
     * way of writing money in most of the region — became `1.234`, and the entry still balanced,
     * because both sides were divided by the same thousand.
     */
    @IsIn(['.', ','])
    @ApiProperty({ enum: ['.', ','], example: ',' })
    decimalSeparator: '.' | ',';
}



export class ConfirmImportDto {
  @IsUUID()
  @IsNotEmpty()
  @ApiProperty({ description: 'The batch ID received from the preview endpoint.' })
  batchId: string;
}