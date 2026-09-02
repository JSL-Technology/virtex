import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { TreasuryService } from './treasury.service';
import { CreateBankTransferDto } from './dto/create-bank-transfer.dto';
import { CreateBankAccountDto, UpdateBankAccountDto } from './dto/bank-account.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { PeriodLockGuard } from '../accounting/guards/period-lock.guard';

/**
 * The treasury surface.
 *
 * There was one route here — `POST /treasury/bank-transfers` — and it carried no permission at all,
 * so any authenticated member of the tenant could move money between ledger accounts and generate
 * the entry for it. Bank accounts had nowhere to be created and the cash position did not exist.
 */
@ApiTags('Treasury')
@ApiBearerAuth()
@Controller('treasury')
@UseGuards(JwtAuthGuard)
export class TreasuryController {
  constructor(private readonly treasuryService: TreasuryService) {}

  // ── Bank accounts ──────────────────────────────────────────────────────────

  @Post('bank-accounts')
  @HasPermission(PERMISSIONS.TREASURY_MANAGE_ACCOUNTS)
  @ApiOperation({ summary: 'Registra una cuenta bancaria de la organización.' })
  createBankAccount(
    @Body() dto: CreateBankAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.treasuryService.createBankAccount(dto, user.organizationId);
  }

  @Get('bank-accounts')
  @HasPermission(PERMISSIONS.TREASURY_VIEW)
  @ApiOperation({ summary: 'Lista las cuentas bancarias de la organización.' })
  findAllBankAccounts(@CurrentUser() user: AuthenticatedUser) {
    return this.treasuryService.findAllBankAccounts(user.organizationId);
  }

  @Get('bank-accounts/:id')
  @HasPermission(PERMISSIONS.TREASURY_VIEW)
  findBankAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.treasuryService.findBankAccount(id, user.organizationId);
  }

  @Patch('bank-accounts/:id')
  @HasPermission(PERMISSIONS.TREASURY_MANAGE_ACCOUNTS)
  @ApiOperation({
    summary:
      'Actualiza una cuenta bancaria. La moneda y la cuenta contable no son modificables.',
  })
  updateBankAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBankAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.treasuryService.updateBankAccount(id, dto, user.organizationId);
  }

  // ── Cash position ──────────────────────────────────────────────────────────

  /**
   * How much the tenant has, by account, at a date.
   *
   * The product had no answer to this question: the balance sheet grouped every current asset
   * together, and nothing else read bank balances at all.
   */
  @Get('cash-position')
  @HasPermission(PERMISSIONS.TREASURY_VIEW)
  @ApiOperation({ summary: 'Posición de efectivo por cuenta bancaria a una fecha.' })
  @ApiQuery({ name: 'asOfDate', required: false, type: String })
  cashPosition(
    @CurrentUser() user: AuthenticatedUser,
    @Query('asOfDate') asOfDate?: string,
  ) {
    return this.treasuryService.cashPosition(user.organizationId, asOfDate ?? new Date());
  }

  // ── Transfers ──────────────────────────────────────────────────────────────

  @Post('bank-transfers')
  @UseGuards(PeriodLockGuard)
  @HttpCode(HttpStatus.CREATED)
  @HasPermission(PERMISSIONS.TREASURY_TRANSFER)
  @ApiOperation({
    summary:
      'Transfiere fondos entre dos cuentas propias, incluso en monedas distintas y con comisión.',
  })
  createTransfer(
    @Body() dto: CreateBankTransferDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.treasuryService.createBankTransfer(dto, user.organizationId, user.id);
  }

  @Get('bank-transfers')
  @HasPermission(PERMISSIONS.TREASURY_VIEW)
  @ApiOperation({ summary: 'Lista las transferencias entre cuentas propias.' })
  findAllTransfers(@CurrentUser() user: AuthenticatedUser) {
    return this.treasuryService.findAllTransfers(user.organizationId);
  }
}
