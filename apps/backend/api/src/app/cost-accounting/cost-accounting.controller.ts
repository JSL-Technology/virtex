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
  UseGuards,
} from '@nestjs/common';
import { CostAccountingService } from './cost-accounting.service';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { CreateCostCenterDto } from './dto/create-cost-center.dto';
import { UpdateCostCenterDto } from './dto/update-cost-center.dto';

@Controller('cost-centers')
@UseGuards(JwtAuthGuard)
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
    @Param('id', ParseUUIDPipe) id: string,
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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCostCenterDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.costAccountingService.update(id, dto, user.organizationId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.COST_ACCOUNTING_MANAGE)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.costAccountingService.remove(id, user.organizationId);
  }
}
