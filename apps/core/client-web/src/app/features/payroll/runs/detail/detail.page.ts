import { FormatService, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ChangeDetectionStrategy, Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LucideAngularModule, Calculator, CheckCircle, Banknote, XCircle, Download, Plus, Trash2 } from 'lucide-angular';
import { Observable, catchError, forkJoin, of } from 'rxjs';
import { DocumentShellComponent, DocumentTone } from '../../../../shared/components/gestures';
import { NotificationService } from '../../../../core/services/notification';
import { DialogService } from '../../../../core/services/dialog.service';
import {
  PayrollConcept,
  PayrollInput,
  PayrollRun,
  PayrollService,
  Payslip,
} from '../../../../core/api/payroll.service';
import { Employee, HcmService } from '../../../../core/api/hcm.service';

/**
 * One payroll run, from draft to paid.
 *
 * ## The lifecycle, and why the buttons appear when they do
 *
 * A run is `DRAFT` while its variable inputs — overtime hours, a commission, a loan repayment —
 * are still being entered. `calculate` produces the payslips and the totals. `approve` **posts the
 * accounting entry**, and from that moment the run is immutable: a mistake found afterwards is
 * fixed by an adjustment run, never by rewriting what was already booked, which is the same rule
 * the ledger enforces on a posted entry. `pay` settles it through treasury.
 *
 * The screen shows only the transition that is actually available, because a button that fails when
 * pressed teaches the reader to distrust every other button on the page.
 *
 * ## The inputs grid
 *
 * Submitted as a whole set rather than row by row: the server replaces the run's inputs with what
 * it is sent, and a half-saved set is a payroll that is wrong in a way nobody can see.
 */
@Component({
  selector: 'app-payroll-run-detail-page',
  standalone: true,
  imports: [CommonModule, DocumentShellComponent, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './detail.page.html',
  styleUrls: ['./detail.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PayrollRunDetailPage implements OnInit {
  private readonly payroll = inject(PayrollService);
  private readonly hcm = inject(HcmService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  @Input() id?: string;

  protected readonly CalculateIcon = Calculator;
  protected readonly ApproveIcon = CheckCircle;
  protected readonly PayIcon = Banknote;
  protected readonly CancelIcon = XCircle;
  protected readonly ExportIcon = Download;
  protected readonly AddIcon = Plus;
  protected readonly RemoveIcon = Trash2;

  readonly run = signal<PayrollRun | null>(null);
  readonly payslips = signal<Payslip[]>([]);
  readonly inputs = signal<PayrollInput[]>([]);
  readonly concepts = signal<PayrollConcept[]>([]);
  readonly employees = signal<Employee[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly openPayslip = signal<string | null>(null);

  readonly status = computed(() => this.run()?.status ?? null);
  /** Set when the run could not be read at all, so the shell offers a retry instead of a blank. */
  readonly failed = signal(false);
  readonly editable = computed(() => this.status() === 'DRAFT');
  readonly canCalculate = computed(() => this.status() === 'DRAFT' || this.status() === 'CALCULATED');
  readonly canApprove = computed(() => this.status() === 'CALCULATED');
  readonly canPay = computed(() => this.status() === 'APPROVED');
  readonly canCancel = computed(() => this.status() === 'DRAFT' || this.status() === 'CALCULATED');
  readonly canExport = computed(
    () => this.status() === 'APPROVED' || this.status() === 'PAID',
  );

  /** `Nómina de septiembre 2026`, already composed — the shell takes a name, not a key. */
  readonly documentTitle = computed(() => this.run()?.name ?? '');

  /** The period and the kind of run, the two facts that qualify the name. */
  readonly documentSubtitle = computed(() => {
    const run = this.run();
    if (!run) return null;
    const period = `${this.formatDate(run.periodStart)} – ${this.formatDate(run.periodEnd)}`;
    return `${period} · ${this.translate.instant('payroll.runs.type_label.' + run.runType)}`;
  });

  readonly statusKey = computed(() =>
    this.status() ? `payroll.runs.status_label.${this.status()}` : null,
  );

  /**
   * Semantic, never decorative: `APPROVED` is the point of no return for the ledger, so it reads
   * as a warning rather than as a success until treasury has actually paid it.
   */
  readonly statusTone = computed<DocumentTone>(() => {
    switch (this.status()) {
      case 'DRAFT':
        return 'draft';
      case 'CALCULATED':
        return 'neutral';
      case 'APPROVED':
        return 'warning';
      case 'PAID':
        return 'ok';
      case 'CANCELLED':
        return 'danger';
      default:
        return 'neutral';
    }
  });

  /** Only concepts a person enters by hand: the statutory ones are computed, not typed. */
  readonly enterableConcepts = computed(() =>
    this.concepts().filter((concept) => concept.active && concept.calculation !== 'STATUTORY'),
  );

  private readonly employeeNames = computed(
    () => new Map(this.employees().map((e) => [e.id, `${e.lastName}, ${e.firstName}`])),
  );

  ngOnInit(): void {
    if (this.id) this.load(this.id);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  calculate(): void { this.act(this.payroll.calculate(this.id!)); }

  async approve(): Promise<void> {
    // Approving posts to the ledger and closes the run to edits. Worth asking once.
    const confirmed = await this.dialog.confirm({
      title: 'dialog.approve_payroll_run.title',
      message: 'dialog.approve_payroll_run.message',
      confirmText: 'payroll.runs.approve',
      variant: 'warning',
    });
    if (!confirmed) return;
    this.act(this.payroll.approve(this.id!));
  }

  pay(): void { this.act(this.payroll.pay(this.id!)); }

  async cancel(): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'dialog.cancel_payroll_run.title',
      message: 'dialog.cancel_payroll_run.message',
      confirmText: 'payroll.runs.cancel',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.act(this.payroll.cancel(this.id!));
  }

  back(): void {
    void this.router.navigate(['/payroll/runs']);
  }

  // ── Inputs ─────────────────────────────────────────────────────────────────

  addInput(): void {
    const employee = this.employees()[0];
    const concept = this.enterableConcepts()[0];
    if (!employee || !concept) {
      this.notifications.showError('payroll.runs.no_employees_or_concepts');
      return;
    }
    this.inputs.update((rows) => [
      ...rows,
      { employeeId: employee.id, conceptCode: concept.code, amount: 0 },
    ]);
  }

  setInput(index: number, patch: Partial<PayrollInput>): void {
    this.inputs.update((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  removeInput(index: number): void {
    this.inputs.update((rows) => rows.filter((_, i) => i !== index));
  }

  saveInputs(): void {
    this.busy.set(true);
    this.payroll.replaceInputs(this.id!, this.inputs()).subscribe({
      next: (rows) => {
        this.busy.set(false);
        this.inputs.set(rows);
        this.notifications.showSuccess('payroll.runs.inputs_saved');
      },
      error: (error: { error?: { message?: string } }) => this.fail(error),
    });
  }

  /** Which calculation a concept uses, so the grid shows hours or an amount, not both. */
  calculationOf(conceptCode: string): string {
    return this.concepts().find((concept) => concept.code === conceptCode)?.calculation ?? 'FIXED';
  }

  employeeName(employeeId: string): string {
    return this.employeeNames().get(employeeId) ?? employeeId.slice(0, 8);
  }

  // ── TSS ────────────────────────────────────────────────────────────────────

  /**
   * The SUIR flat file, downloaded as a file.
   *
   * It is what gets uploaded to the TSS portal, so it has to arrive as a file on disk rather than
   * as text on a screen somebody copies out of a browser.
   */
  downloadSuir(): void {
    this.payroll.suir(this.id!).subscribe({
      next: (text) => {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `SUIR-${this.run()?.periodYear}-${String(this.run()?.periodMonth).padStart(2, '0')}.txt`;
        anchor.click();
        URL.revokeObjectURL(url);
      },
      error: (error: { error?: { message?: string } }) => this.fail(error),
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  togglePayslip(id: string): void {
    this.openPayslip.update((current) => (current === id ? null : id));
  }

  private act(request: Observable<PayrollRun>): void {
    this.busy.set(true);
    request.subscribe({
      next: () => { this.busy.set(false); this.load(this.id!); },
      error: (error: { error?: { message?: string } }) => this.fail(error),
    });
  }

  reload(): void {
    if (this.id) this.load(this.id);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.failed.set(false);
    forkJoin({
      run: this.payroll.getRun(id).pipe(catchError(() => of(null))),
      payslips: this.payroll.payslips(id).pipe(catchError(() => of([] as Payslip[]))),
      inputs: this.payroll.listInputs(id).pipe(catchError(() => of([] as PayrollInput[]))),
      concepts: this.payroll.listConcepts().pipe(catchError(() => of([] as PayrollConcept[]))),
      employees: this.hcm.listEmployees({ pageSize: 500 }).pipe(catchError(() => of(null))),
    }).subscribe(({ run, payslips, inputs, concepts, employees }) => {
      this.run.set(run);
      this.payslips.set(payslips);
      this.inputs.set(inputs);
      this.concepts.set(concepts);
      this.employees.set(
        (employees?.rows ?? []).filter((employee) => employee.employmentStatus !== 'TERMINATED'),
      );
      this.loading.set(false);
      this.failed.set(!run);
    });
  }

  /** The same locale formatting the `vxDate` pipe applies, for a string built outside a template. */
  private formatDate(value: string | null | undefined): string {
    if (!value) return '';
    // `dateOnly`: a payroll period is a calendar range, not an instant, so it must not shift zone.
    return this.format.date(value, 'date', { dateOnly: true });
  }

  private fail(error: { error?: { message?: string } }): void {
    this.busy.set(false);
    const message = error?.error?.message;
    this.notifications.showError(
      typeof message === 'string' ? message : 'payroll.runs.action_failed',
    );
  }
}
