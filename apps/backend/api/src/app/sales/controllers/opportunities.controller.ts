
import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { User } from '../../users/entities/user.entity/user.entity';
import { OpportunitiesService } from '../services/opportunities.service';
import { AuthenticatedUser } from '../../security/principal';
import { HasPermission } from '../../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../../shared/permissions';

@Controller('sales/opportunities')
export class OpportunitiesController {
  constructor(private readonly opportunitiesService: OpportunitiesService) {}

  @Get()
  @HasPermission(PERMISSIONS.CRM_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.opportunitiesService.findAll(user.organizationId);
  }
}