import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../../shared/components/gestures';
import { FORMAT_PIPES } from '../../../../core/i18n/pipes/format.pipes';
import { TreasuryService } from '../../../../core/api/treasury.service';
import { ChartOfAccountsApiService } from '../../../../core/api/chart-of-accounts.service';
import { CurrenciesService } from '../../../../core/api/currencies.service';
import { NotificationService } from '../../../../core/services/notification';
import { Account } from '../../../../core/models/account.model';

/**
 * Registering a bank account.
 *
 * ## Why this page had to exist
 *
 * Nothing could create one. The entity is new, and every other part of the finance module now
 * depends on it: a supplier payment leaves a bank account, a customer receipt lands in one, a
 * transfer moves between two, and a bank statement belongs to one. Without this form the whole
 * settlement and reconciliation surface is unreachable — correct, and unusable.
 *
 * The control account is restricted to accounts that can actually take a movement. A summary
 * account cannot, and the server refuses it; offering it here would only produce an error the
 * user cannot act on.
 */
@Component({
  selector: 'app-bank-account-form-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslateModule,
    ...FORMAT_PIPES,
    DraftShellComponent,
  ],
  templateUrl: './bank-account-form.page.html',
  styleUrls: ['./bank-account-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BankAccountFormPage implements OnInit {

  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly treasury = inject(TreasuryService);
  private readonly accounts = inject(ChartOfAccountsApiService);
  private readonly currencies = inject(CurrenciesService);
  private readonly notifications = inject(NotificationService);

  form!: FormGroup;
  readonly bankAccountId = signal<string | null>(null);
  readonly isEditMode = computed(() => this.bankAccountId() !== null);
  readonly saving = signal(false);
  readonly postableAccounts = signal<Account[]>([]);
  readonly currencyCodes = signal<string[]>([]);
  /** What the opening balance's counterpart can be: equity, normally opening-balance equity. */
  readonly equityAccounts = computed(() =>
    this.postableAccounts().filter((account) => account.type === 'EQUITY'),
  );
  /** Whether the form is declaring a balance at all — the extra fields only matter then. */
  readonly declaresOpeningBalance = signal(false);

  ngOnInit(): void {
    this.form = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(120)]],
      bankName: ['', [Validators.maxLength(120)]],
      accountNumber: ['', [Validators.maxLength(60)]],
      iban: ['', [Validators.maxLength(34)]],
      swiftBic: ['', [Validators.maxLength(11)]],
      accountType: ['CHECKING', [Validators.required]],
      currencyCode: ['', [Validators.required]],
      glAccountId: ['', [Validators.required]],
      openingBalance: [0],
      openingDate: [''],
      // Required whenever a balance is declared, and deliberately not defaulted: posting an
      // opening balance to retained earnings because nobody chose an account misstates retained
      // earnings, and which account it belongs in is the accountant's decision.
      openingBalanceAccountId: [''],
      notes: [''],
      isActive: [true],
    });

    this.form.get('openingBalance')?.valueChanges.subscribe((value) => {
      const declares = Math.abs(Number(value) || 0) > 0;
      this.declaresOpeningBalance.set(declares);
      const date = this.form.get('openingDate');
      const counterpart = this.form.get('openingBalanceAccountId');
      for (const control of [date, counterpart]) {
        if (!control) continue;
        if (declares) control.addValidators(Validators.required);
        else {
          control.removeValidators(Validators.required);
          control.setValue('', { emitEvent: false });
        }
        control.updateValueAndValidity({ emitEvent: false });
      }
    });

    this.accounts.getAccounts().subscribe({
      next: (all) => this.postableAccounts.set(all.filter((account) => account.isPostable)),
      error: () => this.postableAccounts.set([]),
    });
    this.currencies.getCurrencies().subscribe({
      next: (all) => this.currencyCodes.set(all.map((currency) => currency.code)),
      error: () => this.currencyCodes.set([]),
    });

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.bankAccountId.set(id);
      this.treasury.findBankAccount(id).subscribe({
        next: (account) => {
          this.form.patchValue(account);
          // Both were measured against every movement already posted, so neither can move.
          this.form.get('currencyCode')?.disable();
          this.form.get('glAccountId')?.disable();
        },
        error: () => this.notifications.showError('TREASURY.FORM.NO_SE_PUDO_CARGAR'),
      });
    }
  }

  /** Qué falta antes de guardar. Los campos no llevan `id`; el armazón los localiza por control. */
  readonly problems = signal<DraftProblem[]>([]);

  cancel(): void {
    void this.router.navigate(['../..'], { relativeTo: this.route });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.problems.set(
        draftProblems(this.form, {
          name: 'TREASURY.FORM.NOMBRE',
          bankName: 'TREASURY.BANCO',
          accountNumber: 'TREASURY.NUMERO',
          accountType: 'TREASURY.FORM.TIPO',
          currencyCode: 'TREASURY.MONEDA',
          glAccountId: 'TREASURY.FORM.CUENTA_CONTABLE',
          openingBalance: 'TREASURY.FORM.SALDO_INICIAL',
          openingDate: 'TREASURY.FORM.FECHA_APERTURA',
          openingBalanceAccountId: 'TREASURY.FORM.CUENTA_CONTRAPARTIDA',
          iban: 'TREASURY.FORM.IBAN',
          swiftBic: 'TREASURY.FORM.SWIFT_BIC',
          notes: 'TREASURY.FORM.NOTAS',
          isActive: 'TREASURY.FORM.ACTIVA',
        }),
      );
      return;
    }

    this.problems.set([]);

    this.saving.set(true);
    const raw = this.form.getRawValue();
    const id = this.bankAccountId();

    const done = {
      next: () => {
        this.notifications.showSuccess(
          id ? 'TREASURY.FORM.CUENTA_ACTUALIZADA' : 'TREASURY.FORM.CUENTA_CREADA',
        );
        this.router.navigate(['../..'], { relativeTo: this.route });
      },
      error: (error: { error?: { message?: string } }) => {
        this.saving.set(false);
        const message = error?.error?.message;
        this.notifications.showError(
          typeof message === 'string' ? message : 'TREASURY.FORM.NO_SE_PUDO_GUARDAR',
        );
      },
    };

    if (id) {
      this.treasury
        .updateBankAccount(id, {
          name: raw.name,
          bankName: raw.bankName || null,
          accountNumber: raw.accountNumber || null,
          iban: raw.iban || null,
          swiftBic: raw.swiftBic || null,
          accountType: raw.accountType,
          notes: raw.notes || null,
          isActive: raw.isActive,
        })
        .subscribe(done);
      return;
    }

    this.treasury
      .createBankAccount({
        name: raw.name,
        bankName: raw.bankName || null,
        accountNumber: raw.accountNumber || null,
        iban: raw.iban || null,
        swiftBic: raw.swiftBic || null,
        accountType: raw.accountType,
        currencyCode: raw.currencyCode,
        glAccountId: raw.glAccountId,
        openingBalance: Number(raw.openingBalance) || 0,
        openingDate: raw.openingDate || null,
        openingBalanceAccountId: raw.openingBalanceAccountId || null,
        notes: raw.notes || null,
      })
      .subscribe(done);
  }
}
