import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, map, startWith } from 'rxjs';
import { TranslateModule, LocaleStore } from '@virtex/shared/ui-i18n';
import { DEPRECIATION_CONVENTIONS, type DepreciationConvention, type LocalizedName } from '@virtex/shared/types';
import { VX_FORM_A11Y } from '@virtex/shared/ui-a11y';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { VX_SELECT } from '../../../shared/components/select';
import { VxNameTranslationsComponent } from '../../../shared/components/name-translations';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import {
  accumulatedDepreciationAccounts,
  depreciationExpenseAccounts,
  disposalResultAccounts,
  fixedAssetCostAccounts,
} from '../../../core/services/account-selection';
import { Account } from '../../../core/models/account.model';
import {
  DEPRECIATION_METHODS,
  DepreciationMethod,
  FixedAssetCategory,
  FixedAssetCategoryInput,
  FixedAssetsService,
  TAX_DEPRECIATION_METHODS,
  TaxCategoryCatalogue,
  TaxDepreciationMethod,
  asPercent,
  asRate,
} from '../data/fixed-assets.service';

/** What a category code may hold: the server's rule, said before the save. */
const CODE_PATTERN = /^\s*[A-Za-z0-9][A-Za-z0-9_.-]*\s*$/;

/**
 * A category of fixed assets (audit 2026-11-07, FINB-16): its name in every language, what an
 * asset of it starts with — life, method and rate, convention, residual share, accounts — and the
 * tax category its tax book follows, at the authority's rate unless the company states its own.
 *
 * The assets registered in a category keep what they were registered with: editing it changes the
 * next ones.
 */
@Component({
  selector: 'app-fixed-asset-category-form-page',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, ...VX_FORM_A11Y, ...VX_SELECT, DraftShellComponent, VxNameTranslationsComponent],
  templateUrl: './fixed-asset-category-form.page.html',
  styleUrls: ['../../../shared/styles/document-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixedAssetCategoryFormPage implements OnInit {
  protected readonly locale = inject(LocaleStore);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly assets = inject(FixedAssetsService);
  private readonly accounts = inject(ChartOfAccountsApiService);
  private readonly notifications = inject(NotificationService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  /** Present when editing. */
  readonly id = input<string>();

  protected readonly methods = DEPRECIATION_METHODS;
  protected readonly taxMethods = TAX_DEPRECIATION_METHODS;
  protected readonly conventions = DEPRECIATION_CONVENTIONS;

  readonly form = this.fb.group({
    code: ['', [Validators.required, Validators.maxLength(40), Validators.pattern(CODE_PATTERN)]],
    name: ['', [Validators.required, Validators.maxLength(200)]],
    nameTranslations: this.fb.control<LocalizedName>({}),
    description: ['', [Validators.maxLength(2000)]],
    usefulLifeMonths: [null as number | null, [Validators.min(1), Validators.max(1200)]],
    /** Empty: the asset states it. */
    depreciationMethod: ['' as DepreciationMethod | ''],
    decliningRatePercent: [null as number | null, [Validators.min(0.0001), Validators.max(100)]],
    /** Empty: the company's convention. */
    depreciationConvention: ['' as DepreciationConvention | ''],
    residualPercent: [0 as number | null, [Validators.min(0), Validators.max(99.9999)]],
    assetAccountId: [null as string | null],
    accumulatedDepreciationAccountId: [null as string | null],
    depreciationExpenseAccountId: [null as string | null],
    gainOnDisposalAccountId: [null as string | null],
    lossOnDisposalAccountId: [null as string | null],
    /** The market's tax category, or empty: none, or the company's own rate below. */
    taxCategoryCode: [''],
    taxMethod: ['' as TaxDepreciationMethod | ''],
    taxRatePercent: [null as number | null, [Validators.min(0.0001), Validators.max(100)]],
    isActive: [true],
  });

  readonly current = signal<FixedAssetCategory | null>(null);
  readonly catalogue = signal<TaxCategoryCatalogue | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly problems = signal<DraftProblem[]>([]);

  private readonly method = toSignal(
    this.form.controls.depreciationMethod.valueChanges.pipe(startWith(this.form.controls.depreciationMethod.value)),
    { initialValue: '' as DepreciationMethod | '' },
  );
  readonly declining = computed(() => this.method() === 'DECLINING_BALANCE');

  private readonly taxCode = toSignal(
    this.form.controls.taxCategoryCode.valueChanges.pipe(startWith(this.form.controls.taxCategoryCode.value)),
    { initialValue: '' },
  );
  /** The market's entry for the tax category chosen: its legal basis is said beside it. */
  readonly taxEntry = computed(() => this.catalogue()?.categories.find((entry) => entry.code === this.taxCode()) ?? null);

  protected readonly searchCostAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accounts.searchAccounts(query, limit).pipe(map((list) => fixedAssetCostAccounts(list ?? [])));
  protected readonly searchAccumulatedAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accounts.searchAccounts(query, limit).pipe(map((list) => accumulatedDepreciationAccounts(list ?? [])));
  protected readonly searchExpenseAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accounts.searchAccounts(query, limit).pipe(map((list) => depreciationExpenseAccounts(list ?? [])));
  protected readonly searchGainAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accounts.searchAccounts(query, limit).pipe(map((list) => disposalResultAccounts(list ?? [], 'gain')));
  protected readonly searchLossAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accounts.searchAccounts(query, limit).pipe(map((list) => disposalResultAccounts(list ?? [], 'loss')));
  protected readonly resolveAccount = (id: string): Observable<Account> => this.accounts.getAccountById(id);
  protected readonly accountLabel = (account: Account): string => `${account.code} — ${this.locale.nameOf(account.name)}`;
  protected readonly accountId = (account: Account): string => account.id;

  ngOnInit(): void {
    this.assets.taxCategories().subscribe({
      next: (catalogue) => this.catalogue.set(catalogue),
      error: () => this.catalogue.set(null),
    });
    // Choosing one of the authority's categories brings its method and rate.
    this.form.controls.taxCategoryCode.valueChanges.subscribe((code) => {
      const entry = this.catalogue()?.categories.find((candidate) => candidate.code === code);
      if (!entry) return;
      this.form.patchValue({ taxMethod: entry.method, taxRatePercent: asPercent(entry.annualRate) });
    });

    const id = this.id();
    if (!id) return;
    this.loading.set(true);
    this.assets.getCategory(id).subscribe({
      next: (category) => {
        this.loading.set(false);
        this.load(category);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.notifications.showHttpError(error, 'fixed_assets.categories.load_failed');
      },
    });
  }

  save(): void {
    if (!this.validate()) return;
    const raw = this.form.getRawValue();
    const body: FixedAssetCategoryInput = {
      code: (raw.code ?? '').trim(),
      name: (raw.name ?? '').trim(),
      nameTranslations: raw.nameTranslations ?? {},
      description: (raw.description ?? '').trim() || null,
      usefulLifeMonths: raw.usefulLifeMonths ? Number(raw.usefulLifeMonths) : null,
      depreciationMethod: raw.depreciationMethod || null,
      decliningAnnualRate: raw.depreciationMethod === 'DECLINING_BALANCE' ? asRate(raw.decliningRatePercent) : null,
      depreciationConvention: raw.depreciationConvention || null,
      residualRate: asRate(raw.residualPercent) ?? 0,
      assetAccountId: raw.assetAccountId || null,
      accumulatedDepreciationAccountId: raw.accumulatedDepreciationAccountId || null,
      depreciationExpenseAccountId: raw.depreciationExpenseAccountId || null,
      gainOnDisposalAccountId: raw.gainOnDisposalAccountId || null,
      lossOnDisposalAccountId: raw.lossOnDisposalAccountId || null,
      taxCategoryCode: (raw.taxCategoryCode ?? '').trim() || null,
      taxMethod: raw.taxMethod || null,
      taxAnnualRate: raw.taxMethod ? asRate(raw.taxRatePercent) : null,
      isActive: raw.isActive ?? true,
    };
    const existing = this.current();
    this.saving.set(true);
    const request = existing ? this.assets.updateCategory(existing.id, body) : this.assets.createCategory(body);
    request.subscribe({
      next: (category) => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.tab?.markClean();
        this.notifications.showSuccess(existing ? 'fixed_assets.categories.updated' : 'fixed_assets.categories.created', { code: category.code });
        void this.router.navigateByUrl(this.organization.urlFor('/accounting/fixed-assets/categories')).then(() => this.tab?.close());
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notifications.showHttpError(error, 'fixed_assets.categories.save_failed');
      },
    });
  }

  cancel(): void {
    void this.router.navigateByUrl(this.organization.urlFor('/accounting/fixed-assets/categories'));
  }

  private load(category: FixedAssetCategory): void {
    this.current.set(category);
    this.tab?.setTitle(`${category.code} · ${category.name}`);
    this.form.reset({
      code: category.code,
      name: category.name,
      nameTranslations: { ...(category.nameTranslations ?? {}) },
      description: category.description ?? '',
      usefulLifeMonths: category.usefulLifeMonths,
      depreciationMethod: category.depreciationMethod ?? '',
      decliningRatePercent: asPercent(category.decliningAnnualRate),
      depreciationConvention: category.depreciationConvention ?? '',
      residualPercent: asPercent(category.residualRate) ?? 0,
      assetAccountId: category.assetAccountId,
      accumulatedDepreciationAccountId: category.accumulatedDepreciationAccountId,
      depreciationExpenseAccountId: category.depreciationExpenseAccountId,
      gainOnDisposalAccountId: category.gainOnDisposalAccountId,
      lossOnDisposalAccountId: category.lossOnDisposalAccountId,
      taxCategoryCode: category.taxCategoryCode ?? '',
      taxMethod: category.taxMethod ?? '',
      taxRatePercent: asPercent(category.taxAnnualRate),
      isActive: category.isActive,
    }, { emitEvent: false });
    // `emitEvent: false` above: the signals read the values through `startWith`, so set them.
    this.form.controls.depreciationMethod.setValue(category.depreciationMethod ?? '');
    this.form.controls.taxCategoryCode.setValue(category.taxCategoryCode ?? '', { emitEvent: false });
  }

  private validate(): boolean {
    const raw = this.form.getRawValue();
    const extra: DraftProblem[] = [];
    if (raw.depreciationMethod === 'DECLINING_BALANCE' && !raw.decliningRatePercent) extra.push({ message: 'fixed_assets.declining_rate_required' });
    if (Boolean(raw.taxMethod) !== Boolean(raw.taxRatePercent)) extra.push({ message: 'fixed_assets.tax_method_and_rate_together' });
    if (this.form.invalid || extra.length) {
      this.form.markAllAsTouched();
      this.problems.set([
        ...draftProblems(this.form, {
          code: 'fixed_assets.categories.code',
          name: 'fixed_assets.categories.name',
          description: 'fixed_assets.form.description',
          usefulLifeMonths: 'fixed_assets.form.useful_life',
          decliningRatePercent: 'fixed_assets.form.declining_rate',
          residualPercent: 'fixed_assets.categories.residual',
          taxRatePercent: 'fixed_assets.tax_book.rate',
        }),
        ...extra,
      ]);
      return false;
    }
    this.problems.set([]);
    return true;
  }
}
