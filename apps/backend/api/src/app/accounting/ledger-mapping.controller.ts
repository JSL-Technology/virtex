
import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { LedgerMappingService } from './ledger-mapping.service';
import { CreateOrUpdateLedgerMapDto } from './dto/ledger-mapping.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('accounting/ledger-mappings')
export class LedgerMappingController {
  constructor(private readonly mappingService: LedgerMappingService) {}

  @HasPermission(PERMISSIONS.ACCOUNTING_MANAGE_LEDGERS)
  @Get(':sourceLedgerId/:targetLedgerId')
  getMap(
    @Param('sourceLedgerId', UuidParamPipe) sourceLedgerId: string,
    @Param('targetLedgerId', UuidParamPipe) targetLedgerId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.mappingService.getMapForLedgerPair(
      sourceLedgerId,
      targetLedgerId,
      user.organizationId,
    );
  }

  @HasPermission(PERMISSIONS.ACCOUNTING_MANAGE_LEDGERS)
  @Post()
  createOrUpdateMap(
    @Body() dto: CreateOrUpdateLedgerMapDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.mappingService.createOrUpdateMap(dto, user.organizationId);
  }
}