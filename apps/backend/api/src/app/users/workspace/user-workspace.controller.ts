import { Body, Controller, Delete, Get, HttpCode, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, Min } from 'class-validator';

import { AuthenticatedOnly } from '../../security/decorators/authenticated-only.decorator';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../security/principal';
import { UserWorkspaceService } from './user-workspace.service';

export class SaveWorkspaceDto {
  @IsInt()
  @Min(1)
  schemaVersion: number;

  /** La revisión que el cliente vio. 0 = no tenía ninguna. */
  @IsInt()
  @Min(0)
  baseRevision: number;

  @IsNotEmpty()
  payload: unknown;
}

/**
 * El espacio de trabajo de quien pregunta, en la empresa en la que está.
 *
 * ## Por qué no lleva permiso
 *
 * Son las pestañas que TÚ tienes abiertas. No hay nadie más a quien se le puedan leer ni
 * escribir: el usuario sale del principal y la empresa del contexto de la petición, así que la
 * ruta no admite un identificador ajeno ni siquiera escribiéndolo a mano. Declarar un permiso
 * aquí sería pedir autorización para verse a uno mismo.
 *
 * ## Por qué está bajo `users` y no en un módulo propio
 *
 * El espacio de trabajo es un atributo de la persona, y `users` es su dueño. Un módulo nuevo
 * habría que declararlo en el mapa de fronteras y no aporta un límite que no exista ya.
 */
@ApiTags('Workspace')
@Controller('me/workspace')
export class UserWorkspaceController {
  constructor(private readonly workspace: UserWorkspaceService) {}

  @Get()
  @AuthenticatedOnly(
    'Son las pestañas de quien pregunta, en su empresa activa. No hay otro sujeto posible: el ' +
      'usuario sale del principal y la empresa del contexto de la petición.',
  )
  @ApiOperation({ summary: 'El espacio de trabajo guardado, o null si no hay ninguno' })
  async read(@CurrentUser() user: AuthenticatedUser) {
    return (await this.workspace.read(user.id, user.organizationId)) ?? null;
  }

  @Put()
  @AuthenticatedOnly('Igual que la lectura: solo se puede escribir el propio.')
  @ApiOperation({
    summary: 'Guarda el espacio de trabajo',
    description:
      'Devuelve `{ conflict: true, current }` con 200 —y no 409— cuando otro equipo escribió ' +
      'entremedias: el cliente tiene que unir los dos conjuntos, y un código de error haría que ' +
      'sus interceptores lo trataran como un fallo que hay que mostrar. No lo es: es información.',
  })
  async save(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveWorkspaceDto) {
    return this.workspace.write(user.id, user.organizationId, dto);
  }

  @Delete()
  @HttpCode(204)
  @AuthenticatedOnly('Igual que la lectura: solo se puede olvidar el propio.')
  @ApiOperation({ summary: 'Olvida el espacio de trabajo guardado' })
  async forget(@CurrentUser() user: AuthenticatedUser) {
    await this.workspace.forget(user.id, user.organizationId);
  }
}
