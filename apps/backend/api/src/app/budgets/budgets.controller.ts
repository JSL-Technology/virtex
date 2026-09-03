import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('budgets')
@UseGuards(JwtAuthGuard)
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @HasPermission(PERMISSIONS.BUDGETS_MANAGE)
  @Post()
  create(@Body() createBudgetDto: CreateBudgetDto, @CurrentUser() user: AuthenticatedUser) {

    return this.budgetsService.create(createBudgetDto, user.organizationId);
  }

  @HasPermission(PERMISSIONS.BUDGETS_VIEW)
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {

    return this.budgetsService.findAll(user.organizationId);
  }

  @HasPermission(PERMISSIONS.BUDGETS_VIEW)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {

    return this.budgetsService.findOne(id, user.organizationId);
  }

  @HasPermission(PERMISSIONS.BUDGETS_MANAGE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateBudgetDto: UpdateBudgetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {

    return this.budgetsService.update(id, updateBudgetDto, user.organizationId);
  }

  @HasPermission(PERMISSIONS.BUDGETS_MANAGE)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {

    return this.budgetsService.remove(id, user.organizationId);
  }
}