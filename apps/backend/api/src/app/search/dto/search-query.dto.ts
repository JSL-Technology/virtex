import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * What a global search accepts (BUS-03).
 *
 * `q` was read raw: absent, `toLowerCase()` threw and the API answered 500; empty, every product
 * and every customer of the tenant came back. Now it is required, trimmed, and at least two
 * characters — one letter matches half the catalogue and says nothing.
 */
export class SearchQueryDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2, { message: 'validation.constraints.min_length|{"min":2}' })
  @MaxLength(100, { message: 'validation.constraints.max_length|{"max":100}' })
  q!: string;

  /** Results per group. */
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsOptional()
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(50, { message: 'validation.constraints.max|{"max":50}' })
  limit?: number;
}
