
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsDateString,
  IsUUID,
  ValidateNested,
  IsIn,
  IsInt,
  Min,
} from 'class-validator';

const validOperators = ['eq', 'neq', 'in'] as const;
type Operator = (typeof validOperators)[number];

class FilterDto {
  @ApiProperty({
    description: 'El campo (dimensión o métrica) por el cual filtrar.',
    example: 'account_category',
  })
  @IsString()
  @IsNotEmpty()
  field: string;

  @ApiProperty({
    description: 'El operador de comparación.',
    enum: validOperators,
    example: 'eq',
  })
  @IsIn(validOperators)
  operator: Operator;

  @ApiProperty({
    description: 'El valor para el filtro. Debe ser un array si el operador es "in".',
    example: 'OPERATING_EXPENSE',
  })
  @IsNotEmpty()
  value: any;
}

class PeriodDto {
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

export class PaginationOptionsDto {
  @ApiPropertyOptional({
    description: 'El número de página a obtener.',
    default: 1,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'El número de ítems por página.',
    default: 100,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limit: number = 100;
}

export class AnalyticalQueryDto {
  @ApiProperty({
    description: 'El ID del libro contable (Ledger) sobre el cual se ejecutará la consulta.',
  })
  @IsUUID()
  @IsNotEmpty()
  ledgerId: string;

  @ApiProperty({
    description: 'Define el rango de fechas principal para la consulta.',
  })
  @ValidateNested()
  @Type(() => PeriodDto)
  period: PeriodDto;

  @ApiProperty({
    description: 'Un array de las métricas numéricas a calcular (ej. suma de débitos, créditos, etc.).',
    example: ['net_change', 'debit', 'credit'],
    enum: ['debit', 'credit', 'net_change'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsIn(['debit', 'credit', 'net_change'], { each: true })
  @IsNotEmpty()
  measures: ('debit' | 'credit' | 'net_change')[];

  @ApiPropertyOptional({
    description: 'Un array de las dimensiones por las cuales agrupar los resultados (las "filas" del reporte).',
    example: ['account_name', 'cost_center'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  dimensions?: string[];

  @ApiPropertyOptional({
    description: 'Un array de filtros para acotar los datos antes de la agregación.',
    type: [FilterDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FilterDto)
  @IsOptional()
  filters?: FilterDto[];
}