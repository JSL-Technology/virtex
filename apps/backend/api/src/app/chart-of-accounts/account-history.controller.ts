
import { Controller, Get, Param } from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('chart-of-accounts/:accountId/history')
export class AccountHistoryController {
  constructor(private readonly chartOfAccountsService: ChartOfAccountsService) {}

  @HasPermission(PERMISSIONS.CHART_OF_ACCOUNTS_VIEW)
  @Get()
  findAccountHistory(
    @Param('accountId', UuidParamPipe) accountId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chartOfAccountsService.getAccountHistory(accountId, user.organizationId);
  }
}