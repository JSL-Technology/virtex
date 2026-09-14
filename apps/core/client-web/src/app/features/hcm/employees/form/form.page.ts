import { ChangeDetectionStrategy, Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Eye } from 'lucide-angular';
import { catchError, of } from 'rxjs';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../../shared/components/gestures';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { NotificationService } from '../../../../core/services/notification';
import {
  Department,
  Employee,
  EmployeeCompensation,
  HcmService,
} from '../../../../core/api/hcm.service';
import { PayrollService, SeverancePreview } from '../../../../core/api/payroll.service';

/**
 * One person's record: who they are, what they are paid, and what leaving would cost.
 *
 * ## Three things this screen is careful about
 *
 * **The cédula and the bank account are not shown by default.** They are encrypted at rest and the
 * ordinary read returns them masked; the server has a separate, audited route for the real values.
 * Folding them into the page load would audit every visit as a disclosure and put a national id on
 * screen behind anybody's shoulder. So they are revealed on request, once, and the request is what
 * the audit trail records.
 *
 * **Pay is a history, not a field.** A raise adds a row with the date it takes effect; it does not
 * overwrite what a past payslip was computed on. The form reflects that: there is no "salary" input
 * to edit, only a new effective-dated entry to add.
 *
 * **Termination is previewed before it is decided.** What preaviso, cesantía, vacaciones and the
 * proportional regalía come to is a number the business needs *before* it commits, not after.
 */
@Component({
  selector: 'app-employee-form-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    LucideAngularModule,
    TranslateModule,
    ...FORMAT_PIPES,
    DraftShellComponent,
  ],
  templateUrl: './form.page.html',
  styleUrls: ['./form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeFormPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly hcm = inject(HcmService);
  private readonly payroll = inject(PayrollService);
  private readonly notifications = inject(NotificationService);

  @Input() id?: string;

  protected readonly RevealIcon = Eye;

  form!: FormGroup;
  readonly saving = signal(false);
  readonly current = signal<Employee | null>(null);
  readonly departments = signal<Department[]>([]);
  readonly compensation = signal<EmployeeCompensation[]>([]);
  readonly problems = signal<DraftProblem[]>([]);

  /** The unmasked cédula and bank account, once somebody asks for them. */
  readonly revealed = signal<Employee | null>(null);

  readonly isNew = computed(() => !this.current());
  readonly currentSalary = computed(() => this.compensation()[0] ?? null);

  // ── Adding a pay change ────────────────────────────────────────────────────
  readonly addingPay = signal(false);
  readonly payEffectiveFrom = signal(todayIso());
  readonly payAmount = signal(0);

  // ── Previewing a termination ───────────────────────────────────────────────
  readonly severanceDate = signal(todayIso());
  readonly severance = signal<SeverancePreview | null>(null);
  readonly severanceError = signal<string | null>(null);

  ngOnInit(): void {
    this.form = this.fb.group({
      firstName: ['', [Validators.required]],
      lastName: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      jobTitle: [''],
      departmentId: [''],
      hireDate: [''],
      identityDocument: [''],
      identityDocumentType: ['CEDULA'],
      bankName: [''],
      bankAccountNumber: [''],
      bankAccountType: [''],
      tssNss: [''],
      afpCode: [''],
      sfsCode: [''],
      employmentStatus: ['ACTIVE'],
      contractType: ['INDEFINITE'],
      terminationDate: [''],
    });

    this.hcm.listDepartments().pipe(catchError(() => of([] as Department[]))).subscribe(
      (departments) => this.departments.set(departments),
    );

    if (this.id) this.load(this.id);
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.problems.set(
        draftProblems(this.form, {
          firstName: 'hcm.employees.form.first_name',
          lastName: 'hcm.employees.form.last_name',
          email: 'hcm.employees.form.email',
        }),
      );
      return;
    }
    this.problems.set([]);

    const raw = this.form.getRawValue();
    // Empty strings are not values: sending `""` for an optional uuid or date is a validation
    // error the user cannot act on, and sending it for the cédula would overwrite a real one.
    const body = Object.fromEntries(
      Object.entries(raw).filter(([, value]) => value !== '' && value !== null),
    ) as Parameters<HcmService['createEmployee']>[0];

    this.saving.set(true);
    const request = this.current()
      ? this.hcm.updateEmployee(this.current()!.id, body)
      : this.hcm.createEmployee(body);

    request.subscribe({
      next: (employee) => {
        this.saving.set(false);
        this.notifications.showSuccess('hcm.employees.form.saved');
        this.load(employee.id);
      },
      error: (error: { error?: { message?: string } }) => this.fail(error),
    });
  }

  /** Ask the server for the real cédula and bank account. The request itself is audited. */
  reveal(): void {
    const employee = this.current();
    if (!employee) return;
    this.hcm.getSensitive(employee.id).subscribe({
      next: (full) => this.revealed.set(full),
      error: (error: { error?: { message?: string } }) => this.fail(error),
    });
  }

  addPay(): void {
    const employee = this.current();
    if (!employee || this.payAmount() <= 0) return;
    this.saving.set(true);
    this.hcm
      .addCompensation(employee.id, {
        effectiveFrom: this.payEffectiveFrom(),
        baseSalary: this.payAmount(),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.addingPay.set(false);
          this.payAmount.set(0);
          this.loadCompensation(employee.id);
        },
        error: (error: { error?: { message?: string } }) => this.fail(error),
      });
  }

  previewSeverance(): void {
    const employee = this.current();
    if (!employee) return;
    this.severanceError.set(null);
    this.payroll.previewSeverance(employee.id, { endDate: this.severanceDate() }).subscribe({
      next: (preview) => this.severance.set(preview),
      error: (error: { error?: { message?: string } }) => {
        this.severance.set(null);
        this.severanceError.set(error?.error?.message ?? 'hcm.employees.form.severance_failed');
      },
    });
  }

  cancel(): void {
    void this.router.navigate(['/hcm/employees']);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private load(id: string): void {
    this.hcm.getEmployee(id).subscribe({
      next: (employee) => {
        this.current.set(employee);
        this.revealed.set(null);
        this.form.patchValue(
          {
            firstName: employee.firstName,
            lastName: employee.lastName,
            email: employee.email,
            jobTitle: employee.jobTitle ?? '',
            departmentId: employee.departmentId ?? '',
            hireDate: employee.hireDate ?? '',
            // Masked: typing over it is how a user replaces it, and leaving it alone leaves it alone.
            identityDocument: '',
            identityDocumentType: employee.identityDocumentType,
            bankName: employee.bankName ?? '',
            bankAccountNumber: '',
            bankAccountType: employee.bankAccountType ?? '',
            tssNss: employee.tssNss ?? '',
            afpCode: employee.afpCode ?? '',
            sfsCode: employee.sfsCode ?? '',
            employmentStatus: employee.employmentStatus,
            contractType: employee.contractType,
            terminationDate: employee.terminationDate ?? '',
          },
          { emitEvent: false },
        );
        this.loadCompensation(id);
      },
      error: () => this.notifications.showError('hcm.employee_not_found'),
    });
  }

  private loadCompensation(employeeId: string): void {
    this.hcm.listCompensation(employeeId).pipe(catchError(() => of([] as EmployeeCompensation[]))).subscribe(
      (rows) =>
        // Newest first: the salary in force is the one anybody is looking for.
        this.compensation.set(
          [...rows].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
        ),
    );
  }

  private fail(error: { error?: { message?: string } }): void {
    this.saving.set(false);
    const message = error?.error?.message;
    this.notifications.showError(
      typeof message === 'string' ? message : 'hcm.employees.form.save_failed',
    );
  }
}

function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
