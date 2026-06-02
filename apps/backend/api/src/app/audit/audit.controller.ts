import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuditTrailService } from './audit.service';



@Controller('audit')
@UseGuards(JwtAuthGuard)

export class AuditController {
  constructor(private readonly auditTrailService: AuditTrailService) {}

  @Get()

  findAll(
    @CurrentUser() user: User,
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
  ) {
    return this.auditTrailService.find(entity, entityId, user.organizationId);
  }
}
