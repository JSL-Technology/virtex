
import { Controller, Post, Body, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { AnalyticalReportingService } from './analytical-reporting.service';
import { AnalyticalQueryDto, PaginationOptionsDto } from './dto/analytical-query.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { RequiresPlatformPermission } from '../security/decorators/platform-permission.decorator';
import { PLATFORM_PERMISSIONS } from '../security/platform-permissions';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../security/principal';
import { StepUpGuard } from '../auth/guards/step-up.guard';
import { StepUp } from '../auth/decorators/step-up.decorator';
import { StepUpScope } from '../auth/enums/step-up-scope.enum';

/**
 * El cubo analítico.
 *
 * ## Dos clases de ruta viven aquí, y necesitaban dos clases de permiso
 *
 * `query` actúa sobre los datos de UN inquilino y se filtra por él: un permiso de inquilino es el
 * guard correcto.
 *
 * `refresh-view` y `synchronize-view` actúan sobre `analytical_report_data`, que es **una sola
 * vista materializada para toda la instalación**. Estaban detrás de `analytics:manage_views` y
 * `system:manage_views` —permisos de inquilino que el `'*'` del rol ADMINISTRADOR de cualquier
 * cliente satisface—, de modo que un cliente podía:
 *
 *   - reconstruir la vista con SUS dimensiones y solo las suyas, dejando a los demás inquilinos
 *     con consultas que referencian columnas que ya no existen;
 *   - hacerla desaparecer durante el `DROP`/`CREATE`, para todo el mundo a la vez.
 *
 * Es exactamente la forma que `ExtensionsController` documenta y corrigió para el catálogo de
 * extensiones, encontrada una segunda vez en otro sitio. Ahora piden un permiso de PLATAFORMA, que
 * `RolesService` se niega a meter en un rol de inquilino y que el `'*'` deliberadamente no
 * satisface. La reconstrucción, además, es destructiva, así que lleva un token de step-up de un
 * solo uso.
 *
 * Cada ruta de plataforma sigue declarando también su permiso de inquilino: el `PermissionsGuard`
 * global deniega toda ruta que no declare ninguno, así que sin él quedarían inalcanzables en lugar
 * de protegidas, y `route-authorisation.spec.ts` fallaría.
 */
@Controller('analytical-reporting')
export class AnalyticalReportingController {
  constructor(private readonly reportingService: AnalyticalReportingService) {}

  @Post('query')
  @HasPermission(PERMISSIONS.ANALYTICS_QUERY)
  @HttpCode(HttpStatus.OK)
  query(
    @Body() queryDto: AnalyticalQueryDto,
    @Query() paginationDto: PaginationOptionsDto,
    @CurrentUser() user: AuthenticatedUser
  ) {

    return this.reportingService.query(user.organizationId, queryDto, paginationDto);
  }

  /**
   * Recalcula las filas de la vista. No cambia su forma, así que no lleva step-up — pero sigue
   * siendo una operación sobre un objeto compartido por todos los inquilinos.
   *
   * Se ESPERA la promesa. Antes no: el controlador llamaba y devolvía, y como el servicio relanza
   * tras el rollback, un fallo se convertía en un rechazo de promesa sin manejador — que en Node
   * ≥15 termina el proceso. Un nombre de dimensión inválido bastaba para tumbar la API.
   */
  @Post('refresh-view')
  @HasPermission(PERMISSIONS.ANALYTICS_MANAGE_VIEWS)
  @RequiresPlatformPermission(PLATFORM_PERMISSIONS.ANALYTICS_REFRESH_VIEW)
  @HttpCode(HttpStatus.OK)
  async refreshView() {
    return this.reportingService.refreshMaterializedView();
  }

  /**
   * Reconstruye la vista: la destruye y la vuelve a crear con las columnas de dimensión de TODA
   * la instalación (ver `synchronizeView`, que ya no se acota al inquilino que llama).
   */
  @Post('synchronize-view')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.SYSTEM_MANAGE_VIEWS)
  @RequiresPlatformPermission(PLATFORM_PERMISSIONS.ANALYTICS_REBUILD_VIEW)
  @UseGuards(StepUpGuard)
  @StepUp(StepUpScope.REBUILD_ANALYTICAL_VIEW)
  async synchronizeView() {
    return this.reportingService.synchronizeView();
  }

}
