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
  @IsInt({ message: 'VALIDATION.LIST_USERS_QUERY.PAGINA_DEBE_NUMERO_ENTERO' })
  @Min(1, { message: 'VALIDATION.LIST_USERS_QUERY.PAGINA_DEBE_1_MAYOR' })
  page = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? 25 : Number(value)))
  @IsInt({ message: 'VALIDATION.LIST_USERS_QUERY.TAMANO_PAGINA_DEBE_NUMERO_ENTERO' })
  @Min(1, { message: 'VALIDATION.LIST_USERS_QUERY.TAMANO_PAGINA_DEBE_1_MAYOR' })
  @Max(100, { message: 'VALIDATION.LIST_USERS_QUERY.TAMANO_PAGINA_NO_PUEDE_MAYOR_100' })
  pageSize = 25;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'VALIDATION.LIST_USERS_QUERY.BUSQUEDA_NO_PUEDE_TENER_MAS_120_CARACTERES' })
  search = '';

  @ApiPropertyOptional({ enum: [...Object.values(UserStatus), 'all'], default: 'all' })
  @IsOptional()
  @IsEnum([...Object.values(UserStatus), 'all'], { message: 'VALIDATION.LIST_USERS_QUERY.ESTADO_NO_VALIDO' })
  status = 'all';

  @ApiPropertyOptional({ enum: USER_SORT_COLUMNS, default: 'createdAt' })
  @IsOptional()
  @IsEnum(USER_SORT_COLUMNS, { message: 'VALIDATION.LIST_USERS_QUERY.NO_PUEDE_ORDENAR_POR_ESA_COLUMNA' })
  sortColumn: UserSortColumn = 'createdAt';

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsEnum(['ASC', 'DESC'], { message: 'VALIDATION.LIST_USERS_QUERY.DIRECCION_ORDEN_NO_VALIDA' })
  sortDirection: 'ASC' | 'DESC' = 'DESC';
}
