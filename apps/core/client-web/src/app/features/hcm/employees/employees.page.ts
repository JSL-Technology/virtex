import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, UserPlus } from 'lucide-angular';
import { forkJoin, catchError, of } from 'rxjs';
import { ListShellComponent } from '../../../shared/components/gestures';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import {
  Department,
  Employee,
  EmploymentStatus,
  HcmService,
} from '../../../core/api/hcm.service';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';

/** Qué significa la situación de un empleado. El color lo pone `vx-badge`, una vez. */
const STATUS_TONE: Record<EmploymentStatus, VxTone> = {
  ACTIVE: 'ok',
  SUSPENDED: 'warning',
  TERMINATED: 'danger',
};

/**
 * The employee register.
 *
 * ## What existed
 *
 * Nothing reachable. Fourteen HCM endpoints — the register, the encrypted fiscal identity, the
 * versioned pay history, the departments — had been live since the payroll module shipped, and the
 * only HR screen in the product was a placeholder reading "Employee records, payroll, and
 * performance management" over an empty page, in English, whatever language the reader had chosen.
 * A tenant could run payroll through a REST client and nowhere else.
 */
@Component({
  selector: 'app-employees-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent],
  templateUrl: './employees.page.html',
  styleUrls: ['./employees.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeesPage {
  private readonly hcm = inject(HcmService);

  protected readonly AddIcon = UserPlus;

  readonly employees = signal<Employee[]>([]);
  readonly departments = signal<Department[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly search = signal('');
  /** Terminated people stay in the register for history; showing them by default buries the team. */
  readonly includeInactive = signal(false);

  readonly visible = computed(() => {
    const term = this.search().trim().toLowerCase();
    return this.employees()
      .filter((employee) => this.includeInactive() || employee.employmentStatus !== 'TERMINATED')
      .filter(
        (employee) =>
          !term ||
          `${employee.firstName} ${employee.lastName}`.toLowerCase().includes(term) ||
          (employee.email ?? '').toLowerCase().includes(term) ||
          (employee.jobTitle ?? '').toLowerCase().includes(term),
      );
  });

  private readonly departmentNames = computed(
    () => new Map(this.departments().map((department) => [department.id, department.name])),
  );

  constructor() {
    forkJoin({
      employees: this.hcm.listEmployees({ pageSize: 200 }).pipe(catchError(() => of(null))),
      departments: this.hcm.listDepartments().pipe(catchError(() => of([] as Department[]))),
    }).subscribe(({ employees, departments }) => {
      this.employees.set(employees?.rows ?? []);
      this.departments.set(departments);
      this.loading.set(false);
      this.failed.set(employees === null);
    });
  }

  departmentOf(employee: Employee): string {
    return employee.departmentId ? this.departmentNames().get(employee.departmentId) ?? '—' : '—';
  }

  statusTone(status: EmploymentStatus): VxTone {
    return STATUS_TONE[status] ?? 'neutral';
  }
}
