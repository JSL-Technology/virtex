import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedOnly } from '../security/decorators/authenticated-only.decorator';
import { AuthenticatedUser } from '../security/principal';
import { OverviewService } from './overview.service';
import { ActivityQueryDto, EventsQueryDto } from './dto/overview.dto';

/**
 * The workspace's home page.
 *
 * There was no controller: the page's three sections were invented in the browser. See
 * {@link OverviewService} for what each one is now taken from.
 *
 * No `@HasPermission` here on purpose — every route is scoped to the caller's own tenant and each
 * one filters its contents by what that seat may read, document type by document type. A blanket
 * permission would either lock out the home page or hand a salesperson the ledger.
 */
@ApiTags('Overview')
@ApiBearerAuth()
@Controller('overview')
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get('activity')
  @AuthenticatedOnly(
    'La página de inicio del workspace. Cada fila ya se filtra por el permiso del documento que ' +
      'describe, así que un permiso global aquí solo podría cerrar la página o abrir el mayor.',
  )
  @ApiOperation({ summary: 'Actividad reciente del inquilino, filtrada por lo que el usuario puede ver.' })
  activity(@CurrentUser() user: AuthenticatedUser, @Query() query: ActivityQueryDto) {
    return this.overview.activity(user.organizationId, user.permissions ?? [], query.limit ?? 10);
  }

  @Get('events')
  @AuthenticatedOnly(
    'Vencimientos del propio inquilino, filtrados por módulo según lo que el usuario puede leer.',
  )
  @ApiOperation({ summary: 'Vencimientos y cierres próximos, tomados de los propios documentos.' })
  events(@CurrentUser() user: AuthenticatedUser, @Query() query: EventsQueryDto) {
    return this.overview.events(
      user.organizationId,
      user.permissions ?? [],
      query.days ?? 30,
      query.limit ?? 10,
    );
  }

  @Get('news')
  @AuthenticatedOnly(
    'Novedades del producto: el mismo contenido público para todos los usuarios autenticados.',
  )
  @ApiOperation({ summary: 'Novedades del producto, desde el feed configurado. Vacío si no hay ninguno.' })
  news() {
    return this.overview.news();
  }
}
