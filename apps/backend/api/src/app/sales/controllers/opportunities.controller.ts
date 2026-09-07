
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { User } from '../../users/entities/user.entity/user.entity';
import { OpportunitiesService } from '../services/opportunities.service';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../../shared/permissions';

@Controller('sales/opportunities')
@UseGuards(JwtAuthGuard)
export class OpportunitiesController {
  constructor(private readonly opportunitiesService: OpportunitiesService) {}

  @Get()
  @HasPermission(PERMISSIONS.CRM_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.opportunitiesService.findAll(user.organizationId);
  }
}