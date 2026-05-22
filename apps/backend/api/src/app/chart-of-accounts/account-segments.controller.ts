
import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AccountSegmentsService } from './account-segments.service';
import { ConfigureAccountSegmentsDto } from './dto/account-segment-definition.dto';

@Controller('chart-of-accounts/segment-definitions')
@UseGuards(JwtAuthGuard)
export class AccountSegmentsController {
  constructor(private readonly segmentsService: AccountSegmentsService) {}

  @Get()
  getDefinitions(@CurrentUser() user: User) {
    return this.segmentsService.findByOrg(user.organizationId);
  }

  @Post()
  configureSegments(@Body() dto: ConfigureAccountSegmentsDto, @CurrentUser() user: User) {
    return this.segmentsService.configure(dto, user.organizationId);
  }

  @Post('initialize')
  initialize(@CurrentUser() user: User) {
    return this.segmentsService.initializeDefault(user.organizationId);
  }
}