import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions/permissions.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { TwoFactorVerifiedGuard } from '../auth/guards/two-factor-verified.guard';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { PERMISSIONS, ALL_PERMISSIONS } from '../shared/permissions';

// H1 FIX: All role mutations require PermissionsGuard + CsrfGuard + TwoFactorVerifiedGuard.
// Without this, any authenticated user could escalate privileges by creating/editing roles.
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
  create(@Body() createRoleDto: CreateRoleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rolesService.create(createRoleDto, user.organizationId, user);
  }

  @Post('clone/:id')
  @UseGuards(CsrfGuard, TwoFactorVerifiedGuard)
  @HasPermission(PERMISSIONS.ROLES_CREATE)
  clone(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.rolesService.cloneRole(id, user.organizationId);
  }

  @Get()
  @HasPermission(PERMISSIONS.ROLES_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.rolesService.findAllByOrg(user.organizationId);
  }

  @Patch(':id')
  @UseGuards(CsrfGuard, TwoFactorVerifiedGuard)
  @HasPermission(PERMISSIONS.ROLES_EDIT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateRoleDto: UpdateRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rolesService.update(id, updateRoleDto, user.organizationId, user);
  }

  @Delete(':id')
  @UseGuards(CsrfGuard, TwoFactorVerifiedGuard)
  @HasPermission(PERMISSIONS.ROLES_DELETE)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.rolesService.remove(id, user.organizationId);
  }
}
