import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';
import { RfqsService } from './rfqs.service';
import { AwardQuoteDto, CreateRfqDto, RecordQuoteDto } from './dto/rfq.dto';
import { RejectDto } from './dto/purchase-order.dto';
import { RfqStatus } from './entities/purchase-rfq.entity';

export class RfqQueryDto {
  @IsOptional()
  @IsIn(Object.values(RfqStatus))
  status?: RfqStatus;
}

/** Requests for quotation and supplier quotations (audit 2026-11-07, CMP-15). */
@ApiTags('Procurement')
@ApiBearerAuth()
@Controller('procurement/rfqs')
export class RfqsController {
  constructor(private readonly rfqs: RfqsService) {}

  @Get()
  @HasPermission(PERMISSIONS.PROCUREMENT_VIEW)
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: RfqQueryDto) {
    return this.rfqs.list(user.organizationId, query.status);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.PROCUREMENT_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.rfqs.findOne(id, user.organizationId);
  }

  @Get(':id/comparison')
  @HasPermission(PERMISSIONS.PROCUREMENT_VIEW)
  @ApiOperation({ summary: 'Compara las cotizaciones recibidas.' })
  comparison(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.rfqs.comparison(id, user.organizationId);
  }

  @Post()
  @Idempotent()
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  create(@Body() dto: CreateRfqDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rfqs.create(dto, user.organizationId, user.id);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  send(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.rfqs.send(id, user.organizationId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  cancel(@Param('id', UuidParamPipe) id: string, @Body() dto: RejectDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rfqs.cancel(id, user.organizationId, dto.reason);
  }

  @Post(':id/quotes')
  @Idempotent()
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  @ApiOperation({ summary: 'Registra la cotización de un proveedor invitado.' })
  recordQuote(@Param('id', UuidParamPipe) id: string, @Body() dto: RecordQuoteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rfqs.recordQuote(id, dto, user.organizationId);
  }

  /** Awarding commits the spend's supplier and price: the approver's permission. */
  @Post(':id/award')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.PROCUREMENT_APPROVE)
  @ApiOperation({ summary: 'Adjudica una cotización: crea la orden de compra en borrador a sus precios.' })
  award(@Param('id', UuidParamPipe) id: string, @Body() dto: AwardQuoteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rfqs.award(id, dto, user.organizationId, user.id);
  }
}
