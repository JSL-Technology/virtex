import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedOnly } from '../security/decorators/authenticated-only.decorator';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { ModuleInboxService } from './module-inbox.service';

@ApiTags('My Work')
@Controller('me/inbox')
export class ModuleInboxController {
  constructor(private readonly inbox: ModuleInboxService) {}

  @Get()
  @AuthenticatedOnly(
    'Devuelve lo que está pendiente en la empresa activa de quien pregunta, módulo a módulo. No ' +
      'expone ningún documento: solo su identificador, su ruta y desde cuándo espera, y cada ' +
      'pantalla que se abra desde aquí vuelve a pasar por el permiso que le toque. Exigir un ' +
      'permiso para ver la bandeja dejaría a media plantilla sin saber qué tiene que hacer hoy ' +
      'mientras sigue pudiendo abrir cada una de esas páginas por su cuenta.',
  )
  @ApiOperation({ summary: 'Trabajo pendiente por módulo, ordenado por lo que lleva más esperando' })
  async forMe(@CurrentUser() user: AuthenticatedUser) {
    return this.inbox.forTenant(user.organizationId, user.id);
  }
}
