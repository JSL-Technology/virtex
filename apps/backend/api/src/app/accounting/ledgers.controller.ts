
import { Controller, Get, Post, Body, Patch, Param, UseGuards, ParseUUIDPipe, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { LedgersService } from './ledgers.service';
import { Ledger } from './entities/ledger.entity';
import { CreateLedgerDto, UpdateLedgerDto } from './dto/ledger.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { GeneralLedgerQueryDto } from './dto/general-ledger-query.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Accounting — Ledgers')
@ApiBearerAuth()
@Controller('accounting/ledgers')
@UseGuards(JwtAuthGuard)
export class LedgersController {
  constructor(private readonly ledgersService: LedgersService) {}

  /**
   * The libro mayor for one account.
   *
   * The parameters go through a DTO now. As four bare `@Query()` strings they bypassed the global
   * `ValidationPipe` entirely, so `?startDate=abc` reached `new Date()`, produced an Invalid Date,
   * and answered 500 from `toISOString()`.
   */
  @HasPermission(PERMISSIONS.ACCOUNTING_VIEW)
  @Get('general-ledger')
  @ApiOperation({ summary: 'Libro mayor de una cuenta, con saldo inicial, movimientos y saldo.' })
  getGeneralLedger(
    @Query() query: GeneralLedgerQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ledgersService.getGeneralLedger(user.organizationId, query);
  }

  @HasPermission(PERMISSIONS.ACCOUNTING_MANAGE_LEDGERS)
  @Post()
  create(@Body() createDto: CreateLedgerDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ledgersService.create(createDto, user.organizationId);
  }

  @HasPermission(PERMISSIONS.ACCOUNTING_VIEW)
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.ledgersService.findAll(user.organizationId);
  }

  @HasPermission(PERMISSIONS.ACCOUNTING_VIEW)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ledgersService.findOne(id, user.organizationId);
  }

  @HasPermission(PERMISSIONS.ACCOUNTING_MANAGE_LEDGERS)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateLedgerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ledgersService.update(id, updateDto, user.organizationId);
  }
}