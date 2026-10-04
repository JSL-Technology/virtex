import { ChangeDetectionStrategy, Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { TreasuryService } from '../../../../core/api/treasury.service';
import { NotificationService } from '../../../../core/services/notification';
import { TAB_CONTEXT } from '../../../../core/tabs/tab-context';
import { DraftProblem, DraftShellComponent, draftProblems } from '../../../../shared/components/gestures';
import { bicValidator } from '../../../../shared/validators/bank-identifiers.validator';

/**
 * One institution in the bank catalogue.
 *
 * A changed name or BIC is carried by the server onto every account held at the bank, so editing
 * here is how a bank's details are corrected everywhere at once. Changing it asks for the same
 * step-up as editing an account number, because payments are routed by the BIC.
 */
@Component({
  selector: 'app-bank-form-page',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, DraftShellComponent, ...VX_FORM_A11Y],
  templateUrl: './bank-form.page.html',
  styleUrls: ['./bank-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BankFormPage implements OnInit {
  private readonly tab = inject(TAB_CONTEXT, { optional: true });
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly treasury = inject(TreasuryService);
  private readonly notifications = inject(NotificationService);
  private readonly locale = inject(LocaleStore);

  /** From the route, when editing. */
  @Input() id?: string;

  form!: FormGroup;
  readonly isEditMode = signal(false);
  readonly saving = signal(false);
  readonly problems = signal<DraftProblem[]>([]);

  ngOnInit(): void {
    this.form = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(120)]],
      swiftBic: ['', [Validators.maxLength(11), bicValidator]],
      // The tenant's own country as the starting point: most of its banks are local.
      countryCode: [this.locale.tenantContext()?.countryCode ?? '', [Validators.pattern(/^[A-Za-z]{2}$/)]],
      localCode: ['', [Validators.maxLength(20)]],
      isActive: [true],
    });

    if (this.id) {
      this.isEditMode.set(true);
      this.treasury.findBank(this.id).subscribe({
        next: (bank) => {
          this.form.patchValue({
            name: bank.name,
            swiftBic: bank.swiftBic ?? '',
            countryCode: bank.countryCode ?? '',
            localCode: bank.localCode ?? '',
            isActive: bank.isActive,
          });
          this.form.markAsPristine();
        },
        error: (error: unknown) => this.notifications.showHttpError(error, 'masters.banks.load_failed'),
      });
    }
  }

  cancel(): void {
    void this.router.navigate(['/masters/banks']);
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.problems.set(
        draftProblems(this.form, {
          name: 'masters.banks.bank_name',
          swiftBic: 'masters.banks.swift_code',
          countryCode: 'masters.banks.country',
          localCode: 'masters.banks.local_code',
        }),
      );
      return;
    }
    this.problems.set([]);
    this.saving.set(true);

    const raw = this.form.getRawValue();
    const body = {
      name: String(raw.name).trim(),
      swiftBic: raw.swiftBic ? String(raw.swiftBic).trim().toUpperCase() : null,
      countryCode: raw.countryCode ? String(raw.countryCode).toUpperCase() : null,
      localCode: raw.localCode ? String(raw.localCode).trim() : null,
    };
    const request = this.id
      ? this.treasury.updateBank(this.id, { ...body, isActive: raw.isActive })
      : this.treasury.createBank(body);

    request.subscribe({
      next: () => {
        this.notifications.showSuccess(this.id ? 'masters.banks.updated' : 'masters.banks.created');
        //  This window has done its job: the record exists and the list is where it now lives.
        void this.router.navigate(['/masters/banks']).then(() => this.tab?.close());
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notifications.showHttpError(error, 'masters.banks.save_failed');
      },
    });
  }
}
