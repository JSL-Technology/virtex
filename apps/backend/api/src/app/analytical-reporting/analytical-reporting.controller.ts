
import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { AnalyticalReportingService } from './analytical-reporting.service';
import { AnalyticalQueryDto, PaginationOptionsDto } from './dto/analytical-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('analytical-reporting')
@UseGuards(JwtAuthGuard)
export class AnalyticalReportingController {
  constructor(private readonly reportingService: AnalyticalReportingService) {}

  @Post('query')
  @HttpCode(HttpStatus.OK)
  query(
    @Body() queryDto: AnalyticalQueryDto,
    @Query() paginationDto: PaginationOptionsDto,
    @CurrentUser() user: User
  ) {

    return this.reportingService.query(user.organizationId, queryDto, paginationDto);
  }

  @Post('refresh-view')
  @HttpCode(HttpStatus.ACCEPTED)
  refreshView() {

    this.reportingService.refreshMaterializedView();
    return { message: 'El refresco de la vista materializada ha sido iniciado.' };
  }


  @Post('synchronize-view')
  @HttpCode(HttpStatus.ACCEPTED)
  @HasPermission(PERMISSIONS.SYSTEM_MANAGE_VIEWS)
  synchronizeView(@CurrentUser() user: User) {
    this.reportingService.synchronizeView(user.organizationId);
    return { message: 'La sincronización de la vista analítica ha sido iniciada.' };
  }

}