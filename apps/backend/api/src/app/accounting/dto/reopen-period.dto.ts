
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MinLength } from 'class-validator';

export class ReopenPeriodDto {
  @IsUUID()
  @IsNotEmpty()
  @ApiProperty({
    description: 'El ID del período contable a reabrir.',
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  })
  periodId: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @ApiProperty({
    description: 'La justificación detallada para la reapertura del período.',
    example: 'Corrección de asientos de depreciación mal calculados.',
  })
  reason: string;
}

export class ReopenFiscalYearDto {
  @IsUUID()
  @IsNotEmpty()
  @ApiProperty({
    description: 'El ID del año fiscal a reabrir.',
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  })
  fiscalYearId: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @ApiProperty({
    description: 'La justificación detallada para la reapertura del año fiscal.',
    example: 'Ajustes de auditoría externa para el año fiscal cerrado.',
  })
  reason: string;
}