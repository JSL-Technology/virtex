import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus } from '../entities/user.entity/user.entity';

/** Columns the user list may be ordered by. Mirrors the service's allow-list. */
export const USER_SORT_COLUMNS = ['firstName', 'lastName', 'email', 'status', 'createdAt'] as const;
export type UserSortColumn = (typeof USER_SORT_COLUMNS)[number];

/**
 * The query for `GET /users`, validated rather than trusted.
 *
 * The parameters used to arrive as bare `@Query()` defaults with no pipe, so `pageSize` was
 * whatever the caller sent — `?pageSize=1000000` reached `.take()` unchanged and asked the
 * database for the entire tenant in one response — and `?page=abc` reached arithmetic as a
 * string. A page size is a resource-consumption decision and belongs to the server.
 *
 * `sortColumn` and `status` are enums here as well as allow-listed in the service. The service's
 * check is what prevents SQL injection and must stay; this one turns a bad value into a clear
 * 400 instead of silently ignoring it and returning a differently-ordered page.
 */
export class ListUsersQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? 1 : Number(value)))
  @IsInt({ message: 'validation.list_users_query.page_must_whole_number' })
  @Min(1, { message: 'validation.list_users_query.page_must_greater' })
  page = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? 25 : Number(value)))
  @IsInt({ message: 'validation.list_users_query.page_size_must_whole_number' })
  @Min(1, { message: 'validation.list_users_query.page_size_must_greater' })
  @Max(100, { message: 'validation.list_users_query.page_size_cannot_greater_than_100' })
  pageSize = 25;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'validation.list_users_query.search_cannot_longer_than_120_characters' })
  search = '';

  @ApiPropertyOptional({ enum: [...Object.values(UserStatus), 'all'], default: 'all' })
  @IsOptional()
  @IsEnum([...Object.values(UserStatus), 'all'], { message: 'validation.list_users_query.status_not_valid' })
  status = 'all';

  @ApiPropertyOptional({ enum: USER_SORT_COLUMNS, default: 'createdAt' })
  @IsOptional()
  @IsEnum(USER_SORT_COLUMNS, { message: 'validation.list_users_query.column_cannot_sorted' })
  sortColumn: UserSortColumn = 'createdAt';

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsEnum(['ASC', 'DESC'], { message: 'validation.list_users_query.sort_direction_not_valid' })
  sortDirection: 'ASC' | 'DESC' = 'DESC';
}
