import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { TreasuryService } from './treasury.service';
import { CreateBankTransferDto } from './dto/create-bank-transfer.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('treasury')
@UseGuards(JwtAuthGuard)
export class TreasuryController {
  constructor(private readonly treasuryService: TreasuryService) {}

  @HasPermission(PERMISSIONS.TREASURY_TRANSFER)
  @Post('bank-transfers')
  create(@Body() dto: CreateBankTransferDto, @CurrentUser() user: AuthenticatedUser) {
    return this.treasuryService.createBankTransfer(dto, user.organizationId);
  }
}