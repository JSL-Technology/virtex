import { IsEnum, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { NcfType } from '../../compliance/entities/ncf-sequence.entity';

/** Numbers of an authorized e-NCF range that the taxpayer declares it will never use. */
export class VoidSequenceRangeDto {
  @IsEnum(NcfType, { message: 'validation.void_sequence_range.unknown_document_type' })
  type: NcfType;

  /** First sequence number to annul, inclusive. Must be the next unissued number. */
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  from: number;

  /** Last sequence number to annul, inclusive. */
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  to: number;
}
