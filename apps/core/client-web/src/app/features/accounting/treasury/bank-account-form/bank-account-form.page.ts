import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule, ChevronLeft } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
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
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    LucideAngularModule,
    TranslateModule,
    ...FORMAT_PIPES,
  ],
  templateUrl: './bank-account-form.page.html',
  styleUrls: ['./bank-account-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BankAccountFormPage implements OnInit {
  protected readonly BackIcon = ChevronLeft;

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
      notes: [''],
      isActive: [true],
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

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notifications.showError('TREASURY.FORM.COMPLETE_LOS_CAMPOS_REQUERIDOS');
      return;
    }

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
        notes: raw.notes || null,
      })
      .subscribe(done);
  }
}
