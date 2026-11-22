import { Component, OnInit, inject, ChangeDetectionStrategy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  AccountSegmentDefinition,
  ChartOfAccountsApiService,
  CreateAccountDto,
} from '../../../core/api/chart-of-accounts.service';
import { CurrenciesService } from '../../../core/api/currencies.service';
import { ChartOfAccountsStateService, ParentAccountOption } from '../state/chart-of-accounts.state';
import { take } from 'rxjs/operators';
import { accountNameOf, VxNumberInputDirective, tenantToday } from '@virtex/shared/ui-i18n';
import {
  ACCOUNT_CATEGORIES_BY_TYPE,
  FX_TREATMENTS,
  defaultFxTreatmentForType,
  defaultInflationRestatement,
  isCategoryAllowedForType,
  isFxTreatmentAllowedForType,
  isRestatableAccount,
  type FxTreatment,
} from '@virtex/shared/types';
import { OrganizationSettingsService } from '../../settings/data/organization-settings.service';
import { AccountType, AccountCategory, AccountNature, CashFlowCategory } from '../../../core/models/account.model';
import { LucideAngularModule, Save, AlertTriangle, Settings } from 'lucide-angular';
import { NotificationService } from '../../../core/services/notification';
import { TranslateModule } from '@virtex/shared/ui-i18n';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { VX_FORM_A11Y } from '@virtex/shared/ui-a11y';
import { VxTabsComponent, VxTab } from '../../../shared/components/tabs';
import { VxDateFieldComponent } from '../../../shared/components/date';
import { VX_SELECT } from '../../../shared/components/select';
import { CanOpenDirective } from '../../../core/modules/can-open.directive';


@Component({
  selector: 'app-account-form-page',
  standalone: true,
  imports: [VxNumberInputDirective, 
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    CanOpenDirective,
    LucideAngularModule,
    TranslateModule,
    DraftShellComponent,
    ...VX_FORM_A11Y, ...VX_SELECT, VxTabsComponent, VxDateFieldComponent],
  templateUrl: './account-form.page.html',
  styleUrls: ['./account-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountFormPage implements OnInit {
  /** «1100 - Efectivo y equivalentes»: el código primero, que es por donde se busca. */
  protected readonly parentLabel = (option: ParentAccountOption): string =>
    `${option.code} - ${accountNameOf(option.name)}`;
  protected readonly parentId = (option: ParentAccountOption): string => option.id;

  /** La ventana que hospeda esta página, cuando la hay. Nula si la monta el router. */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });
  private readonly translate = inject(TranslateService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly apiService = inject(ChartOfAccountsApiService);
  public readonly stateService = inject(ChartOfAccountsStateService); // Hecho público para el template
  private readonly notificationService = inject(NotificationService);
  private readonly currencies = inject(CurrenciesService);
  private readonly settings = inject(OrganizationSettingsService);

  public accountForm!: FormGroup;
  public isEditing = signal(false);
  public isLoading = signal(true);
  public segmentDefinitions = signal<AccountSegmentDefinition[]>([]);
  public isConfigMissing = signal(false);
  private accountId: string | null = null;
  /** The account being edited, for the parent picker: it cannot sit under itself or below. */
  private readonly editingId = signal<string | null>(null);

  public activeTab = signal<'general' | 'mappings' | 'currency' | 'advanced'>('general');

  /** Las cuatro secciones del formulario de cuenta, como datos: `vx-tabs` las dibuja. */
  protected readonly TABS: VxTab[] = [
    { id: 'general', labelKey: 'accounting.account_form.general' },
    { id: 'mappings', labelKey: 'accounting.account_form.mappings' },
    { id: 'currency', labelKey: 'accounting.account_form.currency_and_revaluation' },
    { id: 'advanced', labelKey: 'accounting.account_form.advanced' },
  ];
  public readonly SaveIcon = Save;
  public readonly AlertIcon = AlertTriangle;
  public readonly SettingsIcon = Settings;
  public readonly accountTypes = Object.values(AccountType);
  public readonly accountCategories = Object.values(AccountCategory);
  /** El tipo elegido, para ofrecer solo las categorías que lo refinan. */
  protected readonly selectedType = signal<AccountType | null>(null);
  protected readonly categoriesForType = computed<string[]>(() => {
    const type = this.selectedType();
    if (!type) return [];
    return [...((ACCOUNT_CATEGORIES_BY_TYPE as Record<string, readonly string[]>)[type] ?? [])];
  });
  public readonly accountNatures = Object.values(AccountNature);
  public readonly cashFlowCategories = Object.values(CashFlowCategory);

  /**
   * Where the account can sit (FIN-COA-05): summary accounts of its own type, and never itself or
   * one of its sub-accounts. The server refuses every other parent; the picker does not offer them.
   */
  protected readonly parentOptions = computed(() =>
    this.stateService.parentOptionsFor(this.selectedType(), this.editingId()),
  );

  /** The two foreign-currency treatments (IAS 21), in the order the picker shows them. */
  protected readonly fxTreatments = FX_TREATMENTS;
  /** Only balance-sheet accounts are revalued: an expense stays at the rate of the day it was incurred. */
  protected readonly revaluedAllowed = computed(() => isFxTreatmentAllowedForType(this.selectedType(), 'REVALUED'));
  /**
   * Whether the account takes postings. A summary account carries no balance of its own — its
   * sub-accounts do — so it has neither a currency nor a foreign-currency treatment to choose.
   */
  protected readonly postable = signal(true);
  /** The company's currencies, for the account's currency. */
  protected readonly currencyCodes = signal<string[]>([]);
  /**
   * Whether the treatment on the form is a choice — the person's, or the account's own when editing —
   * rather than the default of the chosen type. Only a default follows the type.
   */
  private fxTreatmentChosen = false;

  /**
   * Whether the company restates its books for inflation (IAS 29): the restatement settings of the
   * account are only shown, and only matter, when it does.
   */
  protected readonly inflationApplies = signal(false);
  /** Whether «restated» on the form is a choice rather than the default for the account's nature. */
  private inflationChosen = false;
  /** The account being edited, as loaded: whether it already takes another account's restatement. */
  private readonly editingAccountRestatementTarget = signal(false);
  /**
   * Where the account's restatement can go (capital → «Ajuste de capital»): a postable account of its
   * own type that is not restated itself and takes no other account's restatement.
   */
  protected readonly restatementTargets = computed(() =>
    this.stateService.restatementTargetsFor(this.selectedType(), this.editingId()),
  );

  ngOnInit(): void {
    this.initializeForm();
    this.loadSegmentDefinitions();
    this.loadCurrencies();
    this.loadInflationPolicy();
    //  The parent picker reads the chart, and this page is not always opened from the list that
    //  reads it: a link or a restored tab opens it on its own.
    this.stateService.ensureLoaded();
    this.accountId = this.route.snapshot.paramMap.get('id');
    this.editingId.set(this.accountId);

    if (this.accountId) {
      this.isEditing.set(true);
      this.loadAccountData(this.accountId);
    } else {
      this.isLoading.set(false);
    }
  }

  private loadCurrencies(): void {
    this.currencies.getCurrencies().pipe(take(1)).subscribe({
      next: (all) => this.currencyCodes.set(all.map((currency) => currency.code)),
      error: () => this.currencyCodes.set([]),
    });
  }

  private loadInflationPolicy(): void {
    this.settings.get('closing').pipe(take(1)).subscribe({
      next: (section) => {
        const policy = section.fields['inflationAdjustmentPolicy'];
        this.inflationApplies.set(typeof policy === 'string' && policy !== 'NONE');
      },
      // Without the company's settings the fields stay hidden; the server applies its defaults.
      error: () => this.inflationApplies.set(false),
    });
  }

  private loadSegmentDefinitions(): void {
    this.apiService.getSegmentDefinitions().pipe(take(1)).subscribe({
      next: (defs) => {
        this.segmentDefinitions.set(defs);
        if (defs.length === 0) {
          this.isConfigMissing.set(true);
        }
      },
      error: () => {
        this.notificationService.showError('accounting.account_form.error_loading_segment_configuration');
      }
    });
  }

  private initializeForm(): void {
    this.accountForm = this.fb.group({
      // Pestaña General
      code: ['', [Validators.required, Validators.maxLength(20)]],
      name: ['', [Validators.required, Validators.maxLength(255)]],
      description: [''],
      parentId: [null],
      type: [null, Validators.required],
      nature: [{ value: null, disabled: true }, Validators.required],
      category: [null, Validators.required],
      isPostable: [true, Validators.required],
      isActive: [true, Validators.required],
  
      // Pestaña Mapeos (agrupado)
      statementMapping: this.fb.group({
        balanceSheetCategory: [''],
        incomeStatementCategory: [''],
        cashFlowCategory: [CashFlowCategory.NONE]
      }),

      // Pestaña Moneda y revaluación
      fxTreatment: [defaultFxTreatmentForType(null) as FxTreatment, Validators.required],
      currency: [null as string | null],
      // Reexpresión por inflación (NIC 29)
      isInflationAdjustable: [false],
      inflationAdjustmentAccountId: [null as string | null],

      // Pestaña Avanzado (agrupado)
      advanced: this.fb.group({
        effectiveFrom: [tenantToday()],
        effectiveTo: [null]
      })
    });
  
    // Lógica para autocompletar la naturaleza
    this.accountForm.get('type')?.valueChanges.subscribe((type: AccountType) => {
      this.accountForm.get('nature')?.setValue(this.getNatureFromType(type), { emitEvent: false });
      this.selectedType.set(type);
      //  La categoría refina el tipo (QA M-04): si la elegida ya no corresponde, se vacía para que
      //  el usuario elija una válida en vez de guardar un gasto clasificado como activo.
      const category = this.accountForm.get('category');
      if (category?.value && !isCategoryAllowedForType(type, category.value)) {
        category.setValue(null);
      }
      //  The parent is a summary account of the same type: one of another type no longer fits.
      const parent = this.accountForm.get('parentId');
      if (parent?.value && this.stateService.typeOf(parent.value) !== type) {
        parent.setValue(null, { emitEvent: false });
      }
      this.applyFxTreatmentDefault();
      this.applyInflationDefault();
    });

    //  A sub-account has its parent's type, so choosing the parent first gives the type.
    this.accountForm.get('parentId')?.valueChanges.subscribe((parentId: string | null) => {
      const type = this.accountForm.get('type');
      if (!parentId || !type || type.disabled || type.value) return;
      const parentType = this.stateService.typeOf(parentId);
      if (parentType) type.setValue(parentType);
    });

    this.accountForm.get('isPostable')?.valueChanges.subscribe((isPostable: boolean) => {
      this.applyPostability(isPostable !== false);
    });

    //  Every value this page writes itself goes without an event, so an event here is a choice.
    this.accountForm.get('fxTreatment')?.valueChanges.subscribe(() => {
      this.fxTreatmentChosen = true;
      this.applyInflationDefault();
    });
    this.accountForm.get('isInflationAdjustable')?.valueChanges.subscribe((restated: boolean) => {
      this.inflationChosen = true;
      if (!restated) this.accountForm.get('inflationAdjustmentAccountId')?.setValue(null, { emitEvent: false });
    });
  }

  /**
   * Restated for inflation by default when the account can be — postable, non-monetary — and never
   * when it cannot (a monetary account restated would count its loss of purchasing power twice). A
   * choice the person made is kept while it is still allowed.
   */
  private applyInflationDefault(): void {
    const restated = this.accountForm.get('isInflationAdjustable');
    const target = this.accountForm.get('inflationAdjustmentAccountId');
    if (!restated || !target) return;
    const facts = {
      type: this.selectedType(),
      fxTreatment: this.accountForm.get('fxTreatment')?.value as FxTreatment,
      isPostable: this.postable(),
      systemRole: null,
    };
    const allowed = isRestatableAccount(facts) && !this.editingAccountRestatementTarget();
    if (!allowed) {
      restated.setValue(false, { emitEvent: false });
      target.setValue(null, { emitEvent: false });
      restated.disable({ emitEvent: false });
      target.disable({ emitEvent: false });
      this.inflationChosen = false;
      return;
    }
    restated.enable({ emitEvent: false });
    target.enable({ emitEvent: false });
    if (!this.inflationChosen) restated.setValue(defaultInflationRestatement(facts), { emitEvent: false });
  }

  /**
   * The treatment for the chosen type, while the person has not chosen one: a liability is money
   * owed in nearly every case and is revalued; an asset with nothing more said is held at its
   * historical rate. A treatment the type cannot have (revaluing an expense) is never kept.
   */
  private applyFxTreatmentDefault(): void {
    const control = this.accountForm.get('fxTreatment');
    if (!control || control.disabled) return;
    const type = this.selectedType();
    if (!this.fxTreatmentChosen || !isFxTreatmentAllowedForType(type, control.value)) {
      control.setValue(defaultFxTreatmentForType(type), { emitEvent: false });
      this.fxTreatmentChosen = false;
    }
  }

  /** A summary account has no currency and no treatment of its own: its sub-accounts have them. */
  private applyPostability(isPostable: boolean): void {
    this.postable.set(isPostable);
    const fxTreatment = this.accountForm.get('fxTreatment');
    const currency = this.accountForm.get('currency');
    if (!fxTreatment || !currency) return;
    if (isPostable) {
      fxTreatment.enable({ emitEvent: false });
      currency.enable({ emitEvent: false });
      this.applyFxTreatmentDefault();
    } else {
      fxTreatment.setValue('HISTORICAL', { emitEvent: false });
      currency.setValue(null, { emitEvent: false });
      fxTreatment.disable({ emitEvent: false });
      currency.disable({ emitEvent: false });
      this.fxTreatmentChosen = false;
    }
    this.applyInflationDefault();
  }

  private loadAccountData(id: string): void {
    this.isLoading.set(true);
    this.apiService.getAccountById(id).pipe(take(1)).subscribe({
      next: (account) => {
        //  Written without events: what the account holds is not a choice made on this form, and
        //  the type's defaults (its nature, its foreign-currency treatment) must not replace it.
        this.accountForm.patchValue(
          {
            code: account.code ?? '',
            // The server sends the name as `{ es: 'Bancos' }`, and a text input given an object
            // renders `[object Object]` — which is also what a save would have written back as the
            // account's name. `accountNameOf` is the existing fallback chain for exactly this.
            name: accountNameOf(account.name as Record<string, string> | string | null | undefined),
            description: typeof account.description === 'string' ? account.description : '',
            parentId: account.parentId ?? null,
            type: account.type,
            nature: account.nature,
            category: account.category,
            isPostable: account.isPostable,
            isActive: account.isActive,
            fxTreatment: account.fxTreatment ?? defaultFxTreatmentForType(account.type),
            currency: account.currency ?? null,
            isInflationAdjustable: account.isInflationAdjustable ?? false,
            inflationAdjustmentAccountId: account.inflationAdjustmentAccountId ?? null,
            statementMapping: account.statementMapping ?? {},
            advanced: {
              effectiveFrom: AccountFormPage.dateOnly(account.effectiveFrom) ?? tenantToday(),
              effectiveTo: AccountFormPage.dateOnly(account.effectiveTo),
            },
          },
          { emitEvent: false },
        );

        this.selectedType.set(account.type ?? null);
        //  What was loaded is what the account has, not a default still to apply.
        this.fxTreatmentChosen = !!account.fxTreatment;
        this.inflationChosen = account.isInflationAdjustable !== undefined;
        this.editingAccountRestatementTarget.set(this.stateService.isRestatementTarget(account.id));
        this.applyPostability(account.isPostable !== false);
        if (this.isEditing()) {
          this.accountForm.get('code')?.disable();
          this.accountForm.get('type')?.disable();
          //  Toda modificación de una cuenta queda en su historial con un motivo: el servidor lo
          //  exige y el formulario no tenía dónde escribirlo, así que NINGUNA cuenta era editable
          //  (QA A-05).
          if (!this.accountForm.get('reasonForChange')) {
            this.accountForm.addControl(
              'reasonForChange',
              this.fb.control('', [Validators.required, Validators.minLength(5), Validators.maxLength(500)]),
            );
          }
        }
        this.isLoading.set(false);
      },
      error: () => {
        this.notificationService.showError('accounting.account_form.error_loading_account_details');
        this.isLoading.set(false);
        this.router.navigate(['/accounting/chart-of-accounts']);
      }
    });
  }

  /** Qué falta antes de guardar, con el rótulo de cada campo. */
  readonly problems = signal<DraftProblem[]>([]);

  onSave(): void {
    if (this.isConfigMissing()) {
      this.notificationService.showError('accounting.account_form.account_cannot_saved_without_configured_segment');
      return;
    }

    if (this.accountForm.invalid) {
      this.accountForm.markAllAsTouched();
      //  Este formulario tiene cuatro pestañas, así que el campo que falta puede estar en una que
      //  ni siquiera se ve. Abrir la pestaña culpable ya lo hacía; el resumen añade decir cuál es
      //  el campo, que es lo que faltaba para poder arreglarlo sin buscarlo.
      this.problems.set(draftProblems(this.accountForm, ACCOUNT_FIELD_LABELS));
      this.findAndFocusFirstInvalidTab();
      return;
    }

    this.problems.set([]);
  
    this.isLoading.set(true);
    const formData = this.accountForm.getRawValue();
    const segments = this.parseCodeToSegments(formData.code);

    if (!this.isEditing() && segments.length === 0) {
      this.notificationService.showError('accounting.account_form.account_code_must_have_least_one');
      this.isLoading.set(false);
      this.activeTab.set('general');
      return;
    }

    const advanced = formData.advanced ?? {};
    const account: Omit<CreateAccountDto, 'segments'> = {
      name: formData.name,
      description: formData.description || undefined,
      parentId: formData.parentId || null,
      type: formData.type,
      category: formData.category,
      nature: this.getNatureFromType(formData.type),
      isPostable: formData.isPostable,
      isActive: formData.isActive,
      statementMapping: formData.statementMapping,
      fxTreatment: formData.fxTreatment,
      currency: formData.currency || null,
      // Sent only where the company restates: elsewhere the server keeps the account's default.
      ...(this.inflationApplies()
        ? {
            isInflationAdjustable: !!formData.isInflationAdjustable,
            inflationAdjustmentAccountId: formData.isInflationAdjustable ? formData.inflationAdjustmentAccountId || null : null,
          }
        : {}),
      effectiveFrom: advanced.effectiveFrom || undefined,
      effectiveTo: advanced.effectiveTo || undefined,
    };

    const saveOperation = this.isEditing()
      ? this.apiService.updateAccount(this.accountId!, {
          ...account,
          reasonForChange: String(formData.reasonForChange ?? '').trim(),
        })
      : this.apiService.createAccount({ ...account, segments });
  
    saveOperation.pipe(take(1)).subscribe({
      next: () => {
        this.notificationService.showSuccess(this.isEditing() ? 'accounting.account_form.account_updated_successfully' : 'accounting.account_form.account_created_successfully');
        this.stateService.refreshAccounts();
        //  Esta ventana ya cumplió: el registro existe y la página se va a la lista. Si se dejara
        //  abierta seguiría anunciándose como «el formulario nuevo», y el siguiente clic en «Nuevo»
        //  la enfocaría con el documento ya guardado dentro. Ver `TabContext.close`.
        void this.router.navigate(['/accounting/chart-of-accounts']).then(() => this.tab?.close());
      },
      error: (err) => {
        this.notificationService.showHttpError(err, 'errors.save_account');
        this.isLoading.set(false);
      }
    });
  }

  private parseCodeToSegments(code: string | null | undefined): string[] {
    if (!code || typeof code !== 'string') return [];
    return code
      .split('-')
      .map(segment => segment.trim())
      .filter(segment => segment.length > 0);
  }

  private getNatureFromType(type: AccountType): AccountNature {
    const creditTypes: AccountType[] = [AccountType.LIABILITY, AccountType.EQUITY, AccountType.REVENUE];
    return creditTypes.includes(type) ? AccountNature.CREDIT : AccountNature.DEBIT;
  }

  onCancel(): void {
    this.router.navigate(['/accounting/chart-of-accounts']);
  }

  /** `YYYY-MM-DD` of a date column as the server sends it, or null. */
  private static dateOnly(value: string | Date | null | undefined): string | null {
    if (!value) return null;
    return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  }

  private findAndFocusFirstInvalidTab(): void {
    const controls = this.accountForm.controls;

    // Check general tab fields
    for (const key of ['code', 'name', 'parentId', 'type', 'category', 'reasonForChange']) {
      if (controls[key]?.invalid) {
        this.activeTab.set('general');
        return;
      }
    }

    // Check other tabs by group
    if (this.accountForm.get('statementMapping')?.invalid) {
      this.activeTab.set('mappings');
      return;
    }
    if (controls['fxTreatment']?.invalid || controls['currency']?.invalid) {
      this.activeTab.set('currency');
      return;
    }
    if (this.accountForm.get('advanced')?.invalid) {
      this.activeTab.set('advanced');
      return;
    }
  }
}

/** Rótulo i18n de cada control, para el resumen de errores. El mismo que usa su `<label>`. */
const ACCOUNT_FIELD_LABELS: Record<string, string> = {
  code: 'accounting.account_form.account_code',
  reasonForChange: 'accounting.account_form.reason_for_change',
  name: 'accounting.account_form.account_name',
  description: 'accounting.account_form.description',
  parentId: 'accounting.account_form.parent_account_grouping',
  type: 'accounting.account_form.account_type',
  nature: 'accounting.account_form.nature_automatic',
  category: 'accounting.account_form.category',
  isPostable: 'accounting.account_form.postable_account_accepts_transactions',
  isActive: 'accounting.account_form.active_account',
  balanceSheetCategory: 'accounting.account_form.balance_sheet_category',
  incomeStatementCategory: 'accounting.account_form.income_statement_category',
  cashFlowCategory: 'accounting.account_form.cash_flow_category',
  fxTreatment: 'accounting.account_form.fx_treatment',
  currency: 'accounting.account_form.account_currency',
  effectiveFrom: 'accounting.account_form.effective_from',
  effectiveTo: 'accounting.account_form.effective_until',
};
