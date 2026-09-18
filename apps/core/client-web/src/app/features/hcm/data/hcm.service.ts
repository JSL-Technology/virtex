import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type EmploymentStatus = 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';
export type ContractType = 'INDEFINITE' | 'FIXED_TERM' | 'OCCASIONAL';
export type PayFrequency = 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY';

/**
 * One identity document the tenant's country issues, as the catalogue endpoint returns it.
 *
 * `IdentityDocumentType` used to be declared here as `'CEDULA' | 'PASSPORT' | 'RNC'` — a copy of
 * the server's enum, which had to be kept in step by hand, and which said that three Dominican-
 * shaped options were all nineteen markets would ever need. The list is data now, and the client
 * holds no opinion about what is in it.
 */
export interface IdentityDocumentTypeOption {
  code: string;
  /** The issuing jurisdiction, or `XX` for a supranational document such as a passport. */
  countryCode: string;
  /** Catalogue key. Used when `labelVerbatim` is null. */
  labelKey: string;
  /**
   * The authority's own term, which must render untranslated.
   *
   * "Ubigeo" glossed as "district code" is harder to find on the paper the user is copying from,
   * not easier. When present it wins over `labelKey`.
   */
  labelVerbatim: string | null;
  example: string | null;
  /** Shape check for immediate feedback. The server re-checks, including any check digit. */
  pattern: string;
  requirement: 'required' | 'optional';
  isDefault: boolean;
}

/**
 * One statutory (social-security) identifier the tenant's country asks of an employee, as the
 * endpoint returns it.
 *
 * The form used to render three fixed inputs — a Dominican NSS, AFP and SFS — for every market. The
 * fields are data now: the country's payroll strategy declares which it needs, what to call each and
 * what shape it takes, and the server validates against the same specs.
 */
export interface StatutoryIdentifierTypeOption {
  /** The column or `statutoryEnrolment` key this constrains — `socialSecurityNumber`, `pensionFundCode`… */
  field: string;
  /** Catalogue key for the field's label, in the country's own terms. */
  labelKey: string;
  /** Shape check for immediate feedback; null when the country imposes none. The server re-checks. */
  pattern: string | null;
  required: boolean;
}

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string | null;
  departmentId: string | null;
  hireDate: string | null;
  userId: string | null;
  /**
   * Masked unless the caller holds `hcm:view_sensitive`.
   *
   * The cédula and the bank account are encrypted at rest and the list endpoint never returns
   * them in the clear; `GET /hcm/employees/:id/sensitive` does, and is audited.
   */
  identityDocument?: string | null;
  /** Catalogue code — `CEDULA`, `CC`, `CURP`, `CPF`, `PASSPORT`… Null until one is captured. */
  identityDocumentTypeCode: string | null;
  /** The issuing jurisdiction of that code. `XX` for a passport. */
  identityDocumentCountry: string | null;
  bankName: string | null;
  bankAccountNumber?: string | null;
  bankAccountType: string | null;
  /** The worker's number in the national social security system. NSS, IMSS, NIT, PIS… */
  socialSecurityNumber: string | null;
  /** The pension carrier (AFP, AFORE, fondo de pensiones…). */
  pensionFundCode: string | null;
  /** The health carrier (ARS/SFS, EPS, ISAPRE, obra social…). */
  healthFundCode: string | null;
  /** Any further statutory identifier the country's filings need. */
  statutoryEnrolment: Record<string, string> | null;
  employmentStatus: EmploymentStatus;
  terminationDate: string | null;
  contractType: ContractType;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeCompensation {
  id: string;
  employeeId: string;
  effectiveFrom: string;
  baseSalary: number;
  payFrequency: PayFrequency;
  currencyCode: string;
  createdAt: string;
}

export interface Department {
  id: string;
  name: string;
  managerId: string | null;
  costCenter: string | null;
}

export interface HcmPage<T> {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export type SaveEmployee = Partial<
  Omit<Employee, 'id' | 'createdAt' | 'updatedAt'>
> & { firstName: string; lastName: string; email: string };

/**
 * People: the employee register and the company's departments.
 * Canonical location is `features/hcm/data/`. `core/api/hcm.service.ts` re-exports from here.
 */
@Injectable({ providedIn: 'root' })
export class HcmService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/hcm`;

  /**
   * The document types this tenant may offer on the employee form.
   *
   * Replaces three `<option>` elements hardcoded in the template. Server-resolved from the
   * tenant's country, and the same rows the server validates against — which is what keeps the
   * options offered and the values accepted from drifting apart, as they did for seven markets.
   */
  listIdentityDocumentTypes(): Observable<IdentityDocumentTypeOption[]> {
    return this.http.get<IdentityDocumentTypeOption[]>(`${this.apiUrl}/identity-document-types`);
  }

  /**
   * The statutory identifiers this tenant's country asks of an employee.
   *
   * Replaces three fixed inputs (NSS, AFP, SFS) hardcoded in the template. Server-resolved from the
   * tenant's country and the same specs the server validates against, so the fields offered and the
   * values accepted do not drift. Empty for a market whose payroll rules are not modelled yet.
   */
  listStatutoryIdentifierTypes(): Observable<StatutoryIdentifierTypeOption[]> {
    return this.http.get<StatutoryIdentifierTypeOption[]>(
      `${this.apiUrl}/statutory-identifier-types`,
    );
  }

  // ── Employees ──────────────────────────────────────────────────────────────

  listEmployees(options: { page?: number; pageSize?: number } = {}): Observable<HcmPage<Employee>> {
    let params = new HttpParams();
    if (options.page) params = params.set('page', options.page);
    if (options.pageSize) params = params.set('pageSize', options.pageSize);
    return this.http.get<HcmPage<Employee>>(`${this.apiUrl}/employees`, { params });
  }

  getEmployee(id: string): Observable<Employee> {
    return this.http.get<Employee>(`${this.apiUrl}/employees/${id}`);
  }

  /**
   * The unmasked cédula and bank account.
   *
   * A separate call on purpose: reading them is a privileged act that the server audits, and
   * folding them into the ordinary read would audit every list refresh as a disclosure.
   */
  getSensitive(id: string): Observable<Employee> {
    return this.http.get<Employee>(`${this.apiUrl}/employees/${id}/sensitive`);
  }

  createEmployee(body: SaveEmployee): Observable<Employee> {
    return this.http.post<Employee>(`${this.apiUrl}/employees`, body);
  }

  updateEmployee(id: string, body: Partial<SaveEmployee>): Observable<Employee> {
    return this.http.patch<Employee>(`${this.apiUrl}/employees/${id}`, body);
  }

  /** A soft delete: a person with payroll history is deactivated, never physically removed. */
  removeEmployee(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/employees/${id}`);
  }

  // ── Compensation ───────────────────────────────────────────────────────────

  /** The whole history, so a past payslip can still be explained by the salary it was computed on. */
  listCompensation(employeeId: string): Observable<EmployeeCompensation[]> {
    return this.http.get<EmployeeCompensation[]>(
      `${this.apiUrl}/employees/${employeeId}/compensation`,
    );
  }

  addCompensation(
    employeeId: string,
    body: { effectiveFrom: string; baseSalary: number; payFrequency?: PayFrequency; currencyCode?: string },
  ): Observable<EmployeeCompensation> {
    return this.http.post<EmployeeCompensation>(
      `${this.apiUrl}/employees/${employeeId}/compensation`,
      body,
    );
  }

  // ── Departments ────────────────────────────────────────────────────────────

  /** A plain array: departments are few and the endpoint does not page them. */
  listDepartments(): Observable<Department[]> {
    return this.http.get<Department[]>(`${this.apiUrl}/departments`);
  }

  createDepartment(body: { name: string; managerId?: string; costCenter?: string }): Observable<Department> {
    return this.http.post<Department>(`${this.apiUrl}/departments`, body);
  }

  updateDepartment(
    id: string,
    body: { name?: string; managerId?: string; costCenter?: string },
  ): Observable<Department> {
    return this.http.patch<Department>(`${this.apiUrl}/departments/${id}`, body);
  }

  removeDepartment(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/departments/${id}`);
  }
}
