import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions/permissions.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { StepUpGuard } from '../auth/guards/step-up.guard';
import { StepUp } from '../auth/decorators/step-up.decorator';
import { StepUpScope } from '../auth/enums/step-up-scope.enum';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { PERMISSIONS, ALL_PERMISSIONS } from '../shared/permissions';

// Every role mutation rewrites the authorization graph, so all of them require
// PermissionsGuard + CsrfGuard + a fresh step-up proof scoped to MANAGE_ROLES.
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
  @UseGuards(CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.MANAGE_ROLES)
  @HasPermission(PERMISSIONS.ROLES_CREATE)
  create(@Body() createRoleDto: CreateRoleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rolesService.create(createRoleDto, user.organizationId, user);
  }

  // H2 FIX: Pass actor so assertAssignablePermissions validates the cloner cannot escalate
  // by copying permissions they don't hold.
  @Post('clone/:id')
  @UseGuards(CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.MANAGE_ROLES)
  @HasPermission(PERMISSIONS.ROLES_CREATE)
  clone(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.rolesService.cloneRole(id, user.organizationId, user);
  }

  @Get()
  @HasPermission(PERMISSIONS.ROLES_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.rolesService.findAllByOrg(user.organizationId);
  }

  @Patch(':id')
  @UseGuards(CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.MANAGE_ROLES)
  @HasPermission(PERMISSIONS.ROLES_EDIT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateRoleDto: UpdateRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rolesService.update(id, updateRoleDto, user.organizationId, user);
  }

  @Delete(':id')
  @UseGuards(CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.MANAGE_ROLES)
  @HasPermission(PERMISSIONS.ROLES_DELETE)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.rolesService.remove(id, user.organizationId);
  }
}
