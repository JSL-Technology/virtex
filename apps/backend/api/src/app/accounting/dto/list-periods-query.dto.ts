import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListPeriodsQueryDto {
  /**
   * Bounded on both ends because the value reaches a `BETWEEN` on a `date` column: an unbounded
   * integer there is a scan over a range that cannot contain rows, and a negative one builds a
   * date literal PostgreSQL rejects at parse time rather than at validation time.
   */
  @ApiPropertyOptional({ minimum: 1900, maximum: 2999 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'VALIDATION.YEAR_MUST_BE_INTEGER' })
  @Min(1900, { message: 'VALIDATION.YEAR_OUT_OF_RANGE' })
  @Max(2999, { message: 'VALIDATION.YEAR_OUT_OF_RANGE' })
  year?: number;
}
