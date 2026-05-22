
import { Controller, Post, Body, UseGuards, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { LedgerMappingService } from './ledger-mapping.service';
import { CreateOrUpdateLedgerMapDto } from './dto/ledger-mapping.dto';

@Controller('accounting/ledger-mappings')
@UseGuards(JwtAuthGuard)
export class LedgerMappingController {
  constructor(private readonly mappingService: LedgerMappingService) {}

  @Get(':sourceLedgerId/:targetLedgerId')
  getMap(
    @Param('sourceLedgerId', ParseUUIDPipe) sourceLedgerId: string,
    @Param('targetLedgerId', ParseUUIDPipe) targetLedgerId: string,
    @CurrentUser() user: User,
  ) {
    return this.mappingService.getMapForLedgerPair(
      sourceLedgerId,
      targetLedgerId,
      user.organizationId,
    );
  }

  @Post()
  createOrUpdateMap(
    @Body() dto: CreateOrUpdateLedgerMapDto,
    @CurrentUser() user: User,
  ) {
    return this.mappingService.createOrUpdateMap(dto, user.organizationId);
  }
}