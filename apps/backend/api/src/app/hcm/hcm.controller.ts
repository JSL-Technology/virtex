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
  UseInterceptors,
} from '@nestjs/common';
import { HcmService } from './hcm.service';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuditAccess } from '../audit/audit-access.decorator';
import { AuditAccessInterceptor } from '../audit/audit-access.interceptor';
import { ActionType } from '../audit/entities/audit-log.entity';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { CreateCompensationDto } from './dto/create-compensation.dto';
import { Employee } from './entities/employee.entity';
import { Page } from '../common/pagination';

@Controller('hcm')
@UseGuards(JwtAuthGuard)
@UseInterceptors(AuditAccessInterceptor)
export class HcmController {
  constructor(private readonly hcmService: HcmService) {}

  // ── Employees ────────────────────────────────────────────────────────────────

  @Get('employees')
  @HasPermission(PERMISSIONS.HCM_VIEW)
  async findAllEmployees(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    const result = await this.hcmService.findAllEmployees(user.organizationId, { page, pageSize });
    return { ...result, rows: result.rows.map((e) => this.redact(e, user)) } as Page<Employee>;
  }

  @Get('employees/:id')
  @HasPermission(PERMISSIONS.HCM_VIEW)
  async findOneEmployee(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.redact(await this.hcmService.findOneEmployee(id, user.organizationId), user);
  }

  /**
   * An employee's decrypted cédula and bank account.
   *
   * Separate route, separate permission, and audited — reading someone's national id and the
   * account their wages go to is an event a compliance officer must be able to reconstruct, not a
   * field that rides along on every list.
   */
  @Get('employees/:id/sensitive')
  @HasPermission(PERMISSIONS.HCM_VIEW_SENSITIVE)
  @AuditAccess({ entity: 'employee_pii', action: ActionType.READ, identifiers: ['id'] })
  async sensitive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const e = await this.hcmService.findOneEmployee(id, user.organizationId);
    return {
      id: e.id,
      identityDocument: e.identityDocument,
      identityDocumentType: e.identityDocumentType,
      bankName: e.bankName,
      bankAccountNumber: e.bankAccountNumber,
      bankAccountType: e.bankAccountType,
    };
  }

  @Post('employees')
  @HasPermission(PERMISSIONS.HCM_MANAGE)
  async createEmployee(@Body() dto: CreateEmployeeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.redact(await this.hcmService.createEmployee(dto, user.organizationId), user);
  }

  @Patch('employees/:id')
  @HasPermission(PERMISSIONS.HCM_MANAGE)
  async updateEmployee(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.redact(await this.hcmService.updateEmployee(id, dto, user.organizationId), user);
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

  // ── Compensation (versioned salary) ───────────────────────────────────────────

  @Get('employees/:id/compensation')
  @HasPermission(PERMISSIONS.PAYROLL_VIEW_COMPENSATION)
  @AuditAccess({ entity: 'employee_compensation', action: ActionType.READ, identifiers: ['id'] })
  listCompensation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hcmService.listCompensations(id, user.organizationId);
  }

  // Writing a salary is recorded by the FinancialAuditSubscriber (employee_compensations is audited),
  // so a pay change always leaves an actor behind it.
  @Post('employees/:id/compensation')
  @HasPermission(PERMISSIONS.PAYROLL_EDIT_COMPENSATION)
  addCompensation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCompensationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hcmService.addCompensation(id, dto, user.organizationId);
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

  /**
   * Strip the encrypted PII from a register response unless the caller may see it.
   *
   * `findOne` decrypts the cédula and bank account through the column transformer, so without this a
   * holder of the ordinary `HCM_VIEW` would receive them in the list payload. Sensitive data leaves
   * only through the dedicated, audited route above.
   */
  private redact(employee: Employee, user: AuthenticatedUser): Employee {
    const maySeeSensitive =
      user.permissions?.includes('*') ||
      user.permissions?.includes(PERMISSIONS.HCM_VIEW_SENSITIVE);
    const { identityDocumentHash, ...rest } = employee;
    void identityDocumentHash;
    if (maySeeSensitive) return rest as Employee;
    return { ...rest, identityDocument: null, bankAccountNumber: null } as Employee;
  }
}
