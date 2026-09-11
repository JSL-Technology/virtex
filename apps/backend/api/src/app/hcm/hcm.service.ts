import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee } from './entities/employee.entity';
import { Department } from './entities/department.entity';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { NotFoundError } from '../i18n/localized.exception';
import { Page, resolvePaging, toPage } from '../common/pagination';

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

  createEmployee(dto: CreateEmployeeDto, organizationId: string): Promise<Employee> {
    const employee = this.employeeRepository.create({ ...dto, organizationId });
    return this.employeeRepository.save(employee);
  }

  async updateEmployee(
    id: string,
    dto: UpdateEmployeeDto,
    organizationId: string,
  ): Promise<Employee> {
    const employee = await this.findOneEmployee(id, organizationId);
    return this.employeeRepository.save(this.employeeRepository.merge(employee, dto));
  }

  async removeEmployee(id: string, organizationId: string): Promise<void> {
    await this.findOneEmployee(id, organizationId);
    await this.employeeRepository.delete({ id, organizationId });
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
