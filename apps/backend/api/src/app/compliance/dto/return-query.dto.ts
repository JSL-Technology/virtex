import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

/**
 * The period of a return, and whatever its own authority asks for beyond it.
 *
 * The options are carried as `name:value` pairs rather than as named fields: which ones exist is
 * the market's to declare (`MarketReturnFiling.options`) and the door is one route for every
 * market, so a field per option would put the SAT's `tipoEnvio` and the next authority's
 * parameters in the core's own DTO. Each pair is bounded here and checked against the filing's
 * declaration before anything is built — an option the authority does not define is refused, not
 * ignored, because a caller that sent one believes they said something.
 */
export class GenerateReturnQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000, { message: 'validation.constraints.min|{"min":2000}' })
  @Max(2999, { message: 'validation.constraints.max|{"max":2999}' })
  year: number;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(12, { message: 'validation.constraints.max|{"max":12}' })
  month: number;

  /** Which ledger a bookkeeping filing reads; the company's default one when absent. */
  @IsUUID()
  @IsOptional()
  ledgerId?: string;

  /** `tipoEnvio:C`, `fechaModBal:2026-06-30`. One query parameter repeated, at most ten. */
  @Transform(({ value }) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]))
  @IsArray()
  @ArrayMaxSize(10)
  @Matches(/^[A-Za-z][A-Za-z0-9]{0,31}:[^:]{1,128}$/, { each: true })
  @IsOptional()
  option?: string[];
}

/** The options as the engine takes them: the pairs, split once. */
export function returnOptionsOf(query: GenerateReturnQueryDto): Record<string, string> {
  const options: Record<string, string> = {};
  for (const pair of query.option ?? []) {
    const separator = pair.indexOf(':');
    options[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return options;
}
