import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_PAGE_SIZE } from '../pagination';

/**
 * `page` and `pageSize` for a list route.
 *
 * Declared as a DTO rather than read with `@Query('page')`: the global `ValidationPipe` runs with
 * `whitelist: true`, so a property no DTO declares is stripped before the handler sees it — which
 * is how a paging parameter comes to be silently ignored while the route appears to accept it.
 */
export class PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @IsOptional()
  pageSize?: number;
}
