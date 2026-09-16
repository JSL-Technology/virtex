import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type EmploymentStatus = 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';
export type ContractType = 'INDEFINITE' | 'FIXED_TERM' | 'OCCASIONAL';
export type IdentityDocumentType = 'CEDULA' | 'PASSPORT' | 'RNC';
export type PayFrequency = 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY';

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
  identityDocumentType: IdentityDocumentType;
  bankName: string | null;
  bankAccountNumber?: string | null;
  bankAccountType: string | null;
  tssNss: string | null;
  afpCode: string | null;
  sfsCode: string | null;
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
