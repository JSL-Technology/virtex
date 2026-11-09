import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';
import { PurchaseAgreementsService } from './purchase-agreements.service';
import { CreateAgreementDto, ReleaseAgreementDto } from './dto/purchase-agreement.dto';
import { RejectDto } from './dto/purchase-order.dto';

/** Purchase agreements — blanket orders (audit 2026-11-07, CMP-15). */
@ApiTags('Procurement')
@ApiBearerAuth()
@Controller('procurement/agreements')
export class PurchaseAgreementsController {
  constructor(private readonly agreements: PurchaseAgreementsService) {}

  @Get()
  @HasPermission(PERMISSIONS.PROCUREMENT_VIEW)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.agreements.list(user.organizationId);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.PROCUREMENT_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.agreements.findOne(id, user.organizationId);
  }

  @Post()
  @Idempotent()
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  create(@Body() dto: CreateAgreementDto, @CurrentUser() user: AuthenticatedUser) {
    return this.agreements.create(dto, user.organizationId, user.id);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.PROCUREMENT_APPROVE)
  @ApiOperation({ summary: 'Pone en vigor el acuerdo (no lo puede hacer quien lo redactó).' })
  activate(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.agreements.activate(id, user.organizationId, user.id);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.PROCUREMENT_APPROVE)
  close(@Param('id', UuidParamPipe) id: string, @Body() dto: RejectDto, @CurrentUser() user: AuthenticatedUser) {
    return this.agreements.close(id, user.organizationId, dto.reason);
  }

  @Post(':id/release')
  @Idempotent()
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  @ApiOperation({ summary: 'Emite una orden de compra contra el acuerdo, a sus precios.' })
  release(@Param('id', UuidParamPipe) id: string, @Body() dto: ReleaseAgreementDto, @CurrentUser() user: AuthenticatedUser) {
    return this.agreements.release(id, dto, user.organizationId, user.id);
  }
}
