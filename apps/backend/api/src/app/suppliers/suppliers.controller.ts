import { SupplierBankAccountsService } from './supplier-bank-accounts.service';
import { CreateSupplierBankAccountDto, UpdateSupplierBankAccountDto } from './dto/supplier-bank-account.dto';
import { RequireStepUp, StepUpScope } from '../auth/contracts/step-up.contract';
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { clampLimit } from '../common/database/search-term';

@Controller('suppliers')
export class SuppliersController {
  constructor(
    private readonly suppliersService: SuppliersService,
    private readonly bankAccounts: SupplierBankAccountsService,
  ) {}

  @Post()
  @HasPermission(PERMISSIONS.SUPPLIERS_CREATE)
  create(@Body() createSupplierDto: CreateSupplierDto, @CurrentUser() user: AuthenticatedUser) {
    return this.suppliersService.create(createSupplierDto, user.organizationId);
  }

  /** Los proveedores, acotados por `search` y limitados por `limit`. Ambos opcionales. */
  @Get()
  @HasPermission(PERMISSIONS.SUPPLIERS_VIEW)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.suppliersService.findAll(user.organizationId, {
      search,
      limit: clampLimit(limit),
    });
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.SUPPLIERS_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.suppliersService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.SUPPLIERS_EDIT)
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body() updateSupplierDto: UpdateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.update(id, updateSupplierDto, user.organizationId);
  }

  @Get(':id/dependents')
  @HasPermission(PERMISSIONS.SUPPLIERS_VIEW)
  dependents(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.suppliersService.dependents(id, user.organizationId);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.SUPPLIERS_DELETE)
  remove(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.suppliersService.remove(id, user.organizationId);
  }

  // ── Bank accounts (audit 2026-11-07, CMP-17) ────────────────────────────────
  // Changing where a supplier is paid re-authenticates: redirecting a supplier's payments is the
  // classic payment fraud, and the same scope guards moving funds.

  @Get(':id/bank-accounts')
  @HasPermission(PERMISSIONS.SUPPLIERS_VIEW)
  listBankAccounts(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.bankAccounts.list(id, user.organizationId);
  }

  @Post(':id/bank-accounts')
  @HasPermission(PERMISSIONS.SUPPLIERS_EDIT)
  @RequireStepUp(StepUpScope.MOVE_FUNDS)
  createBankAccount(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: CreateSupplierBankAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankAccounts.create(id, dto, user.organizationId);
  }

  @Patch(':id/bank-accounts/:accountId')
  @HasPermission(PERMISSIONS.SUPPLIERS_EDIT)
  @RequireStepUp(StepUpScope.MOVE_FUNDS)
  updateBankAccount(
    @Param('id', UuidParamPipe) id: string,
    @Param('accountId', UuidParamPipe) accountId: string,
    @Body() dto: UpdateSupplierBankAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankAccounts.update(id, accountId, dto, user.organizationId);
  }

  @Delete(':id/bank-accounts/:accountId')
  @HasPermission(PERMISSIONS.SUPPLIERS_EDIT)
  @RequireStepUp(StepUpScope.MOVE_FUNDS)
  removeBankAccount(
    @Param('id', UuidParamPipe) id: string,
    @Param('accountId', UuidParamPipe) accountId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankAccounts.remove(id, accountId, user.organizationId);
  }
}