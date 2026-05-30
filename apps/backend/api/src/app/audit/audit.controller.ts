import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions/permissions.guard';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuditTrailService } from './audit.service';
import { User } from '../users/entities/user.entity/user.entity';

@Controller('audit')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly auditTrailService: AuditTrailService) {}

  @Get()
  @HasPermission(PERMISSIONS.AUDIT_VIEW_TRAIL)
  findAll(
    @CurrentUser() user: User,
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 50,
  ) {
    return this.auditTrailService.find(user.organizationId, entity, entityId, +page, +pageSize);
  }
}
