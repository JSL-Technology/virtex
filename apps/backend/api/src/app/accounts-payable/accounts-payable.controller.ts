

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

@Controller('accounts-payable')
@UseGuards(JwtAuthGuard)
export class AccountsPayableController {
  constructor(
    private readonly accountsPayableService: AccountsPayableService,
  ) {}

  @Post()
  create(
    @Body() createVendorBillDto: CreateVendorBillDto,
    @CurrentUser() user: User,
  ) {
    return this.accountsPayableService.create(
      createVendorBillDto,
      user.organizationId,
    );
  }

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.accountsPayableService.findAll(user.organizationId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.accountsPayableService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateVendorBillDto: UpdateVendorBillDto,
    @CurrentUser() user: User,
  ) {
    return this.accountsPayableService.update(
      id,
      updateVendorBillDto,
      user.organizationId,
    );
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  voidBill(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: User,
  ) {
    return this.accountsPayableService.voidBill(
      id,
      user.organizationId,
      reason,
    );
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {

    return this.accountsPayableService.remove(id, user.organizationId);
  }

  @Post(':id/submit-for-approval')
  @HttpCode(HttpStatus.OK)
  submitForApproval(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.accountsPayableService.submitForApproval(
      id,
      user.organizationId,
    );
  }
}
