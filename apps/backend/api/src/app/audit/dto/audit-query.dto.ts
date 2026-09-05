import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/**
 * Filters for the audit trail.
 *
 * The route took `@Query('entity')` and `@Query('entityId')` as bare strings, so the global
 * `ValidationPipe` had nothing to validate and nothing to strip — and it returned the tenant's
 * entire trail, unbounded, however many years of it there were.
 */
export class AuditQueryDto {
  /** The entity type, e.g. `JournalEntry`. */
  @IsString()
  @MaxLength(64)
  @IsOptional()
  entity?: string;

  @IsUUID('4')
  @IsOptional()
  entityId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  pageSize?: number;
}
