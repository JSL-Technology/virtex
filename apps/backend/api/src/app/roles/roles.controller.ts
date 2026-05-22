import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ForbiddenException, ParseUUIDPipe } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import * as jwtPayloadInterface from '../auth/interfaces/jwt-payload.interface';
import { ALL_PERMISSIONS } from '../shared/permissions';

@Controller('roles')
@UseGuards(JwtAuthGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get('available-permissions')
  getAvailablePermissions() {
    return ALL_PERMISSIONS;
  }

  @Post()
  create(@Body() createRoleDto: CreateRoleDto, @CurrentUser() user: jwtPayloadInterface.JwtPayload) {
    return this.rolesService.create(createRoleDto, user.organizationId);
  }

  @Post('clone/:id')
  clone(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: jwtPayloadInterface.JwtPayload) {
    return this.rolesService.cloneRole(id, user.organizationId);
  }

  @Get()
  findAll(@CurrentUser() user: jwtPayloadInterface.JwtPayload) {
    return this.rolesService.findAllByOrg(user.organizationId);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updateRoleDto: UpdateRoleDto, @CurrentUser() user: jwtPayloadInterface.JwtPayload) {
    return this.rolesService.update(id, updateRoleDto, user.organizationId);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: jwtPayloadInterface.JwtPayload) {
    return this.rolesService.remove(id, user.organizationId);
  }
}