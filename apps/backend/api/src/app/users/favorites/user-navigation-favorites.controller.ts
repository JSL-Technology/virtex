import { Body, Controller, Delete, Get, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, Matches, MaxLength } from 'class-validator';

import { AuthenticatedOnly } from '../../security/decorators/authenticated-only.decorator';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../security/principal';
import { MAX_FAVORITES, UserNavigationFavoritesService } from './user-navigation-favorites.service';

/**
 * A menu route as the client names it: `/accounting/journals`. Lower-case segments of letters,
 * digits, dots and dashes — no company prefix, no query, nothing that is not a path. The server
 * never renders or follows it; the shape check keeps the column to what it is for.
 */
const ROUTE = /^(\/[a-z0-9][a-z0-9._-]*)+$/;

export class FavoriteRouteDto {
  @MaxLength(200)
  @Matches(ROUTE)
  route: string;
}

export class ReorderFavoritesDto {
  @IsArray()
  @ArrayMaxSize(MAX_FAVORITES)
  @MaxLength(200, { each: true })
  @Matches(ROUTE, { each: true })
  routes: string[];
}

/** What every endpoint answers: the whole list, in order, so the client converges on it. */
interface FavoritesResponse {
  routes: string[];
}

/**
 * The menu favourites of whoever asks, in the company they are in.
 *
 * Same reasoning as `me/workspace`: the subject comes from the principal and the company from the
 * request context, so the routes admit no other person's favourites even typed by hand, and a
 * permission would be asking for authorisation to see oneself. Favourites are shortcuts to menu
 * pages; opening one still goes through that page's own permission.
 */
@ApiTags('Workspace')
@Controller('me/favorites')
export class UserNavigationFavoritesController {
  constructor(private readonly favorites: UserNavigationFavoritesService) {}

  @Get()
  @AuthenticatedOnly(
    'Los favoritos de quien pregunta, en su empresa activa: el usuario sale del principal y la ' +
      'empresa del contexto de la petición, así que no hay otro sujeto posible.',
  )
  @ApiOperation({ summary: 'Los favoritos del menú, en orden' })
  async list(@CurrentUser() user: AuthenticatedUser): Promise<FavoritesResponse> {
    return { routes: await this.favorites.list(user.id, user.organizationId) };
  }

  @Post()
  @AuthenticatedOnly(
    'Añade un favorito a la lista de quien pregunta, en su empresa activa. Solo es un atajo: abrir ' +
      'la página sigue pidiendo su propio permiso.',
  )
  @ApiOperation({ summary: 'Añade un favorito al final; añadir uno que ya existe no cambia nada' })
  async add(@CurrentUser() user: AuthenticatedUser, @Body() dto: FavoriteRouteDto): Promise<FavoritesResponse> {
    return { routes: await this.favorites.add(user.id, user.organizationId, dto.route) };
  }

  @Delete()
  @AuthenticatedOnly(
    'Quita un favorito de la lista de quien pregunta, en su empresa activa. El sujeto lo fija el ' +
      'principal: no hay lista ajena alcanzable.',
  )
  @ApiOperation({ summary: 'Quita un favorito; quitar uno que no existe no cambia nada' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Query() dto: FavoriteRouteDto): Promise<FavoritesResponse> {
    return { routes: await this.favorites.remove(user.id, user.organizationId, dto.route) };
  }

  @Put('order')
  @AuthenticatedOnly(
    'Reordena los favoritos de quien pregunta, en su empresa activa. Las rutas que no son ' +
      'favoritos se ignoran, así que no puede crear ni borrar nada.',
  )
  @ApiOperation({ summary: 'Reordena los favoritos' })
  async reorder(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReorderFavoritesDto): Promise<FavoritesResponse> {
    return { routes: await this.favorites.reorder(user.id, user.organizationId, dto.routes) };
  }
}
