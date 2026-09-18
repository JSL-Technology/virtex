import { IsInt, IsString, Length, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Numbers of an authorized fiscal range that the taxpayer declares it will never use. */
export class VoidSequenceRangeDto {
  // A document-type code, not an `@IsEnum(NcfType)` — the enum is the DGII's, and every other
  // regime's codes are legitimate values it would reject (C-03). The active range is looked up by
  // this code and the tenant, so an unknown one simply matches no range.
  @IsString()
  @Length(1, 8, { message: 'validation.void_sequence_range.unknown_document_type' })
  type: string;

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
