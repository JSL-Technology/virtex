import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { Observable, map, startWith } from 'rxjs';
import { TranslateModule, FORMAT_PIPES, accountNameOf, VxNumberInputDirective } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
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
  FixedAssetInput,
  FixedAssetsService,
  hasBeenDepreciated,
} from '../data/fixed-assets.service';

const round2 = (value: number): number => Math.round(value * 100) / 100;
const todayIso = (): string => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

/** The fields that value the asset; fixed once a month has been charged (see the server). */
const VALUATION_CONTROLS = [
  'acquisitionDate',
  'inServiceDate',
  'cost',
  'assetAccountId',
  'accumulatedDepreciationAccountId',
  'migrated',
  'openingAccumulatedDepreciation',
  'openingDepreciatedThrough',
] as const;

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

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(200)]],
    description: ['', [Validators.maxLength(2000)]],
    branchId: [null as string | null],
    acquisitionDate: [todayIso(), [Validators.required]],
    inServiceDate: [todayIso(), [Validators.required]],
    cost: [null as number | null, [Validators.required, Validators.min(0.01)]],
    residualValue: [0 as number | null, [Validators.min(0)]],
    usefulLifeMonths: [60 as number | null, [Validators.required, Validators.min(1), Validators.max(1200)]],
    depreciationMethod: ['STRAIGHT_LINE' as DepreciationMethod, [Validators.required]],
    assetAccountId: ['', [Validators.required]],
    accumulatedDepreciationAccountId: ['', [Validators.required]],
    depreciationExpenseAccountId: [null as string | null],
    migrated: [false],
    openingAccumulatedDepreciation: [0 as number | null, [Validators.min(0)]],
    openingDepreciatedThrough: [''],
  });

  readonly current = signal<FixedAsset | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly problems = signal<DraftProblem[]>([]);

  /** A month has been charged here: what valued the asset is read-only. */
  readonly locked = computed(() => {
    const asset = this.current();
    return asset ? hasBeenDepreciated(asset) : false;
  });

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
  protected readonly accountLabel = (account: Account): string => `${account.code} — ${accountNameOf(account.name)}`;
  protected readonly accountId = (account: Account): string => account.id;

  ngOnInit(): void {
    // The in-service date follows the acquisition date until someone sets it apart.
    this.form.controls.acquisitionDate.valueChanges.subscribe((date) => {
      const inService = this.form.controls.inServiceDate;
      if (date && (inService.pristine || !inService.value)) inService.setValue(date, { emitEvent: false });
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
      acquisitionDate: raw.acquisitionDate as string,
      inServiceDate: raw.inServiceDate as string,
      cost: round2(Number(raw.cost)),
      residualValue: round2(Number(raw.residualValue) || 0),
      usefulLifeMonths: Number(raw.usefulLifeMonths),
      depreciationMethod: raw.depreciationMethod as DepreciationMethod,
      assetAccountId: raw.assetAccountId as string,
      accumulatedDepreciationAccountId: raw.accumulatedDepreciationAccountId as string,
      depreciationExpenseAccountId: raw.depreciationExpenseAccountId || null,
      openingAccumulatedDepreciation: raw.migrated ? round2(Number(raw.openingAccumulatedDepreciation) || 0) : 0,
      ...(raw.migrated && raw.openingDepreciatedThrough ? { openingDepreciatedThrough: raw.openingDepreciatedThrough } : {}),
    };

    const existing = this.current();
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

  /** What an edit may send: everything before the first charge, the estimates after it. */
  private editable(body: FixedAssetInput): Partial<FixedAssetInput> {
    if (!this.locked()) return body;
    const {
      acquisitionDate: _acquisitionDate,
      inServiceDate: _inServiceDate,
      cost: _cost,
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
    this.form.reset({
      name: asset.name,
      description: asset.description ?? '',
      branchId: asset.branchId,
      acquisitionDate: asset.acquisitionDate,
      inServiceDate: asset.inServiceDate,
      cost: asset.cost,
      residualValue: asset.residualValue,
      usefulLifeMonths: asset.usefulLifeMonths,
      depreciationMethod: asset.depreciationMethod,
      assetAccountId: asset.assetAccountId ?? '',
      accumulatedDepreciationAccountId: asset.accumulatedDepreciationAccountId ?? '',
      depreciationExpenseAccountId: asset.depreciationExpenseAccountId,
      migrated,
      openingAccumulatedDepreciation: asset.openingAccumulatedDepreciation,
      // Before any run here, `depreciatedThrough` is still the month the opening balance covers.
      openingDepreciatedThrough: migrated && asset.depreciatedThrough ? asset.depreciatedThrough.slice(0, 7) : '',
    });
    for (const name of VALUATION_CONTROLS) {
      const control = this.form.controls[name];
      if (this.locked()) control.disable({ emitEvent: false });
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
