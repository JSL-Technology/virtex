import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuditTrailService } from './audit.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AuditQueryDto } from './dto/audit-query.dto';

/**
 * The audit trail: who did what to which document.
 *
 * It carried `JwtAuthGuard` and nothing else, so any authenticated member of the tenant could read
 * every action every colleague had taken — which document a manager approved, which entry an
 * accountant reversed and why. The trail is the control that makes the other controls meaningful;
 * reading it is itself a privileged act, and `audit:view_trail` existed in the catalogue the whole
 * time with nothing declaring it.
 */
@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly auditTrailService: AuditTrailService) {}

  @Get()
  @HasPermission(PERMISSIONS.AUDIT_VIEW_TRAIL)
  @ApiOperation({ summary: 'Consulta la pista de auditoría del inquilino.' })
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: AuditQueryDto) {
    return this.auditTrailService.find(user.organizationId, query);
  }
}
