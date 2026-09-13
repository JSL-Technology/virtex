import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProcurementService } from './procurement.service';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { CreatePurchaseRequisitionDto } from './dto/create-purchase-requisition.dto';
import { UpdatePurchaseRequisitionDto } from './dto/update-purchase-requisition.dto';
import { RejectDto } from './dto/purchase-order.dto';

@Controller('procurement/requisitions')
@UseGuards(JwtAuthGuard)
export class ProcurementController {
  constructor(private readonly procurementService: ProcurementService) {}

  @Get()
  @HasPermission(PERMISSIONS.PROCUREMENT_VIEW)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.procurementService.findAll(user.organizationId, { page, pageSize });
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.PROCUREMENT_VIEW)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.procurementService.findOne(id, user.organizationId);
  }

  @Post()
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  create(
    @Body() dto: CreatePurchaseRequisitionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.procurementService.create(dto, user.organizationId, user.id);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseRequisitionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.procurementService.update(id, dto, user.organizationId);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.procurementService.submit(id, user.organizationId);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.PROCUREMENT_APPROVE)
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.procurementService.approve(id, user.organizationId, user.id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.PROCUREMENT_APPROVE)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.procurementService.reject(id, user.organizationId, user.id, dto.reason);
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  reopen(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.procurementService.reopen(id, user.organizationId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.procurementService.remove(id, user.organizationId);
  }
}
