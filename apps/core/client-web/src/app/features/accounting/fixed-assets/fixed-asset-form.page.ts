import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { Observable, map, startWith } from 'rxjs';
import { TranslateModule, FORMAT_PIPES, VxNumberInputDirective, VxLocalizedNamePipe, tenantToday, LocaleStore } from '@virtex/shared/ui-i18n';
import { DEPRECIATION_CONVENTIONS, type DepreciationConvention } from '@virtex/shared/types';
import { VX_FORM_A11Y } from '@virtex/shared/ui-a11y';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { VxDateFieldComponent } from '../../../shared/components/date';
import { VX_SELECT } from '../../../shared/components/select';
import { VxBranchPickerComponent } from '../../../shared/components/branch-picker';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import {
  accumulatedDepreciationAccounts,
  depreciationExpenseAccounts,
  fixedAssetCostAccounts,
} from '../../../core/services/account-selection';
import { Account } from '../../../core/models/account.model';
import {
  DEPRECIATION_METHODS,
  DepreciationMethod,
  FixedAsset,
  FixedAssetCategory,
  FixedAssetInput,
  FixedAssetsService,
  TAX_DEPRECIATION_METHODS,
  TaxBookInput,
  TaxCategoryCatalogue,
  TaxDepreciationMethod,
  asPercent,
  asRate,
  hasBeenDepreciated,
} from '../data/fixed-assets.service';

const round2 = (value: number): number => Math.round(value * 100) / 100;
// The company's today, not the browser's or UTC (QA R3-M02).
const todayIso = (): string => tenantToday();

/** The fields that value the asset; fixed once a month has been charged (see the server). */
const VALUATION_CONTROLS = [
  'acquisitionDate',
  'inServiceDate',
  'cost',
  // It decided how much the first month charged took.
  'depreciationConvention',
  'assetAccountId',
  'accumulatedDepreciationAccountId',
  'migrated',
  'openingAccumulatedDepreciation',
  'openingDepreciatedThrough',
] as const;

/** The tax book's terms fixed once it has charged a month (see the server's `TaxBookService.revise`). */
const FIXED_TAX_CONTROLS = ['keepTaxBook', 'taxConvention', 'taxBasis', 'taxOpeningAccumulated', 'taxOpeningThrough'] as const;

/** The tax book's controls: an edit sends the book only when one of them changed. */
const TAX_CONTROLS = ['keepTaxBook', 'taxCategoryCode', 'taxMethod', 'taxRatePercent', ...FIXED_TAX_CONTROLS.slice(1)] as const;

/**
 * Registering or editing a fixed asset (audit H-21): what it cost, from when it is used, how long
 * it lasts and how it wears out, and the three accounts its life is booked to. An asset brought
 * over from another system carries the depreciation already charged there.
 *
 * Registering posts nothing: the cost reached the books through the bill that bought it. Once a
 * month has been charged here, what valued the asset is read-only; the estimates — life, residual
 * value, method — still change, and apply to what is left.
 */
@Component({
  selector: 'app-fixed-asset-form-page',
  standalone: true,
  imports: [VxNumberInputDirective,
    VxLocalizedNamePipe,
    ReactiveFormsModule,
    TranslateModule,
    ...FORMAT_PIPES,
    ...VX_FORM_A11Y,
    ...VX_SELECT,
    DraftShellComponent,
    VxDateFieldComponent,
    VxBranchPickerComponent,
  ],
  templateUrl: './fixed-asset-form.page.html',
  styleUrls: ['../../../shared/styles/document-form.scss', '../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixedAssetFormPage implements OnInit {
  /** Names kept in several languages, in the language the company's data is shown in. */
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
    name: ['', [Validators.required, Validators.maxLength(200)]],
    description: ['', [Validators.maxLength(2000)]],
    branchId: [null as string | null],
    /** Its category: what it starts with, and the tax category its tax book follows (FINB-16). */
    categoryId: [null as string | null],
    acquisitionDate: [todayIso(), [Validators.required]],
    inServiceDate: [todayIso(), [Validators.required]],
    cost: [null as number | null, [Validators.required, Validators.min(0.01)]],
    residualValue: [0 as number | null, [Validators.min(0)]],
    usefulLifeMonths: [60 as number | null, [Validators.required, Validators.min(1), Validators.max(1200)]],
    depreciationMethod: ['STRAIGHT_LINE' as DepreciationMethod, [Validators.required]],
    /** The yearly rate of a declining balance, in percent. */
    decliningRatePercent: [null as number | null, [Validators.min(0.0001), Validators.max(100)]],
    /** Empty: the company's convention, which the server applies. */
    depreciationConvention: ['' as DepreciationConvention | ''],
    assetAccountId: ['', [Validators.required]],
    accumulatedDepreciationAccountId: ['', [Validators.required]],
    depreciationExpenseAccountId: [null as string | null],
    migrated: [false],
    openingAccumulatedDepreciation: [0 as number | null, [Validators.min(0)]],
    openingDepreciatedThrough: [''],
    // ── Its tax book: what the tax authority lets the company deduct, posted nowhere ──
    keepTaxBook: [false],
    taxCategoryCode: [''],
    taxMethod: ['' as TaxDepreciationMethod | ''],
    taxRatePercent: [null as number | null, [Validators.min(0.0001), Validators.max(100)]],
    /** Empty: the accounting book's. */
    taxConvention: ['' as DepreciationConvention | ''],
    /** Empty: the cost. */
    taxBasis: [null as number | null, [Validators.min(0)]],
    taxOpeningAccumulated: [0 as number | null, [Validators.min(0)]],
    taxOpeningThrough: [''],
  });

  readonly current = signal<FixedAsset | null>(null);
  readonly categories = signal<FixedAssetCategory[]>([]);
  readonly catalogue = signal<TaxCategoryCatalogue | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly problems = signal<DraftProblem[]>([]);

  /** A month has been charged here: what valued the asset is read-only. */
  readonly locked = computed(() => {
    const asset = this.current();
    return asset ? hasBeenDepreciated(asset) : false;
  });

  /** Its tax book has charged a month: its basis, opening and convention are fixed. */
  readonly taxBookLocked = computed(() => (this.current()?.taxBook?.chargedMonths ?? 0) > 0);

  private readonly method = toSignal(
    this.form.controls.depreciationMethod.valueChanges.pipe(startWith(this.form.controls.depreciationMethod.value)),
    { initialValue: 'STRAIGHT_LINE' as DepreciationMethod },
  );
  readonly declining = computed(() => this.method() === 'DECLINING_BALANCE');

  private readonly keepsTaxBook = toSignal(
    this.form.controls.keepTaxBook.valueChanges.pipe(startWith(this.form.controls.keepTaxBook.value)),
    { initialValue: false },
  );
  readonly showTaxBook = computed(() => Boolean(this.keepsTaxBook()));

  private readonly taxCode = toSignal(
    this.form.controls.taxCategoryCode.valueChanges.pipe(startWith(this.form.controls.taxCategoryCode.value)),
    { initialValue: '' },
  );
  /** The market's entry for the tax category chosen: its legal basis is said beside it. */
  readonly taxEntry = computed(() => this.catalogue()?.categories.find((entry) => entry.code === this.taxCode()) ?? null);

  private readonly migrated = toSignal(
    this.form.controls.migrated.valueChanges.pipe(startWith(this.form.controls.migrated.value)),
    { initialValue: false },
  );
  readonly showOpening = computed(() => Boolean(this.migrated()));

  private readonly life = toSignal(
    this.form.controls.usefulLifeMonths.valueChanges.pipe(startWith(this.form.controls.usefulLifeMonths.value)),
    { initialValue: 60 },
  );
  /** `60` months → 5 years, said beside the field. */
  readonly lifeInYears = computed(() => round2((Number(this.life()) || 0) / 12));

  protected readonly searchCostAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accounts.searchAccounts(query, limit).pipe(map((list) => fixedAssetCostAccounts(list ?? [])));
  protected readonly searchAccumulatedAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accounts.searchAccounts(query, limit).pipe(map((list) => accumulatedDepreciationAccounts(list ?? [])));
  protected readonly searchExpenseAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accounts.searchAccounts(query, limit).pipe(map((list) => depreciationExpenseAccounts(list ?? [])));
  protected readonly resolveAccount = (id: string): Observable<Account> => this.accounts.getAccountById(id);
  protected readonly accountLabel = (account: Account): string => `${account.code} — ${this.locale.nameOf(account.name)}`;
  protected readonly accountId = (account: Account): string => account.id;

  ngOnInit(): void {
    // The in-service date follows the acquisition date until someone sets it apart.
    this.form.controls.acquisitionDate.valueChanges.subscribe((date) => {
      const inService = this.form.controls.inServiceDate;
      if (date && (inService.pristine || !inService.value)) inService.setValue(date, { emitEvent: false });
    });
    this.assets.listCategories().subscribe({ next: (categories) => this.categories.set(categories), error: () => this.categories.set([]) });
    this.assets.taxCategories().subscribe({ next: (catalogue) => this.catalogue.set(catalogue), error: () => this.catalogue.set(null) });
    // A new asset takes what its category gives; an asset already registered is only reclassified.
    this.form.controls.categoryId.valueChanges.subscribe((categoryId) => {
      if (this.current() || !categoryId) return;
      const category = this.categories().find((candidate) => candidate.id === categoryId);
      if (category) this.applyCategory(category);
    });
    // The residual share a category gives follows the cost until someone sets the residual apart.
    this.form.controls.cost.valueChanges.subscribe((cost) => {
      const category = this.categories().find((candidate) => candidate.id === this.form.controls.categoryId.value);
      const residual = this.form.controls.residualValue;
      if (!this.current() && category?.residualRate && residual.pristine) residual.setValue(round2((Number(cost) || 0) * category.residualRate));
    });
    // One of the authority's categories brings its method and rate.
    this.form.controls.taxCategoryCode.valueChanges.subscribe((code) => {
      const entry = this.catalogue()?.categories.find((candidate) => candidate.code === code);
      if (entry) this.form.patchValue({ taxMethod: entry.method, taxRatePercent: asPercent(entry.annualRate) });
    });

    const id = this.id();
    if (!id) return;
    this.loading.set(true);
    this.assets.get(id).subscribe({
      next: (asset) => {
        this.loading.set(false);
        this.load(asset);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.notifications.showHttpError(error, 'fixed_assets.form.load_failed');
      },
    });
  }

  save(): void {
    if (!this.validate()) return;
    const raw = this.form.getRawValue();
    const body: FixedAssetInput = {
      name: (raw.name ?? '').trim(),
      description: (raw.description ?? '').trim() || null,
      branchId: raw.branchId || null,
      categoryId: raw.categoryId || null,
      acquisitionDate: raw.acquisitionDate as string,
      inServiceDate: raw.inServiceDate as string,
      cost: round2(Number(raw.cost)),
      residualValue: round2(Number(raw.residualValue) || 0),
      usefulLifeMonths: Number(raw.usefulLifeMonths),
      depreciationMethod: raw.depreciationMethod as DepreciationMethod,
      decliningAnnualRate: raw.depreciationMethod === 'DECLINING_BALANCE' ? asRate(raw.decliningRatePercent) : null,
      ...(raw.depreciationConvention ? { depreciationConvention: raw.depreciationConvention } : {}),
      assetAccountId: raw.assetAccountId as string,
      accumulatedDepreciationAccountId: raw.accumulatedDepreciationAccountId as string,
      depreciationExpenseAccountId: raw.depreciationExpenseAccountId || null,
      openingAccumulatedDepreciation: raw.migrated ? round2(Number(raw.openingAccumulatedDepreciation) || 0) : 0,
      ...(raw.migrated && raw.openingDepreciatedThrough ? { openingDepreciatedThrough: raw.openingDepreciatedThrough } : {}),
    };
    const existing = this.current();
    // A new asset always says whether it keeps a tax book; an edit, only when its terms changed.
    if (!existing || TAX_CONTROLS.some((name) => this.form.controls[name].dirty)) body.taxBook = this.taxBook();

    this.saving.set(true);
    const request = existing ? this.assets.update(existing.id, this.editable(body)) : this.assets.create(body);
    request.subscribe({
      next: (asset) => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.tab?.markClean();
        this.notifications.showSuccess(existing ? 'fixed_assets.form.updated' : 'fixed_assets.form.created', { number: asset.number });
        const route = `/accounting/fixed-assets/${asset.id}`;
        if (this.tab) this.tab.replaceRoute(route, { title: asset.number });
        else void this.router.navigateByUrl(this.organization.urlFor(route));
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notifications.showHttpError(error, 'fixed_assets.form.save_failed');
      },
    });
  }

  cancel(): void {
    const asset = this.current();
    void this.router.navigateByUrl(
      this.organization.urlFor(asset ? `/accounting/fixed-assets/${asset.id}` : '/accounting/fixed-assets'),
    );
  }

  /** The tax book the form describes, or null for none. */
  private taxBook(): TaxBookInput | null {
    const raw = this.form.getRawValue();
    if (!raw.keepTaxBook) return null;
    const migrated = raw.migrated && Number(raw.taxOpeningAccumulated) > 0;
    const book: TaxBookInput = {
      taxCategoryCode: (raw.taxCategoryCode ?? '').trim() || null,
      method: raw.taxMethod as TaxDepreciationMethod,
      annualRate: asRate(raw.taxRatePercent) ?? undefined,
    };
    // What decided the months already charged is fixed: an edit of a charged book leaves it out.
    if (this.taxBookLocked()) return book;
    return {
      ...book,
      ...(raw.taxConvention ? { convention: raw.taxConvention } : {}),
      ...(raw.taxBasis !== null && raw.taxBasis !== undefined && String(raw.taxBasis) !== '' ? { cost: round2(Number(raw.taxBasis)) } : {}),
      openingAccumulated: migrated ? round2(Number(raw.taxOpeningAccumulated)) : 0,
      openingThrough: migrated && raw.taxOpeningThrough ? raw.taxOpeningThrough : null,
    };
  }

  /** What a category gives a new asset: its life, method, convention, residual share, accounts and tax book. */
  private applyCategory(category: FixedAssetCategory): void {
    const cost = Number(this.form.controls.cost.value) || 0;
    this.form.patchValue({
      ...(category.usefulLifeMonths ? { usefulLifeMonths: category.usefulLifeMonths } : {}),
      ...(category.depreciationMethod ? { depreciationMethod: category.depreciationMethod } : {}),
      ...(category.decliningAnnualRate !== null ? { decliningRatePercent: asPercent(category.decliningAnnualRate) } : {}),
      ...(category.depreciationConvention ? { depreciationConvention: category.depreciationConvention } : {}),
      ...(category.residualRate ? { residualValue: round2(cost * category.residualRate) } : {}),
      ...(category.assetAccountId ? { assetAccountId: category.assetAccountId } : {}),
      ...(category.accumulatedDepreciationAccountId ? { accumulatedDepreciationAccountId: category.accumulatedDepreciationAccountId } : {}),
      ...(category.depreciationExpenseAccountId ? { depreciationExpenseAccountId: category.depreciationExpenseAccountId } : {}),
    });
    this.form.patchValue({
      keepTaxBook: Boolean(category.taxMethod),
      taxCategoryCode: category.taxCategoryCode ?? '',
      taxMethod: category.taxMethod ?? '',
      taxRatePercent: asPercent(category.taxAnnualRate),
    }, { emitEvent: false });
    this.form.controls.keepTaxBook.setValue(Boolean(category.taxMethod));
  }

  /** What an edit may send: everything before the first charge, the estimates after it. */
  private editable(body: FixedAssetInput): Partial<FixedAssetInput> {
    if (!this.locked()) return body;
    const {
      acquisitionDate: _acquisitionDate,
      inServiceDate: _inServiceDate,
      cost: _cost,
      depreciationConvention: _convention,
      assetAccountId: _assetAccountId,
      accumulatedDepreciationAccountId: _accumulatedAccountId,
      openingAccumulatedDepreciation: _opening,
      openingDepreciatedThrough: _openingThrough,
      ...estimates
    } = body;
    return estimates;
  }

  private load(asset: FixedAsset): void {
    this.current.set(asset);
    this.tab?.setTitle(asset.number);
    const migrated = asset.openingAccumulatedDepreciation > 0;
    const book = asset.taxBook ?? null;
    this.form.reset({
      name: asset.name,
      description: asset.description ?? '',
      branchId: asset.branchId,
      categoryId: asset.categoryId,
      acquisitionDate: asset.acquisitionDate,
      inServiceDate: asset.inServiceDate,
      cost: asset.cost,
      residualValue: asset.residualValue,
      usefulLifeMonths: asset.usefulLifeMonths,
      depreciationMethod: asset.depreciationMethod,
      decliningRatePercent: asPercent(asset.decliningAnnualRate),
      depreciationConvention: asset.depreciationConvention,
      assetAccountId: asset.assetAccountId ?? '',
      accumulatedDepreciationAccountId: asset.accumulatedDepreciationAccountId ?? '',
      depreciationExpenseAccountId: asset.depreciationExpenseAccountId,
      migrated,
      openingAccumulatedDepreciation: asset.openingAccumulatedDepreciation,
      // Before any run here, `depreciatedThrough` is still the month the opening balance covers.
      openingDepreciatedThrough: migrated && asset.depreciatedThrough ? asset.depreciatedThrough.slice(0, 7) : '',
      keepTaxBook: Boolean(book),
      taxCategoryCode: book?.taxCategoryCode ?? '',
      taxMethod: book?.method ?? '',
      taxRatePercent: asPercent(book?.annualRate),
      taxConvention: book?.convention ?? '',
      taxBasis: book?.cost ?? null,
      taxOpeningAccumulated: book?.openingAccumulated ?? 0,
      taxOpeningThrough: book?.openingThrough ?? '',
    });
    for (const name of VALUATION_CONTROLS) {
      const control = this.form.controls[name];
      if (this.locked()) control.disable({ emitEvent: false });
      else control.enable({ emitEvent: false });
    }
    for (const name of FIXED_TAX_CONTROLS) {
      const control = this.form.controls[name];
      if (this.taxBookLocked()) control.disable({ emitEvent: false });
      else control.enable({ emitEvent: false });
    }
  }

  private validate(): boolean {
    const raw = this.form.getRawValue();
    const extra: DraftProblem[] = [];
    const cost = Number(raw.cost) || 0;
    const residual = Number(raw.residualValue) || 0;
    if (residual > cost) extra.push({ message: 'fixed_assets.residual_above_cost' });
    if (raw.inServiceDate && raw.acquisitionDate && raw.inServiceDate < raw.acquisitionDate) {
      extra.push({ message: 'fixed_assets.in_service_before_acquisition' });
    }
    if (raw.migrated && !this.locked()) {
      const opening = Number(raw.openingAccumulatedDepreciation) || 0;
      if (opening > round2(cost - residual)) extra.push({ message: 'fixed_assets.form.opening_too_high' });
      if (opening > 0 && !raw.openingDepreciatedThrough) extra.push({ message: 'fixed_assets.opening_through_required' });
    }
    if (raw.depreciationMethod === 'DECLINING_BALANCE' && !raw.decliningRatePercent) extra.push({ message: 'fixed_assets.declining_rate_required' });
    if (raw.keepTaxBook) {
      if (!raw.taxMethod || !raw.taxRatePercent) extra.push({ message: 'fixed_assets.tax_book_rate_required' });
      if (raw.migrated && Number(raw.taxOpeningAccumulated) > 0 && !raw.taxOpeningThrough && !this.taxBookLocked()) {
        extra.push({ message: 'fixed_assets.tax_opening_through_required' });
      }
    }
    if (this.form.invalid || extra.length) {
      this.form.markAllAsTouched();
      this.problems.set([
        ...draftProblems(this.form, {
          name: 'fixed_assets.form.name',
          description: 'fixed_assets.form.description',
          acquisitionDate: 'fixed_assets.form.acquisition_date',
          inServiceDate: 'fixed_assets.form.in_service_date',
          cost: 'fixed_assets.form.cost',
          residualValue: 'fixed_assets.form.residual_value',
          usefulLifeMonths: 'fixed_assets.form.useful_life',
          depreciationMethod: 'fixed_assets.form.method',
          decliningRatePercent: 'fixed_assets.form.declining_rate',
          taxRatePercent: 'fixed_assets.tax_book.rate',
          taxBasis: 'fixed_assets.tax_book.basis',
          taxOpeningAccumulated: 'fixed_assets.tax_book.opening_accumulated',
          assetAccountId: 'fixed_assets.form.asset_account',
          accumulatedDepreciationAccountId: 'fixed_assets.form.accumulated_account',
          openingAccumulatedDepreciation: 'fixed_assets.form.opening_accumulated',
        }),
        ...extra,
      ]);
      return false;
    }
    this.problems.set([]);
    return true;
  }
}
