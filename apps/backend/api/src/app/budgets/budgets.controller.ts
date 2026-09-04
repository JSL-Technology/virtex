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
  Query,
} from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import { BudgetVsActualQueryDto } from './dto/budget-vs-actual.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
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

  /**
   * Budget against actuals.
   *
   * `BudgetsService.getBudgetVsActualReport` existed and no route reached it: the controller
   * offered create, list, read, update and delete, and no comparison. A budget nobody can compare
   * against reality is a list of numbers.
   */
  @HasPermission(PERMISSIONS.BUDGETS_VIEW)
  @Get(':id/vs-actual')
  budgetVsActual(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: BudgetVsActualQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.budgetsService.getBudgetVsActualReport(id, user.organizationId, query);
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