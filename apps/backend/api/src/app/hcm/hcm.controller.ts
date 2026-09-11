import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { HcmService } from './hcm.service';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Controller('hcm')
@UseGuards(JwtAuthGuard)
export class HcmController {
  constructor(private readonly hcmService: HcmService) {}

  // ── Employees ────────────────────────────────────────────────────────────────

  @Get('employees')
  @HasPermission(PERMISSIONS.HCM_VIEW)
  findAllEmployees(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.hcmService.findAllEmployees(user.organizationId, { page, pageSize });
  }

  @Get('employees/:id')
  @HasPermission(PERMISSIONS.HCM_VIEW)
  findOneEmployee(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hcmService.findOneEmployee(id, user.organizationId);
  }

  @Post('employees')
  @HasPermission(PERMISSIONS.HCM_MANAGE)
  createEmployee(@Body() dto: CreateEmployeeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hcmService.createEmployee(dto, user.organizationId);
  }

  @Patch('employees/:id')
  @HasPermission(PERMISSIONS.HCM_MANAGE)
  updateEmployee(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hcmService.updateEmployee(id, dto, user.organizationId);
  }

  @Delete('employees/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.HCM_MANAGE)
  removeEmployee(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hcmService.removeEmployee(id, user.organizationId);
  }

  // ── Departments ──────────────────────────────────────────────────────────────

  @Get('departments')
  @HasPermission(PERMISSIONS.HCM_VIEW)
  findAllDepartments(@CurrentUser() user: AuthenticatedUser) {
    return this.hcmService.findAllDepartments(user.organizationId);
  }

  @Get('departments/:id')
  @HasPermission(PERMISSIONS.HCM_VIEW)
  findOneDepartment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hcmService.findOneDepartment(id, user.organizationId);
  }

  @Post('departments')
  @HasPermission(PERMISSIONS.HCM_MANAGE)
  createDepartment(@Body() dto: CreateDepartmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hcmService.createDepartment(dto, user.organizationId);
  }

  @Patch('departments/:id')
  @HasPermission(PERMISSIONS.HCM_MANAGE)
  updateDepartment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hcmService.updateDepartment(id, dto, user.organizationId);
  }

  @Delete('departments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.HCM_MANAGE)
  removeDepartment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hcmService.removeDepartment(id, user.organizationId);
  }
}
