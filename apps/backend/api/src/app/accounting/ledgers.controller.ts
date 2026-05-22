
import { Controller, Get, Post, Body, Patch, Param, UseGuards, ParseUUIDPipe, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { LedgersService } from './ledgers.service';
import { Ledger } from './entities/ledger.entity';

@Controller('accounting/ledgers')
@UseGuards(JwtAuthGuard)
export class LedgersController {
  constructor(private readonly ledgersService: LedgersService) {}

  @Get('general-ledger')
  getGeneralLedger(
    @Query('accountId') accountId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @CurrentUser() user: User,
  ) {
    return this.ledgersService.getGeneralLedger(
      user.organizationId,
      accountId,
      startDate,
      endDate,
    );
  }

  @Post()
  create(@Body() createDto: Partial<Ledger>, @CurrentUser() user: User) {
    return this.ledgersService.create(createDto, user.organizationId);
  }

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.ledgersService.findAll(user.organizationId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.ledgersService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: Partial<Ledger>,
    @CurrentUser() user: User,
  ) {
    return this.ledgersService.update(id, updateDto, user.organizationId);
  }
}