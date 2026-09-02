

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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AccountsPayableService } from './accounts-payable.service';
import { CreateVendorBillDto } from './dto/create-vendor-bill.dto';
import { UpdateVendorBillDto } from './dto/update-vendor-bill.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('accounts-payable')
@UseGuards(JwtAuthGuard)
export class AccountsPayableController {
  constructor(
    private readonly accountsPayableService: AccountsPayableService,
  ) {}

  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_CREATE)
  @Post()
  create(
    @Body() createVendorBillDto: CreateVendorBillDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountsPayableService.create(
      createVendorBillDto,
      user.organizationId,
    );
  }

  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VIEW)
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.accountsPayableService.findAll(user.organizationId);
  }

  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VIEW)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.accountsPayableService.findOne(id, user.organizationId);
  }

  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_EDIT)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateVendorBillDto: UpdateVendorBillDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountsPayableService.update(
      id,
      updateVendorBillDto,
      user.organizationId,
    );
  }

  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VOID)
  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  voidBill(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountsPayableService.voidBill(
      id,
      user.organizationId,
      reason,
    );
  }

  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VOID)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {

    return this.accountsPayableService.remove(id, user.organizationId);
  }

  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_APPROVE)
  @Post(':id/submit-for-approval')
  @HttpCode(HttpStatus.OK)
  submitForApproval(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountsPayableService.submitForApproval(
      id,
      user.organizationId,
    );
  }
}
