import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../../shared/components/gestures';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { TreasuryService } from '../../../../core/api/treasury.service';
import { ChartOfAccountsApiService } from '../../../../core/api/chart-of-accounts.service';
import { CurrenciesService } from '../../../../core/api/currencies.service';
import { NotificationService } from '../../../../core/services/notification';
import { Account } from '../../../../core/models/account.model';
import { moneyLedgerAccounts } from '../../../../core/services/account-selection';
import { bicValidator, ibanValidator } from '../../../../shared/validators/bank-identifiers.validator';
import { TAB_CONTEXT } from '../../../../core/tabs/tab-context';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxDateFieldComponent } from '../../../../shared/components/date';

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
    ...VX_FORM_A11Y, VxDateFieldComponent],
  templateUrl: './bank-account-form.page.html',
  styleUrls: ['./bank-account-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BankAccountFormPage implements OnInit {
  /** La ventana que hospeda esta página, cuando la hay. Nula si la monta el router. */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

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
  /** Every account in the chart, for the two pickers that each take their own slice of it. */
  private readonly allAccounts = signal<Account[]>([]);
  /** Money accounts: where the bank account's movements are posted. */
  readonly postableAccounts = computed(() => moneyLedgerAccounts(this.allAccounts()));
  readonly currencyCodes = signal<string[]>([]);
  /**
   * What the opening balance's counterpart can be: equity, normally opening-balance equity.
   *
   * It filtered the MONEY accounts for equity — a list that can never contain any — so the
   * picker was always empty and no bank account could be opened with a balance (QA A-06). It reads
   * the whole chart now.
   */
  readonly equityAccounts = computed(() =>
    this.allAccounts().filter(
      (account) => account.type === 'EQUITY' && account.isPostable && account.isActive !== false,
    ),
  );
  /** Whether the form is declaring a balance at all — the extra fields only matter then. */
  readonly declaresOpeningBalance = signal(false);

  ngOnInit(): void {
    this.form = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(120)]],
      bankName: ['', [Validators.maxLength(120)]],
      accountNumber: ['', [Validators.maxLength(60)]],
      iban: ['', [Validators.maxLength(34), ibanValidator]],
      swiftBic: ['', [Validators.maxLength(11), bicValidator]],
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
      //  `setValidators`/`clearValidators`, not add/remove: the pair was left requiring a value
      //  after the balance went back to 0, so the form could not be saved (QA A-06).
      for (const control of [date, counterpart]) {
        if (!control) continue;
        if (declares) {
          control.setValidators([Validators.required]);
        } else {
          control.clearValidators();
          control.setValue('', { emitEvent: false });
          control.markAsUntouched();
        }
        control.updateValueAndValidity();
      }
      if (declares) {
        const today = new Date().toISOString().slice(0, 10);
        if (date && !date.value) date.setValue(today);
        //  Opening-balance equity is THE account for this, which is why the chart carries a role
        //  for it. Preselected, never retained earnings.
        const opening = this.allAccounts().find((account) => account.systemRole === 'OPENING_BALANCE_EQUITY');
        if (counterpart && !counterpart.value && opening) counterpart.setValue(opening.id);
      }
      this.form.updateValueAndValidity();
    });

    // Money accounts only. `isPostable` alone offered every postable account in the chart, so a
    // bank account could be mapped onto Accounts Receivable — after which every deposit would have
    // debited what customers owe us.
    this.accounts.getAccounts().subscribe({
      next: (all) => {
        this.allAccounts.set(all);
        //  Una cuenta de dinero sola: se preselecciona en vez de hacer elegir lo obvio.
        const money = this.postableAccounts();
        const control = this.form.get('glAccountId');
        if (control && !control.value && money.length === 1 && !this.isEditMode()) control.setValue(money[0].id);
      },
      error: () => this.allAccounts.set([]),
    });
    this.currencies.getCurrencies().subscribe({
      next: (all) => this.currencyCodes.set(all.map((currency) => currency.code)),
      error: () => this.currencyCodes.set([]),
    });
    //  The books' currency by default (QA A-06): the field started empty and most bank accounts
    //  are in the currency the company keeps its books in.
    this.treasury.cashPosition().subscribe({
      next: (position) => {
        const control = this.form.get('currencyCode');
        if (control && !control.value && !this.isEditMode()) control.setValue(position.baseCurrency);
      },
      error: () => undefined,
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
        error: () => this.notifications.showError('treasury.form.bank_account_could_not_loaded'),
      });
    }
  }

  /** Qué falta antes de guardar. Los campos no llevan `id`; el armazón los localiza por control. */
  readonly problems = signal<DraftProblem[]>([]);

  cancel(): void {
    void this.router.navigate(['/accounting/treasury']);
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.problems.set(
        draftProblems(this.form, {
          name: 'treasury.form.name',
          bankName: 'treasury.bank',
          accountNumber: 'treasury.number',
          accountType: 'treasury.form.account_type',
          currencyCode: 'treasury.currency',
          glAccountId: 'treasury.form.ledger_account',
          openingBalance: 'treasury.form.opening_balance',
          openingDate: 'treasury.form.opening_date',
          openingBalanceAccountId: 'treasury.form.counterpart_account',
          iban: 'treasury.form.iban',
          swiftBic: 'treasury.form.swift_bic',
          notes: 'treasury.form.notes',
          isActive: 'treasury.form.active_account',
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
          id ? 'treasury.form.bank_account_updated' : 'treasury.form.bank_account_created',
        );
        //  Esta ventana ya cumplió: el registro existe y la página se va a la lista. Si se dejara
        //  abierta seguiría anunciándose como «el formulario nuevo», y el siguiente clic en «Nuevo»
        //  la enfocaría con el documento ya guardado dentro. Ver `TabContext.close`.
        void this.router.navigate(['/accounting/treasury']).then(() => this.tab?.close());
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notifications.showHttpError(error, 'treasury.form.bank_account_could_not_saved');
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
