
import { Controller, Get, Body, Patch, UseGuards, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrganizationsService } from './organizations.service';
import { CheckPermissions } from '../auth/decorators/check-permissions.decorator';
import { IsOrganizationOwnerPolicy } from '../auth/policies/is-organization-owner.policy';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { CreateSubsidiaryDto } from './dto/create-subsidiary.dto';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly configService: ConfigService,
  ) {}

  @Get('profile')
  async getProfile(@CurrentUser() user: User) {
    return this.organizationsService.findOne(user.organizationId);
  }

  @Patch('profile')
  @CheckPermissions(IsOrganizationOwnerPolicy)
  async updateProfile(
    @CurrentUser() user: User,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(user.organizationId, updateOrganizationDto);
  }

  @Get('subsidiaries')
  async getSubsidiaries(@CurrentUser() user: User) {
    return this.organizationsService.getSubsidiaries(user.organizationId);
  }

  @Post('subsidiaries')
  async createSubsidiary(
    @CurrentUser() user: User,
    @Body() createSubsidiaryDto: CreateSubsidiaryDto,
  ) {
    return this.organizationsService.createSubsidiary(user.organizationId, createSubsidiaryDto);
  }

  @Get('settings/smtp')
  getSmtpSettings() {
    return {
      host: this.configService.get<string>('MAIL_HOST', ''),
      port: this.configService.get<number>('MAIL_PORT', 587),
      user: this.configService.get<string>('MAIL_USER', ''),
      secure: this.configService.get<boolean>('MAIL_SECURE', false),
    };
  }
}
