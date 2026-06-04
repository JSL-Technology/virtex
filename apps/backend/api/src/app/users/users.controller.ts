
import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, UseFilters, ParseUUIDPipe, UseInterceptors, UploadedFile, BadRequestException, HttpCode, HttpStatus, Ip } from '@nestjs/common';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { FastifyFile } from '../common/interfaces/fastify-file.interface';
import { ThrottlerGuard } from '@nestjs/throttler';
import { extname } from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { StorageService } from '../storage/storage.service';
import { UsersService } from './users.service';
import { InviteUserDto } from './entities/user.entity/invite-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RequestEmailChangeDto, ConfirmEmailChangeDto } from './dto/email-change.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions/permissions.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { StepUpGuard } from '../auth/guards/step-up.guard';
import { StepUp } from '../auth/decorators/step-up.decorator';
import { StepUpScope } from '../auth/enums/step-up-scope.enum';
import { TwoFactorVerifiedGuard } from '../auth/guards/two-factor-verified.guard';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { User, UserStatus } from './entities/user.entity/user.entity';
import { PERMISSIONS } from '../shared/permissions';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { plainToInstance } from 'class-transformer';
import { IsOrganizationOwner } from '../auth/policies/is-organization-owner.policy';
import { TypeOrmExceptionFilter } from '../common/filters/typeorm-exception.filter';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JobTitle } from './enums/job-title.enum';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseFilters(TypeOrmExceptionFilter)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly storageService: StorageService,
    private readonly auditTrailService: AuditTrailService
  ) {}

  @Get('job-titles')
  @ApiOperation({ summary: 'Get list of available job titles' })
  getJobTitles() {
    return Object.values(JobTitle);
  }

  @Post('invite')
  @UseGuards(CsrfGuard, TwoFactorVerifiedGuard)
  @HasPermission(PERMISSIONS.USERS_CREATE)
  @ApiOperation({ summary: 'Invite a new user to the organization' })
  async inviteUser(
    @Body() inviteUserDto: InviteUserDto,
    @CurrentUser() user: User,
  ) {
    const newUser = await this.usersService.inviteUser(
      inviteUserDto,
      user.organizationId,
    );
    return plainToInstance(UserResponseDto, newUser, { excludeExtraneousValues: true });
  }

  @Get()
  @HasPermission(PERMISSIONS.USERS_VIEW)
  @ApiOperation({ summary: 'List users in organization' })
  async findAll(
    @CurrentUser() user: User,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 10,
    @Query('search') search = '',
    @Query('status') status = 'all',
    @Query('sortColumn') sortColumn = 'createdAt',
    @Query('sortDirection') sortDirection: 'ASC' | 'DESC' = 'DESC',
  ) {
    const { data, total } = await this.usersService.findAllByOrg(
      user.organizationId,
      {
        page,
        pageSize,
        searchTerm: search,
        statusFilter: status,
        sortColumn,
        sortDirection,
      },
    );

    return {
      data: plainToInstance(UserResponseDto, data, { excludeExtraneousValues: true }),
      total,
      page,
      pageSize,
    };
  }

  @Get('profile')
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@CurrentUser() user: User) {
    const fullUser = await this.usersService.findOne(user.id);
    return plainToInstance(UserResponseDto, fullUser, { excludeExtraneousValues: true });
  }

  @Patch('profile')
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Update current user profile' })
  async updateProfile(
    @CurrentUser() user: User,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    const updatedUser = await this.usersService.updateProfile(
      user.id,
      updateProfileDto,
    );
    return plainToInstance(UserResponseDto, updatedUser, { excludeExtraneousValues: true });
  }

  // ------------------------------------------------------------------
  // H-01 FIX: Secure email-change flow (step-up + confirmation token)
  // ------------------------------------------------------------------

  @Post('profile/email-change/request')
  @UseGuards(CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.CHANGE_EMAIL)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request an email change — requires current password as step-up' })
  async requestEmailChange(
    @CurrentUser() user: User,
    @Body() dto: RequestEmailChangeDto,
    @Ip() ip: string
  ) {
    try {
      await this.usersService.requestEmailChange(user.id, dto);
      await this.auditTrailService.record(user.id, 'User', user.id, ActionType.UPDATE, { action: 'request-email-change', newEmail: dto.newEmail }, undefined, ip, user.organizationId);
      return { message: 'Si los datos son correctos, se ha enviado un enlace de confirmación al nuevo correo.' };
    } catch (e) {
      await this.auditTrailService.record(user.id, 'User', user.id, ActionType.UPDATE, { action: 'request-email-change', newEmail: dto.newEmail, error: e.message }, undefined, ip, user.organizationId);
      throw e;
    }
  }

  @Post('profile/email-change/confirm')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm email change via token' })
  async confirmEmailChange(
    @CurrentUser() user: User,
    @Body() dto: ConfirmEmailChangeDto,
  ) {
    await this.usersService.confirmEmailChange(user.id, dto);
    return { message: 'Correo electrónico actualizado. Tu sesión se ha invalidado por seguridad.' };
  }

  @Post('profile/avatar')
  @UseGuards(ThrottlerGuard, CsrfGuard)
  @ApiOperation({ summary: 'Upload avatar for current user' })
  @UseInterceptors(FastifyFileInterceptor('file', {
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif)$/)) {
            return cb(new BadRequestException('Only image files are allowed!'), false);
        }
        cb(null, true);
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    }
  }))
  async uploadAvatar(
    @CurrentUser() user: User,
    @UploadedFile() file: FastifyFile
  ) {
      if (!file) throw new BadRequestException('File is required');

      try {
        const avatarUrl = await this.storageService.upload(file, 'avatars');
        const updatedUser = await this.usersService.updateProfile(user.id, { avatarUrl });
        return { avatarUrl: updatedUser.avatarUrl };
      } finally {
        if (file.path) {
          await fs.unlink(file.path).catch(() => {});
        }
      }
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.USERS_VIEW)
  @ApiOperation({ summary: 'Get user by ID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    // H2 FIX: Scope query to current user's organization to prevent IDOR cross-tenant reads.
    const foundUser = await this.usersService.findOneByOrg(id, user.organizationId);
    return plainToInstance(UserResponseDto, foundUser, { excludeExtraneousValues: true });
  }

  @Patch(':id')
  @UseGuards(CsrfGuard, TwoFactorVerifiedGuard)
  @HasPermission(PERMISSIONS.USERS_EDIT)
  @ApiOperation({ summary: 'Update user (Admin)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() user: User,
  ) {
    const updatedUser = await this.usersService.updateUser(
      id,
      updateUserDto,
      user.organizationId,
      user as unknown as AuthenticatedUser,
    );
    return plainToInstance(UserResponseDto, updatedUser, { excludeExtraneousValues: true });
  }

  @Delete(':id')
  @UseGuards(CsrfGuard, TwoFactorVerifiedGuard, StepUpGuard)
  @StepUp(StepUpScope.DELETE_ACCOUNT)
  // M-05 FIX: Permission + ABAC policy combined in a SINGLE metadata declaration so the
  // ownership policy is actually evaluated (previously @CheckPermissions was silently
  // overwritten by @HasPermission because both write the same 'permissions' metadata key).
  @HasPermission(PERMISSIONS.USERS_DELETE, IsOrganizationOwner)
  @ApiOperation({ summary: 'Remove user' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @Ip() ip: string) {
    try {
      const result = await this.usersService.remove(id, user.organizationId);
      await this.auditTrailService.record(user.id, 'User', id, ActionType.DELETE, { action: 'delete-user' }, undefined, ip, user.organizationId);
      return result;
    } catch (e) {
      await this.auditTrailService.record(user.id, 'User', id, ActionType.DELETE, { action: 'delete-user', error: e.message }, undefined, ip, user.organizationId);
      throw e;
    }
  }

  @Patch(':id/status')
  @UseGuards(CsrfGuard, TwoFactorVerifiedGuard)
  @HasPermission(PERMISSIONS.USERS_MANAGE_STATUS)
  async updateStatus(
      @Param('id', ParseUUIDPipe) id: string,
      @Body() dto: UpdateUserStatusDto,
      @CurrentUser() user: User
  ) {
      // H-08 FIX: Prevent self-block to avoid accidental lock-out of the last admin.
      if (dto.status === UserStatus.BLOCKED && id === user.id) {
          throw new BadRequestException('No puedes bloquear tu propia cuenta.');
      }
      const updatedUser = await this.usersService.updateUserStatus(id, dto.status, user.organizationId);
      return plainToInstance(UserResponseDto, updatedUser, { excludeExtraneousValues: true });
  }

  @Post(':id/reset-password')
  @UseGuards(CsrfGuard, TwoFactorVerifiedGuard)
  @HasPermission(PERMISSIONS.USERS_PASSWORD_RESET)
  async resetPassword(
      @Param('id', ParseUUIDPipe) id: string,
      @CurrentUser() user: User
  ) {
      await this.usersService.resetPassword(id, user.organizationId);
      return { message: 'Password reset email sent.' };
  }

  // H5 FIX: Validate target user belongs to the requester's organization before returning
  // audit events, preventing cross-tenant IDOR.
  @Get(':id/activity')
  @HasPermission(PERMISSIONS.USERS_VIEW)
  // H-11 FIX: Scope the activity log query to the caller's organization to prevent a
  // privileged user from reading another tenant's activity via a cross-org userId
  // (OWASP API1 BOLA; CWE-639). findOneByOrg also verifies the target belongs to the org.
  async getActivityLog(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
      await this.usersService.findOneByOrg(id, user.organizationId);
      return this.usersService.getActivityLog(id, user.organizationId);
  }

  @Post(':id/force-logout')
  @UseGuards(CsrfGuard, TwoFactorVerifiedGuard)
  @HasPermission(PERMISSIONS.USERS_FORCE_LOGOUT)
  async forceLogout(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
      return this.usersService.forceLogout(id, user.organizationId);
  }

  @Post(':id/email-change')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, TwoFactorVerifiedGuard)
  // L-08 FIX: use the catalog constant ('users:edit') — the previous 'users.edit' string
  // did not exist in PERMISSIONS and only ever passed for wildcard admins.
  @HasPermission(PERMISSIONS.USERS_EDIT)
  @ApiOperation({ summary: 'Admin: change user email with session invalidation' })
  async adminChangeEmail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('email') email: string,
    @CurrentUser() user: User,
  ) {
    await this.usersService.adminChangeEmail(id, email, user.organizationId);
    return { message: 'Email actualizado. La sesión del usuario ha sido invalidada.' };
  }

  @Post(':id/block-and-logout')
  @UseGuards(CsrfGuard, TwoFactorVerifiedGuard)
  @HasPermission(PERMISSIONS.USERS_MANAGE_STATUS)
  async blockAndLogout(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
      return this.usersService.blockAndLogout(id, user.organizationId);
  }
}
