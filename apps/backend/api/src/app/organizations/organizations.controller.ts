
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
import { plainToInstance } from 'class-transformer';
import { OrganizationResponseDto } from '../auth/dto/user-response.dto';
import { StepUpGuard } from '../auth/guards/step-up.guard';
import { StepUp } from '../auth/decorators/step-up.decorator';
import { StepUpScope } from '../auth/enums/step-up-scope.enum';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get('profile')
  async getProfile(@CurrentUser() user: User) {
    // Serialised, not returned raw. The entity carries `stripe_customer_id` and
    // `stripe_subscription_id`, which OrganizationResponseDto excludes on purpose — this endpoint
    // handed both to any authenticated member of the organization.
    const organization = await this.organizationsService.findOne(user.organizationId);
    return plainToInstance(OrganizationResponseDto, organization, {
      excludeExtraneousValues: true,
    });
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

  /**
   * Create a subsidiary organization.
   *
   * This carried no authorization at all: any authenticated user could create organizations,
   * including a Member whose only permissions are `invoices:view` and `products:view`. Creating
   * legal entities under the tenant is an owner-level act, and it changes the consolidation
   * structure, so it takes the same ownership policy as editing the organization itself plus a
   * fresh proof of identity.
   */
  @Post('subsidiaries')
  @UseGuards(StepUpGuard)
  @StepUp(StepUpScope.MANAGE_ROLES)
  @CheckPermissions(IsOrganizationOwnerPolicy)
  async createSubsidiary(
    @CurrentUser() user: User,
    @Body() createSubsidiaryDto: CreateSubsidiaryDto,
  ) {
    return this.organizationsService.createSubsidiary(user.organizationId, createSubsidiaryDto);
  }
}
