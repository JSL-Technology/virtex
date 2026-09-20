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
  IdentityDocumentTypeOption,
  StatutoryIdentifierTypeOption,
} from '../../../../core/api/hcm.service';
import { TranslateService } from '@ngx-translate/core';
import { PayrollService, SeverancePreview } from '../../../../core/api/payroll.service';
import { TAB_CONTEXT } from '../../../../core/tabs/tab-context';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxDateFieldComponent } from '../../../../shared/components/date';

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
    ...VX_FORM_A11Y, VxDateFieldComponent],
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
  private readonly translate = inject(TranslateService);
  /** La ventana que hospeda esta página, cuando la hay. Nula si la monta el router. */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  @Input() id?: string;

  protected readonly RevealIcon = Eye;

  form!: FormGroup;
  readonly saving = signal(false);
  readonly current = signal<Employee | null>(null);
  readonly departments = signal<Department[]>([]);
  readonly compensation = signal<EmployeeCompensation[]>([]);
  readonly problems = signal<DraftProblem[]>([]);

  /**
   * The identity documents this tenant's country issues, from the server.
   *
   * The template used to name three of them itself. Empty until the request lands, which renders
   * an empty `<select>` for a moment — correct, and preferable to showing an option the tenant's
   * country does not issue and the server will refuse.
   */
  readonly documentTypes = signal<IdentityDocumentTypeOption[]>([]);

  /** The employee columns a statutory identifier can bind to directly; anything else is an enrolment key. */
  private static readonly STATUTORY_COLUMNS = [
    'socialSecurityNumber',
    'pensionFundCode',
    'healthFundCode',
  ] as const;

  /**
   * The statutory (social-security) identifiers this tenant's country asks for, from the server.
   *
   * The template used to name three of them itself — a Dominican NSS, AFP and SFS. Empty until the
   * request lands, or when the market's payroll rules are not modelled, in which case
   * {@link statutoryFields} falls back to those same three, unconstrained.
   */
  readonly statutoryTypes = signal<StatutoryIdentifierTypeOption[]>([]);

  /**
   * The statutory fields to render: the country's declared specs, or — for a market with no
   * modelled payroll rules — the three neutral columns with no per-country shape.
   */
  readonly statutoryFields = computed<StatutoryIdentifierTypeOption[]>(() => {
    const declared = this.statutoryTypes();
    if (declared.length > 0) return declared;
    return [
      { field: 'socialSecurityNumber', labelKey: 'hcm.employees.form.social_security_number', pattern: null, required: false },
      { field: 'pensionFundCode', labelKey: 'hcm.employees.form.pension_fund_code', pattern: null, required: false },
      { field: 'healthFundCode', labelKey: 'hcm.employees.form.health_fund_code', pattern: null, required: false },
    ];
  });

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
      // No default. `'CEDULA'` used to stand here, so a Chilean employee form opened preselecting
      // a Dominican document. The catalogue names its own default per country and `applyDocumentTypes`
      // applies it once the list arrives.
      identityDocumentType: [''],
      bankName: [''],
      bankAccountNumber: [''],
      bankAccountType: [''],
      socialSecurityNumber: [''],
      pensionFundCode: [''],
      healthFundCode: [''],
      employmentStatus: ['ACTIVE'],
      contractType: ['INDEFINITE'],
      terminationDate: [''],
    });

    this.hcm.listDepartments().pipe(catchError(() => of([] as Department[]))).subscribe(
      (departments) => this.departments.set(departments),
    );

    this.hcm
      .listIdentityDocumentTypes()
      .pipe(catchError(() => of([] as IdentityDocumentTypeOption[])))
      .subscribe((types) => this.applyDocumentTypes(types));

    this.hcm
      .listStatutoryIdentifierTypes()
      .pipe(catchError(() => of([] as StatutoryIdentifierTypeOption[])))
      .subscribe((types) => this.applyStatutoryTypes(types));

    // The document's shape check — and, on a new employee, whether it is required — follows the
    // selected type, so it is re-applied whenever the type changes.
    this.form
      .get('identityDocumentType')
      ?.valueChanges.subscribe(() => this.syncDocumentValidators());

    if (this.id) this.load(this.id);
  }

  // ── Identity document ──────────────────────────────────────────────────────

  /**
   * Adopt the catalogue and preselect the country's own default.
   *
   * Only when nothing is selected yet, so loading an existing employee never silently rewrites the
   * document type they were recorded with — which would be a data change disguised as a render.
   */
  private applyDocumentTypes(types: IdentityDocumentTypeOption[]): void {
    this.documentTypes.set(types);
    const control = this.form.get('identityDocumentType');
    if (control && !control.value) {
      const preset = types.find((type) => type.isDefault) ?? types[0];
      if (preset) control.setValue(preset.code, { emitEvent: false });
    }
    this.syncDocumentValidators();
  }

  /**
   * Adopt the country's statutory-identifier specs.
   *
   * A spec that is not one of the three base columns gets a control added for it, so a market that
   * asks for a fourth identifier renders and posts it without this component naming it. Each field's
   * shape and requiredness mirror the spec the server validates against — these values are returned
   * in the clear (unlike the cédula), so requiredness applies whether creating or editing.
   */
  private applyStatutoryTypes(types: StatutoryIdentifierTypeOption[]): void {
    const columns = EmployeeFormPage.STATUTORY_COLUMNS as readonly string[];
    for (const spec of types) {
      if (!columns.includes(spec.field) && !this.form.get(spec.field)) {
        this.form.addControl(spec.field, this.fb.control(''));
      }
      const control = this.form.get(spec.field);
      if (!control) continue;
      const validators = [
        ...(spec.pattern ? [Validators.pattern(new RegExp(spec.pattern))] : []),
        ...(spec.required ? [Validators.required] : []),
      ];
      control.setValidators(validators);
      control.updateValueAndValidity({ emitEvent: false });
    }
    this.statutoryTypes.set(types);
  }

  /**
   * Apply the selected document's shape to the document field, and require it on a NEW employee
   * whose country marks the payroll document `required` (A-06 / B-01).
   *
   * It is deliberately NOT required when editing: the field loads blank because the stored value is
   * masked, and typing over it is how it is replaced — a required validator there would block
   * editing a job title without re-keying the cédula. The server enforces the requirement on create
   * regardless (`resolveParty({ enforceRequirement: true })`); this only mirrors it in the form so
   * the feedback is immediate. The check digit stays the server's; the pattern is shape only.
   */
  private syncDocumentValidators(): void {
    const control = this.form?.get('identityDocument');
    if (!control) return;
    const selected = this.form?.get('identityDocumentType')?.value as string | undefined;
    const type = this.documentTypes().find((option) => option.code === selected);
    const validators = type ? [Validators.pattern(new RegExp(type.pattern))] : [];
    if (this.isNew() && type?.requirement === 'required') validators.push(Validators.required);
    control.setValidators(validators);
    control.updateValueAndValidity({ emitEvent: false });
  }

  /**
   * What to call a document on screen.
   *
   * `labelVerbatim` wins where the catalogue sets it: "CUIT", "CURP" and "Ubigeo" are the words
   * printed on the paper the user is copying from, and a translated gloss makes them harder to
   * find, not easier. Everything else goes through the catalogue key.
   */
  documentLabel(type: IdentityDocumentTypeOption): string {
    return type.labelVerbatim ?? this.translate.instant(type.labelKey);
  }

  /**
   * The document input's placeholder.
   *
   * For an existing employee it is the masked (or revealed) stored value, because typing over it is
   * how the value is replaced. For a new one it is the selected type's example — the shape a
   * Colombian cédula takes, rather than the shape a Dominican one does.
   */
  documentPlaceholder(): string {
    const employee = this.current();
    if (employee) {
      return this.revealed()?.identityDocument ?? employee.identityDocument ?? '\u2022\u2022\u2022';
    }
    const selected = this.form?.get('identityDocumentType')?.value as string | undefined;
    return this.documentTypes().find((type) => type.code === selected)?.example ?? '';
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

    // A statutory identifier the country declares beyond the three base columns travels under
    // `statutoryEnrolment`, keyed by the spec's field — the shape the server reads it in, and the
    // one place an unknown top-level key would otherwise be rejected.
    const columns = EmployeeFormPage.STATUTORY_COLUMNS as readonly string[];
    const extraKeys = this.statutoryTypes()
      .map((spec) => spec.field)
      .filter((field) => !columns.includes(field));
    if (extraKeys.length > 0) {
      const record = body as Record<string, unknown>;
      const enrolment: Record<string, string> = {};
      for (const key of extraKeys) {
        const value = record[key];
        if (typeof value === 'string' && value !== '') enrolment[key] = value;
        delete record[key];
      }
      if (Object.keys(enrolment).length > 0) record['statutoryEnrolment'] = enrolment;
    }

    this.saving.set(true);
    const request = this.current()
      ? this.hcm.updateEmployee(this.current()!.id, body)
      : this.hcm.createEmployee(body);

    const creating = !this.current();

    request.subscribe({
      next: (employee) => {
        this.saving.set(false);
        this.notifications.showSuccess('hcm.employees.form.saved');

        /**
         * Un empleado recién creado deja de ser «Nuevo empleado».
         *
         * La ventana, su título y la barra de direcciones pasan al registro; el formulario se
         * vuelve a montar sobre él, así que no hace falta recargarlo aquí. Mientras la URL se
         * quedaba en `/hcm/employees/new`, recargar después de guardar devolvía un formulario
         * vacío que parecía el trabajo sin guardar de quien lo miraba.
         */
        if (creating && this.tab) {
          this.tab.replaceRoute(`/hcm/employees/${employee.id}/edit`, {
            title: `${employee.firstName} ${employee.lastName}`.trim(),
          });
          return;
        }

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
            identityDocumentType: employee.identityDocumentTypeCode ?? '',
            bankName: employee.bankName ?? '',
            bankAccountNumber: '',
            bankAccountType: employee.bankAccountType ?? '',
            socialSecurityNumber: employee.socialSecurityNumber ?? '',
            pensionFundCode: employee.pensionFundCode ?? '',
            healthFundCode: employee.healthFundCode ?? '',
            employmentStatus: employee.employmentStatus,
            contractType: employee.contractType,
            terminationDate: employee.terminationDate ?? '',
          },
          { emitEvent: false },
        );

        /**
         * El formulario vuelve a estar limpio, y el encabezado tiene que decirlo.
         *
         * `patchValue` no toca el estado sucio: lo pone el usuario al escribir y solo lo quita
         * quien lo pida. Nadie lo pedía, así que tras un guardado correcto —con el aviso de
         * «Guardado» todavía en pantalla— la cabecera seguía diciendo «Sin guardar». Un indicador
         * que miente sobre trabajo pendiente es peor que no tenerlo: enseña a ignorarlo, y lo que
         * se ignora la próxima vez es el aviso verdadero.
         */
        this.form.markAsPristine();
        this.tab?.markClean();

        // Now editing an existing record: the document field is masked-blank and typing over it is
        // how it is replaced, so it must not be required. Re-sync to drop the create-time required.
        this.syncDocumentValidators();

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
