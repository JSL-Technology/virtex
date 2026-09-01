import { IsEnum, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { NcfType } from '../../compliance/entities/ncf-sequence.entity';

/** Numbers of an authorized e-NCF range that the taxpayer declares it will never use. */
export class VoidSequenceRangeDto {
  @IsEnum(NcfType, { message: 'Tipo de comprobante desconocido.' })
  type: NcfType;

  /** First sequence number to annul, inclusive. Must be the next unissued number. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  from: number;

  /** Last sequence number to annul, inclusive. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  to: number;
}
