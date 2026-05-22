
import { Controller, Post, Body, UseGuards, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { LeadsService } from '../services/leads.service';
import { CreateLeadDto } from '../dto/create-lead.dto';

@Controller('sales/leads')
@UseGuards(JwtAuthGuard)
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  create(@Body() createDto: CreateLeadDto, @CurrentUser() user: User) {
    return this.leadsService.create(createDto, user.organizationId, user.id);
  }

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.leadsService.findAll(user.organizationId);
  }
  
  @Post(':id/convert')
  convertLead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.leadsService.convertLeadToOpportunity(id, user.organizationId);
  }
}