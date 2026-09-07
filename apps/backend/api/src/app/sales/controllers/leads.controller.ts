
import { Controller, Post, Body, UseGuards, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { User } from '../../users/entities/user.entity/user.entity';
import { LeadsService } from '../services/leads.service';
import { CreateLeadDto } from '../dto/create-lead.dto';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../../shared/permissions';
import { Idempotent } from '../../shared/idempotency/idempotent.decorator';

@Controller('sales/leads')
@UseGuards(JwtAuthGuard)
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  @HasPermission(PERMISSIONS.CRM_MANAGE)
  create(@Body() createDto: CreateLeadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leadsService.create(createDto, user.organizationId, user.id);
  }

  @Get()
  @HasPermission(PERMISSIONS.CRM_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.leadsService.findAll(user.organizationId);
  }
  
  @Post(':id/convert')
  @Idempotent()
  @HasPermission(PERMISSIONS.CRM_MANAGE)
  convertLead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.leadsService.convertLeadToOpportunity(id, user.organizationId);
  }
}