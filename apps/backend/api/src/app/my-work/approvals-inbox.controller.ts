import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';
import { AuthenticatedOnly } from '../security/decorators/authenticated-only.decorator';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { ApprovalsInboxService } from './approvals-inbox.service';
import { ApproveDecisionDto, DecisionParamsDto, RejectDecisionDto } from './dto/approvals-inbox.dto';

@Controller('approvals/inbox')
export class ApprovalsInboxController {
  constructor(private readonly inbox: ApprovalsInboxService) {}

  @Get()
  @AuthenticatedOnly(
    'Agrega solo las fuentes cuyo permiso de decisión tiene el usuario (workflows:decide, procurement:approve…); el filtro está en ApprovalsInboxService porque cada fuente exige el suyo.',
  )
  pending(@CurrentUser() user: AuthenticatedUser) {
    return this.inbox.pending(user);
  }

  @Post(':source/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @AuthenticatedOnly(
    'Decidir exige el permiso de la fuente del documento, comprobado en ApprovalsInboxService; la fuente aplica además sus propias reglas (segregación de funciones, rol del paso, estado).',
  )
  async approve(@Param() params: DecisionParamsDto, @Body() dto: ApproveDecisionDto, @CurrentUser() user: AuthenticatedUser) {
    await this.inbox.approve(user, params.source, params.id, dto.comment);
    return { ok: true };
  }

  @Post(':source/:id/reject')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @AuthenticatedOnly(
    'Rechazar exige el permiso de la fuente del documento, comprobado en ApprovalsInboxService; la fuente exige el motivo y aplica sus propias reglas sobre quién puede decidir.',
  )
  async reject(@Param() params: DecisionParamsDto, @Body() dto: RejectDecisionDto, @CurrentUser() user: AuthenticatedUser) {
    await this.inbox.reject(user, params.source, params.id, dto.reason);
    return { ok: true };
  }
}
