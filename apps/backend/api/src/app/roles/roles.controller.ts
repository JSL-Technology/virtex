import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ForbiddenException, ParseUUIDPipe } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import * as jwtPayloadInterface from '../auth/interfaces/jwt-payload.interface';
import { ALL_PERMISSIONS, PERMISSIONS } from '../shared/permissions';
import { PermissionsGuard } from '../auth/guards/permissions/permissions.guard';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { TwoFactorVerifiedGuard } from '../auth/guards/two-factor-verified.guard';

@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get('available-permissions')
  @HasPermission(PERMISSIONS.ROLES_VIEW)
  getAvailablePermissions() {
    return ALL_PERMISSIONS;
  }

  @Post()
  @UseGuards(CsrfGuard, TwoFactorVerifiedGuard)
  @HasPermission(PERMISSIONS.ROLES_CREATE)
  create(@Body() createRoleDto: CreateRoleDto, @CurrentUser() user: jwtPayloadInterface.JwtPayload) {
    return this.rolesService.create(createRoleDto, user.organizationId);
  }

  @Post('clone/:id')
  @UseGuards(CsrfGuard, TwoFactorVerifiedGuard)
  @HasPermission(PERMISSIONS.ROLES_CREATE)
  clone(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: jwtPayloadInterface.JwtPayload) {
    return this.rolesService.cloneRole(id, user.organizationId);
  }

  @Get()
  @HasPermission(PERMISSIONS.ROLES_VIEW)
  findAll(@CurrentUser() user: jwtPayloadInterface.JwtPayload) {
    return this.rolesService.findAllByOrg(user.organizationId);
  }

  @Patch(':id')
  @UseGuards(CsrfGuard, TwoFactorVerifiedGuard)
  @HasPermission(PERMISSIONS.ROLES_EDIT)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updateRoleDto: UpdateRoleDto, @CurrentUser() user: jwtPayloadInterface.JwtPayload) {
    return this.rolesService.update(id, updateRoleDto, user.organizationId);
  }

  @Delete(':id')
  @UseGuards(CsrfGuard, TwoFactorVerifiedGuard)
  @HasPermission(PERMISSIONS.ROLES_DELETE)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: jwtPayloadInterface.JwtPayload) {
    return this.rolesService.remove(id, user.organizationId);
  }
}