import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CostAccountingService } from './cost-accounting.service';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { CreateCostCenterDto } from './dto/create-cost-center.dto';
import { UpdateCostCenterDto } from './dto/update-cost-center.dto';

@Controller('cost-centers')
export class CostAccountingController {
  constructor(private readonly costAccountingService: CostAccountingService) {}

  @Get()
  @HasPermission(PERMISSIONS.COST_ACCOUNTING_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.costAccountingService.findAll(user.organizationId);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.COST_ACCOUNTING_VIEW)
  findOne(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.costAccountingService.findOne(id, user.organizationId);
  }

  @Post()
  @HasPermission(PERMISSIONS.COST_ACCOUNTING_MANAGE)
  create(@Body() dto: CreateCostCenterDto, @CurrentUser() user: AuthenticatedUser) {
    return this.costAccountingService.create(dto, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.COST_ACCOUNTING_MANAGE)
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpdateCostCenterDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.costAccountingService.update(id, dto, user.organizationId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.COST_ACCOUNTING_MANAGE)
  remove(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.costAccountingService.remove(id, user.organizationId);
  }
}
