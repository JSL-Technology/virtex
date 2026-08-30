
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
import { Ip, Headers, Res, HttpCode, HttpStatus, ForbiddenException } from '@nestjs/common';
import type { HttpResponse as Response } from '../common/http/http.types';
import { MembershipService } from './services/membership.service';
import { SwitchOrganizationDto } from './dto/switch-organization.dto';
import { TokenService } from '../auth/services/token.service';
import { CookieService } from '../auth/services/cookie.service';
import { UsersService } from '../users/users.service';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { AllowInactiveSubscription } from '../saas/decorators/allow-inactive-subscription.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly membershipService: MembershipService,
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
    private readonly cookieService: CookieService,
  ) {}

  /**
   * The tenants the signed-in person can act in.
   *
   * `user_organizations` has existed since a migration long before this endpoint, holding whatever
   * a one-off backfill put there and read by exactly one query. Nothing wrote it, and nothing let
   * a user move between the rows it held — so a person working with two customers had to hold two
   * accounts, with two passwords and two sets of MFA factors.
   */
  // A person whose current tenant is suspended must still be able to see their other tenants and
  // move to one that is in good standing. Gating this on the suspended tenant's own subscription
  // would trap them there.
  @AllowInactiveSubscription()
  @Get('memberships')
  async getMemberships(@CurrentUser() user: AuthenticatedUser) {
    return this.membershipService.listFor(user.id, user.organizationId);
  }

  /**
   * Switch the active tenant, re-issuing the session for it.
   *
   * The tenant lives in the access token, so switching means new tokens — it cannot be a client-
   * side preference, or the server would keep enforcing the old one. New tokens are issued in a
   * NEW session family rather than by mutating the current one, so revoking a session revokes what
   * it actually granted.
   *
   * Membership is re-checked here against the database, not against the token's claims: the token
   * was minted before this request and a membership can have been revoked since.
   */
  @AllowInactiveSubscription()
  @Post('switch')
  @HttpCode(HttpStatus.OK)
  async switchOrganization(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SwitchOrganizationDto,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    if (!(await this.membershipService.isMember(user.id, dto.organizationId))) {
      // Same message whether the organization does not exist or the user is simply not a member,
      // so the endpoint cannot be used to enumerate tenants by id.
      throw new ForbiddenException('No tienes acceso a esa organización.');
    }

    const fullUser = await this.usersService.findUserByIdForAuth(user.id);
    if (!fullUser) {
      throw new ForbiddenException('No tienes acceso a esa organización.');
    }

    const { accessToken, refreshToken, user: safeUser } =
      await this.tokenService.generateAuthResponse(
        fullUser,
        { organizationId: dto.organizationId },
        ip,
        userAgent,
      );

    this.cookieService.setAuthCookies(res, accessToken, refreshToken, { userId: user.id });

    return {
      user: plainToInstance(UserResponseDto, safeUser, { excludeExtraneousValues: true }),
    };
  }

  @Get('profile')
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
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
    @CurrentUser() user: AuthenticatedUser,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(user.organizationId, updateOrganizationDto);
  }

  @Get('subsidiaries')
  async getSubsidiaries(@CurrentUser() user: AuthenticatedUser) {
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
    @CurrentUser() user: AuthenticatedUser,
    @Body() createSubsidiaryDto: CreateSubsidiaryDto,
  ) {
    return this.organizationsService.createSubsidiary(user.organizationId, createSubsidiaryDto);
  }
}
