
import { Controller, Post, Body, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { AnalyticalReportingService } from './analytical-reporting.service';
import { AnalyticalQueryDto, PaginationOptionsDto } from './dto/analytical-query.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../security/principal';

@Controller('analytical-reporting')
export class AnalyticalReportingController {
  constructor(private readonly reportingService: AnalyticalReportingService) {}

  @Post('query')
  @HasPermission(PERMISSIONS.ANALYTICS_QUERY)
  @HttpCode(HttpStatus.OK)
  query(
    @Body() queryDto: AnalyticalQueryDto,
    @Query() paginationDto: PaginationOptionsDto,
    @CurrentUser() user: AuthenticatedUser
  ) {

    return this.reportingService.query(user.organizationId, queryDto, paginationDto);
  }

  @Post('refresh-view')
  @HasPermission(PERMISSIONS.ANALYTICS_MANAGE_VIEWS)
  @HttpCode(HttpStatus.ACCEPTED)
  refreshView() {

    this.reportingService.refreshMaterializedView();
    return { messageKey: 'analytical_reporting.materialized_view_refresh_has_started' };
  }

  @Post('synchronize-view')
  @HttpCode(HttpStatus.ACCEPTED)
  @HasPermission(PERMISSIONS.SYSTEM_MANAGE_VIEWS)
  synchronizeView(@CurrentUser() user: AuthenticatedUser) {
    this.reportingService.synchronizeView(user.organizationId);
    return { messageKey: 'analytical_reporting.analytical_view_synchronization_has_started' };
  }

}