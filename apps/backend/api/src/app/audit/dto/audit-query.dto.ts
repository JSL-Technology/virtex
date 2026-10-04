import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ActionType } from '../entities/audit-log.entity';

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
  @MaxLength(64, { message: 'validation.constraints.max_length|{"max":64}' })
  @IsOptional()
  entity?: string;

  @IsUUID('4')
  @IsOptional()
  entityId?: string;

  /** Who acted. The trail's first question is usually «who did this». */
  @IsUUID('4')
  @IsOptional()
  userId?: string;

  @IsEnum(ActionType)
  @IsOptional()
  actionType?: ActionType;

  /** Inclusive lower bound, an ISO date or date-time. */
  @IsISO8601()
  @IsOptional()
  from?: string;

  /** Inclusive upper bound. A bare date covers that whole day. */
  @IsISO8601()
  @IsOptional()
  to?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(200, { message: 'validation.constraints.max|{"max":200}' })
  @IsOptional()
  pageSize?: number;
}
