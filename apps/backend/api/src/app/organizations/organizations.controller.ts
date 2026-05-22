
import { Controller, Get, Body, Patch, UseGuards, Put } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { CheckPermissions } from '../auth/decorators/check-permissions.decorator';
import { IsOrganizationOwnerPolicy } from '../auth/policies/is-organization-owner.policy';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { CreateSubsidiaryDto } from './dto/create-subsidiary.dto';
import { Organization } from './entities/organization.entity';
import { Post } from '@nestjs/common';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

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
}
