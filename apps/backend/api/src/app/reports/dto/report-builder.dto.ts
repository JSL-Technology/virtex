
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export enum ReportRowType {
  ACCOUNT = 'ACCOUNT',
  GROUP = 'GROUP',
  FORMULA = 'FORMULA',
  HEADER = 'HEADER',
  BLANK = 'BLANK',
}

export enum ReportValueFormat {
  NUMBER = 'NUMBER',
  CURRENCY = 'CURRENCY',
  PERCENTAGE = 'PERCENTAGE',
}

export class ReportColumnDefinition {
  @ApiProperty({
    description: 'Identificador único para la columna, usado en la lógica interna.',
    example: 'col_current_period',
  })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({
    description: 'El texto que se mostrará en el encabezado de la columna.',
    example: 'Q3 2024',
  })
  @IsString()
  @IsNotEmpty()
  header: string;

  @ApiProperty({
    description: 'El ID del libro contable (Ledger) del cual se extraerán los datos para esta columna.',
  })
  @IsUUID()
  @IsNotEmpty()
  ledgerId: string;

  @ApiProperty({
    description: 'Define el rango de fechas para los datos de esta columna.',
  })
  @IsObject()
  @ValidateNested()
  @Type(() => PeriodDefinition)
  period: PeriodDefinition;
}

export class PeriodDefinition {
  @ApiProperty({
    description: 'Fecha de inicio del período en formato ISO 8601 (YYYY-MM-DD).',
  })
  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @ApiProperty({
    description: 'Fecha de fin del período en formato ISO 8601 (YYYY-MM-DD).',
  })
  @IsDateString()
  @IsNotEmpty()
  endDate: string;
}

export class ReportRowDefinition {
  @ApiProperty({
    description: 'Identificador único para la fila, usado para referencias en fórmulas.',
    example: 'row_total_ventas',
  })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({
    description: 'El texto o etiqueta que se mostrará para esta fila.',
    example: 'Ingresos por Ventas',
  })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiProperty({
    enum: ReportRowType,
    description: 'El tipo de fila, que determina cómo se calcula su valor.',
  })
  @IsEnum(ReportRowType)
  @IsNotEmpty()
  type: ReportRowType;

  @ApiProperty({
    description: 'Array de IDs de cuentas contables cuyos saldos se sumarán para esta fila. Solo aplica si el tipo es ACCOUNT o GROUP.',
    required: false,
    example: ['uuid-de-cuenta-1', 'uuid-de-cuenta-2'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  accountIds?: string[];

  @ApiProperty({
    description: 'La expresión matemática para calcular el valor de la fila. Usa los IDs de otras filas como variables. Solo aplica si el tipo es FORMULA.',
    required: false,
    example: 'row_total_ventas - row_costo_ventas',
  })
  @IsString()
  @IsOptional()
  formula?: string;

  @ApiProperty({
    description: 'El nivel de indentación de la fila, para visualización jerárquica.',
    default: 0,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  level?: number = 0;

  @ApiProperty({
    description: 'Si es verdadero, el valor numérico de la fila se multiplicará por -1. Útil para mostrar ingresos como positivos.',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  invertSign?: boolean = false;

  @ApiProperty({
    enum: ReportValueFormat,
    description: 'El formato de visualización para el valor de la fila.',
    default: ReportValueFormat.NUMBER,
  })
  @IsEnum(ReportValueFormat)
  @IsOptional()
  format?: ReportValueFormat = ReportValueFormat.NUMBER;
}

export class ReportDefinitionDto {
  @ApiProperty({
    description: 'El nombre del reporte.',
    example: 'Estado de Resultados Comparativo Mensual',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Una descripción opcional del propósito del reporte.',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Un array que define las columnas del reporte.',
    type: [ReportColumnDefinition],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportColumnDefinition)
  columns: ReportColumnDefinition[];

  @ApiProperty({
    description: 'Un array que define las filas del reporte en el orden en que deben aparecer.',
    type: [ReportRowDefinition],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportRowDefinition)
  rows: ReportRowDefinition[];
}