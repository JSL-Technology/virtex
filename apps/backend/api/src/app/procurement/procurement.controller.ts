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
