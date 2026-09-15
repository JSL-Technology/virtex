
import { Controller, Get, Post, Body } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AccountSegmentsService } from './account-segments.service';
import { ConfigureAccountSegmentsDto } from './dto/account-segment-definition.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('chart-of-accounts/segment-definitions')
export class AccountSegmentsController {
  constructor(private readonly segmentsService: AccountSegmentsService) {}

  @HasPermission(PERMISSIONS.CHART_OF_ACCOUNTS_VIEW)
  @Get()
  getDefinitions(@CurrentUser() user: AuthenticatedUser) {
    return this.segmentsService.findByOrg(user.organizationId);
  }

  @HasPermission(PERMISSIONS.CHART_OF_ACCOUNTS_EDIT)
  @Post()
  configureSegments(@Body() dto: ConfigureAccountSegmentsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.segmentsService.configure(dto, user.organizationId);
  }

  @HasPermission(PERMISSIONS.CHART_OF_ACCOUNTS_EDIT)
  @Post('initialize')
  initialize(@CurrentUser() user: AuthenticatedUser) {
    return this.segmentsService.initializeDefault(user.organizationId);
  }
}