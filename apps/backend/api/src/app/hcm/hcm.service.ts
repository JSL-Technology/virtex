import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee } from './entities/employee.entity';
import { Department } from './entities/department.entity';
import { EmployeeCompensation } from './entities/employee-compensation.entity';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { CreateCompensationDto } from './dto/create-compensation.dto';
import { ConflictError, NotFoundError } from '../i18n/localized.exception';
import { Page, resolvePaging, toPage } from '../common/pagination';
import { blindIndex } from '../common/database/encrypted-column.transformer';

/**
 * The employee and department registers.
 *
 * HCM shipped with two entities, a module that only declared them, and no way to read or write
 * either — plus a global-unique constraint on `employees.email` that would have stopped two tenants
 * ever hiring the same person. Every query here is tenant-scoped; the composite unique per tenant
 * lives on the entity and its migration. This is the register only — payroll calculation remains
 * out of scope and is called out as such in the audit report.
 */
@Injectable()
export class HcmService {
  constructor(
    @InjectRepository(Employee)
    private readonly employeeRepository: Repository<Employee>,
    @InjectRepository(Department)
    private readonly departmentRepository: Repository<Department>,
    @InjectRepository(EmployeeCompensation)
    private readonly compensationRepository: Repository<EmployeeCompensation>,
  ) {}

  // ── Employees ────────────────────────────────────────────────────────────────

  async findAllEmployees(
    organizationId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<Page<Employee>> {
    const paging = resolvePaging(query.page, query.pageSize);
    const [rows, total] = await this.employeeRepository.findAndCount({
      where: { organizationId },
      order: { lastName: 'ASC', firstName: 'ASC' },
      skip: paging.skip,
      take: paging.take,
    });
    return toPage(rows, total, paging);
  }

  async findOneEmployee(id: string, organizationId: string): Promise<Employee> {
    const employee = await this.employeeRepository.findOne({
      where: { id, organizationId },
    });
    if (!employee) {
      throw new NotFoundError('HCM.EMPLOYEE_NOT_FOUND', { id });
    }
    return employee;
  }

  async createEmployee(dto: CreateEmployeeDto, organizationId: string): Promise<Employee> {
    // The blind index is what enforces one employee per cédula per tenant without the database ever
    // holding the cédula in the clear: the transformer encrypts the value, and this HMAC of it backs
    // the unique index. Computed here so every write path sets it.
    const identityDocumentHash = blindIndex(dto.identityDocument);
    const employee = this.employeeRepository.create({ ...dto, organizationId, identityDocumentHash });
    return this.saveEmployee(employee);
  }

  async updateEmployee(
    id: string,
    dto: UpdateEmployeeDto,
    organizationId: string,
  ): Promise<Employee> {
    const employee = await this.findOneEmployee(id, organizationId);
    const merged = this.employeeRepository.merge(employee, dto);
    // Keep the blind index in step with the (possibly changed) cédula.
    if (dto.identityDocument !== undefined) {
      merged.identityDocumentHash = blindIndex(dto.identityDocument);
    }
    return this.saveEmployee(merged);
  }

  /** Soft delete: a person with payroll history is deactivated, never physically removed. */
  async removeEmployee(id: string, organizationId: string): Promise<void> {
    await this.findOneEmployee(id, organizationId);
    await this.employeeRepository.softDelete({ id, organizationId });
  }

  /** Save translating the cédula unique-index violation into a clear, localized conflict. */
  private async saveEmployee(employee: Employee): Promise<Employee> {
    try {
      return await this.employeeRepository.save(employee);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictError('HCM.EMPLEADO_YA_EXISTE_CON_ESA_CEDULA_O_CORREO');
      }
      throw error;
    }
  }

  // ── Compensation (versioned salary) ───────────────────────────────────────────

  /** Record a salary effective from a date — a new row, never an overwrite of the prior one. */
  async addCompensation(
    employeeId: string,
    dto: CreateCompensationDto,
    organizationId: string,
  ): Promise<EmployeeCompensation> {
    await this.findOneEmployee(employeeId, organizationId);
    const compensation = this.compensationRepository.create({
      ...dto,
      employeeId,
      organizationId,
    });
    try {
      return await this.compensationRepository.save(compensation);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictError('HCM.YA_EXISTE_COMPENSACION_CON_ESA_FECHA_VIGENCIA');
      }
      throw error;
    }
  }

  /** An employee's salary history, newest first. */
  async listCompensations(
    employeeId: string,
    organizationId: string,
  ): Promise<EmployeeCompensation[]> {
    await this.findOneEmployee(employeeId, organizationId);
    return this.compensationRepository.find({
      where: { employeeId, organizationId },
      order: { effectiveFrom: 'DESC' },
    });
  }

  // ── Departments ──────────────────────────────────────────────────────────────

  findAllDepartments(organizationId: string): Promise<Department[]> {
    return this.departmentRepository.find({
      where: { organizationId },
      order: { name: 'ASC' },
    });
  }

  async findOneDepartment(id: string, organizationId: string): Promise<Department> {
    const department = await this.departmentRepository.findOne({
      where: { id, organizationId },
    });
    if (!department) {
      throw new NotFoundError('HCM.DEPARTMENT_NOT_FOUND', { id });
    }
    return department;
  }

  createDepartment(dto: CreateDepartmentDto, organizationId: string): Promise<Department> {
    const department = this.departmentRepository.create({ ...dto, organizationId });
    return this.departmentRepository.save(department);
  }

  async updateDepartment(
    id: string,
    dto: UpdateDepartmentDto,
    organizationId: string,
  ): Promise<Department> {
    const department = await this.findOneDepartment(id, organizationId);
    return this.departmentRepository.save(
      this.departmentRepository.merge(department, dto),
    );
  }

  async removeDepartment(id: string, organizationId: string): Promise<void> {
    await this.findOneDepartment(id, organizationId);
    await this.departmentRepository.delete({ id, organizationId });
  }
}
