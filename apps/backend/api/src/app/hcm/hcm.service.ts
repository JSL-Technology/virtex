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
import {
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
} from '../i18n/localized.exception';
import { Page, resolvePaging, toPage } from '../common/pagination';
import { blindIndex } from '../common/database/encrypted-column.transformer';
import { IdentityDocumentService } from '../localization/services/identity-document.service';
import { IdentityDocumentType } from '../localization/entities/identity-document-type.entity';
import { TenantCountryResolver } from '../shared/tenancy/tenant-country.resolver';
import { JurisdictionRegistry } from '../payroll/jurisdictions/jurisdiction-registry';
import { StatutoryIdentifierSpec } from '../payroll/jurisdictions/jurisdiction-strategy.interface';

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
    private readonly identityDocuments: IdentityDocumentService,
    private readonly tenantCountry: TenantCountryResolver,
    private readonly jurisdictions: JurisdictionRegistry,
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
      throw new NotFoundError('hcm.employee_not_found', { id });
    }
    return employee;
  }

  async createEmployee(dto: CreateEmployeeDto, organizationId: string): Promise<Employee> {
    const identity = await this.resolveIdentityDocument(dto, organizationId);
    await this.assertStatutoryIdentifiers(dto, organizationId);

    // The blind index is what enforces one employee per document per tenant without the database
    // ever holding the document in the clear: the transformer encrypts the value, and this HMAC of
    // it backs the unique index. It hashes the CANONICAL form, so `001-1234567-8` and `00112345678`
    // are recognised as the same person rather than saved twice.
    const employee = this.employeeRepository.create({
      ...dto,
      ...identity,
      organizationId,
      identityDocumentHash: blindIndex(identity.identityDocument),
    });
    return this.saveEmployee(employee);
  }

  async updateEmployee(
    id: string,
    dto: UpdateEmployeeDto,
    organizationId: string,
  ): Promise<Employee> {
    const employee = await this.findOneEmployee(id, organizationId);
    await this.assertStatutoryIdentifiers(dto, organizationId);

    // Re-validate whenever either half of the pair moves. Changing only the TYPE — correcting a
    // cédula wrongly filed as a passport — has to re-check the value against the new rule, which a
    // guard on `identityDocument` alone would miss.
    const identityTouched =
      dto.identityDocument !== undefined ||
      dto.identityDocumentType !== undefined ||
      dto.identityDocumentCountry !== undefined;

    const merged = this.employeeRepository.merge(employee, dto);
    if (identityTouched) {
      const identity = await this.resolveIdentityDocument(
        {
          identityDocument: dto.identityDocument ?? employee.identityDocument ?? undefined,
          identityDocumentType:
            dto.identityDocumentType ?? employee.identityDocumentTypeCode ?? undefined,
          identityDocumentCountry:
            dto.identityDocumentCountry ?? employee.identityDocumentCountry ?? undefined,
        },
        organizationId,
      );
      Object.assign(merged, identity);
      merged.identityDocumentHash = blindIndex(identity.identityDocument);
    }
    return this.saveEmployee(merged);
  }

  /**
   * Validate an employee's identity document against the rule that belongs to it.
   *
   * ## What this replaces
   *
   * `@IsIdentityDocumentForType()`, a synchronous class-validator decorator that ran before
   * anything knew which tenant the request belonged to. Having no country, it applied the Dominican
   * JCE modulus-10 rule to `CEDULA` and the DGII modulus-11 rule to `RNC` — for every market. A US
   * tenant, whose interface asked for an "SSN" because the `en-US` translation patch relabelled the
   * same enum value, had every nine-digit SSN rejected for not being an eleven-digit Dominican
   * cédula. Seven markets could not store an employee's document at all.
   *
   * Three things had to move for that to be fixable: the country has to be resolved (from the
   * organization, not assumed), the rule has to be looked up (from the catalogue, not switched on),
   * and the value has to be stored canonically (by the catalogue's rule, not by deleting every
   * non-digit).
   *
   * An absent document stays absent — the field is optional and blanking it is a legitimate edit.
   * What is refused is a document that is present and wrong, and a document whose TYPE the country
   * does not issue.
   */
  private async resolveIdentityDocument(
    dto: Pick<
      CreateEmployeeDto,
      'identityDocument' | 'identityDocumentType' | 'identityDocumentCountry'
    >,
    organizationId: string,
  ): Promise<{
    identityDocument: string | null;
    identityDocumentTypeCode: string | null;
    identityDocumentCountry: string | null;
  }> {
    // Resolving the tenant's country is skipped entirely when there is nothing to validate, so
    // clearing an employee's document never fails on a tenant whose country was never set.
    if (!dto.identityDocument?.trim()) {
      return { identityDocument: null, identityDocumentTypeCode: null, identityDocumentCountry: null };
    }

    const resolved = await this.identityDocuments.resolveParty({
      value: dto.identityDocument,
      typeCode: dto.identityDocumentType,
      documentCountry: dto.identityDocumentCountry,
      fallbackCountry: await this.tenantCountry.resolve(organizationId),
      appliesTo: 'individual',
      usedFor: 'payroll',
    });

    if (!resolved.ok) {
      switch (resolved.reason) {
        case 'type_required':
          throw new UnprocessableEntityError('hcm.identity_document_type_required', {
            country: resolved.country,
          });
        case 'type_not_issued':
          throw new UnprocessableEntityError('hcm.identity_document_type_not_issued', {
            code: resolved.code,
            country: resolved.country,
          });
        default:
          throw new UnprocessableEntityError('hcm.identity_document_invalid', {
            document: resolved.documentLabel,
          });
      }
    }

    return {
      identityDocument: resolved.value,
      identityDocumentTypeCode: resolved.typeCode,
      identityDocumentCountry: resolved.countryCode,
    };
  }

  /**
   * Check the social-security identifiers against the country's payroll strategy.
   *
   * The Dominican NSS format used to be a `@Matches(/^\d{7,11}$/)` on the shared DTO, applied to
   * every country's employees. The rule now comes from the jurisdiction that imposes it; a country
   * whose strategy declares none imposes none, which is correct for a market this product has not
   * modelled yet and is strictly better than borrowing another country's rule.
   */
  private async assertStatutoryIdentifiers(
    dto: Partial<CreateEmployeeDto>,
    organizationId: string,
  ): Promise<void> {
    const country = await this.tenantCountry.resolveOrNull(organizationId);
    if (!country || !this.jurisdictions.supports(country)) return;

    const specs = this.jurisdictions.forCountry(country).statutoryIdentifiers ?? [];
    for (const spec of specs) {
      const value = this.statutoryValue(dto, spec);
      if (value === undefined || value === null || value === '') {
        if (spec.required) {
          throw new UnprocessableEntityError(spec.messageKey, { field: spec.field });
        }
        continue;
      }
      if (spec.pattern && !new RegExp(spec.pattern).test(value)) {
        throw new UnprocessableEntityError(spec.messageKey, { field: spec.field });
      }
    }
  }

  /** A statutory field is either one of the three columns or a key inside `statutoryEnrolment`. */
  private statutoryValue(
    dto: Partial<CreateEmployeeDto>,
    spec: StatutoryIdentifierSpec,
  ): string | undefined {
    const direct = (dto as Record<string, unknown>)[spec.field];
    if (typeof direct === 'string') return direct;
    const extra = dto.statutoryEnrolment?.[spec.field];
    return typeof extra === 'string' ? extra : undefined;
  }

  /**
   * The document types this tenant's employee form may offer.
   *
   * The form used to carry three `<option>` elements written into the template. This is what it
   * reads instead, and it is the same catalogue the validator above consults — which is the
   * arrangement that stops the two from disagreeing, as they did for seven markets.
   */
  async identityDocumentTypesFor(organizationId: string): Promise<IdentityDocumentType[]> {
    const country = await this.tenantCountry.resolve(organizationId);
    return this.identityDocuments.listForCountry(country, {
      appliesTo: 'individual',
      usedFor: 'payroll',
    });
  }

  /** Soft delete: a person with payroll history is deactivated, never physically removed. */
  async removeEmployee(id: string, organizationId: string): Promise<void> {
    await this.findOneEmployee(id, organizationId);
    await this.employeeRepository.softDelete({ id, organizationId });
  }

  /** Save translating the document unique-index violation into a clear, localized conflict. */
  private async saveEmployee(employee: Employee): Promise<Employee> {
    try {
      return await this.employeeRepository.save(employee);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictError('hcm.employee_with_national_id_email_already');
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
        throw new ConflictError('hcm.compensation_with_effective_date_already_exists');
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
      throw new NotFoundError('hcm.department_not_found', { id });
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
