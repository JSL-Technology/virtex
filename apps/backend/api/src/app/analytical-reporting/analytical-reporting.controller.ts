
import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { AnalyticalReportingService } from './analytical-reporting.service';
import { AnalyticalQueryDto, PaginationOptionsDto } from './dto/analytical-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@Controller('analytical-reporting')
@UseGuards(JwtAuthGuard)
export class AnalyticalReportingController {
  constructor(private readonly reportingService: AnalyticalReportingService) {}

  @Post('query')
  @HttpCode(HttpStatus.OK)
  query(
    @Body() queryDto: AnalyticalQueryDto,
    @Query() paginationDto: PaginationOptionsDto,
    @CurrentUser() user: AuthenticatedUser
  ) {

    return this.reportingService.query(user.organizationId, queryDto, paginationDto);
  }

  @Post('refresh-view')
  @HttpCode(HttpStatus.ACCEPTED)
  refreshView() {

    this.reportingService.refreshMaterializedView();
    return { messageKey: 'ANALYTICAL_REPORTING.REFRESCO_VISTA_MATERIALIZADA_INICIADO' };
  }


  @Post('synchronize-view')
  @HttpCode(HttpStatus.ACCEPTED)
  @HasPermission(PERMISSIONS.SYSTEM_MANAGE_VIEWS)
  synchronizeView(@CurrentUser() user: AuthenticatedUser) {
    this.reportingService.synchronizeView(user.organizationId);
    return { messageKey: 'ANALYTICAL_REPORTING.SINCRONIZACION_VISTA_ANALITICA_INICIADA' };
  }

}