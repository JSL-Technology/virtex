
import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Req, UseFilters, ParseUUIDPipe, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
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
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions/permissions.guard';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User, UserStatus } from './entities/user.entity/user.entity';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { plainToInstance } from 'class-transformer';
import { CheckPermissions } from '../auth/decorators/check-permissions.decorator';
import { IsOrganizationOwner } from '../auth/policies/is-organization-owner.policy';
import { TypeOrmExceptionFilter } from '../common/filters/typeorm-exception.filter';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JobTitle } from './enums/job-title.enum';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseFilters(TypeOrmExceptionFilter)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly storageService: StorageService
  ) {}

  @Get('job-titles')
  @ApiOperation({ summary: 'Get list of available job titles' })
  getJobTitles() {
    return Object.values(JobTitle);
  }

  @Post('invite')
  @HasPermission('users.create')
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
  @HasPermission('users.view')
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

  @Post('profile/avatar')
  @UseGuards(ThrottlerGuard)
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
  @HasPermission('users.view')
  @ApiOperation({ summary: 'Get user by ID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    // Ideally ensure user belongs to same org
    const foundUser = await this.usersService.findOne(id);
    return plainToInstance(UserResponseDto, foundUser, { excludeExtraneousValues: true });
  }

  @Patch(':id')
  @HasPermission('users.edit')
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
    );
    return plainToInstance(UserResponseDto, updatedUser, { excludeExtraneousValues: true });
  }

  @Delete(':id')
  @HasPermission('users.delete')
  @CheckPermissions(IsOrganizationOwner)
  @ApiOperation({ summary: 'Remove user' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.usersService.remove(id, user.organizationId);
  }

  @Patch(':id/status')
  @HasPermission('users.edit')
  async updateStatus(
      @Param('id', ParseUUIDPipe) id: string,
      @Body('status') status: UserStatus,
      @CurrentUser() user: User
  ) {
      const updatedUser = await this.usersService.updateUserStatus(id, status, user.organizationId);
      return plainToInstance(UserResponseDto, updatedUser, { excludeExtraneousValues: true });
  }

  @Post(':id/reset-password')
  @HasPermission('users.edit')
  async resetPassword(
      @Param('id', ParseUUIDPipe) id: string,
      @CurrentUser() user: User
  ) {
      await this.usersService.resetPassword(id, user.organizationId);
      return { message: 'Password reset email sent.' };
  }

  @Get(':id/activity')
  @HasPermission('users.view')
  async getActivityLog(@Param('id', ParseUUIDPipe) id: string) {
      return this.usersService.getActivityLog(id);
  }

  @Post(':id/force-logout')
  @HasPermission('users.edit')
  async forceLogout(@Param('id', ParseUUIDPipe) id: string) {
      return this.usersService.forceLogout(id);
  }
}
