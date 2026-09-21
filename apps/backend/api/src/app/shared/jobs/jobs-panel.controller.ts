import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedOnly } from '../../security/decorators/authenticated-only.decorator';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../security/principal';
import { JobsPanelService } from './jobs-panel.service';

@ApiTags('Jobs')
@Controller('me/jobs')
export class JobsPanelController {
  constructor(private readonly jobs: JobsPanelService) {}

  @Get()
  @AuthenticatedOnly(
    'Devuelve los trabajos en cola de la empresa activa: su nombre, su estado y, si falló, por ' +
      'qué. No expone la carga del trabajo ni ningún dato de negocio, y el filtro por empresa es ' +
      'la única llave que hay. Exigir un permiso para verlos dejaría a quien lanzó una fusión de ' +
      'cuentas sin saber si terminó, que es justo el agujero que este panel viene a cerrar.',
  )
  @ApiOperation({ summary: 'Trabajos en cola de la empresa activa, los más recientes primero' })
  async forMe(@CurrentUser() user: AuthenticatedUser) {
    return this.jobs.forTenant(user.organizationId);
  }
}
