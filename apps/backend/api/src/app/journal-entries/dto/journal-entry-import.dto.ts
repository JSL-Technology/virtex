
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty, IsObject, ValidateNested, IsString, IsOptional, Length } from 'class-validator';
import { Type } from 'class-transformer';

export class CsvParsingOptionsDto {
  @IsString()
  @Length(1, 1)
  @IsOptional()
  delimiter?: string;

  @IsString()
  @Length(1, 1)
  @IsOptional()
  quoteChar?: string;
}


class ValidatedImportRowDto {
  @ApiProperty()
  lineNumber: number;

  @ApiProperty()
  isValid: boolean;

  @ApiProperty({ required: false })
  errorMessage?: string;

  @ApiProperty()
  data: Record<string, any>;
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
}



export class ConfirmImportDto {
  @IsUUID()
  @IsNotEmpty()
  @ApiProperty({ description: 'The batch ID received from the preview endpoint.' })
  batchId: string;
}