import { IsEnum, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { NcfType } from '../../compliance/entities/ncf-sequence.entity';

/** Numbers of an authorized e-NCF range that the taxpayer declares it will never use. */
export class VoidSequenceRangeDto {
  @IsEnum(NcfType, { message: 'VALIDATION.VOID_SEQUENCE_RANGE.TIPO_COMPROBANTE_DESCONOCIDO' })
  type: NcfType;

  /** First sequence number to annul, inclusive. Must be the next unissued number. */
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":1}' })
  from: number;

  /** Last sequence number to annul, inclusive. */
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":1}' })
  to: number;
}
