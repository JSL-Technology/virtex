import { Component, ChangeDetectionStrategy, signal, inject, OnInit, computed } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DialogService } from '../../../core/services/dialog.service';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, Trash2 } from 'lucide-angular';
import { Tax, taxTypeLabel } from '../../../core/models/tax.model';
import { TaxesService } from '../../../core/api/taxes.service';
import { NotificationService } from '../../../core/services/notification';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { TranslateService } from '@ngx-translate/core';
import { TranslateModule, FORMAT_PIPES, tenantToday } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxAmountComponent } from '../../../shared/components/amount';
import { CanOpenDirective } from '../../../core/modules/can-open.directive';
import { VX_SORT, sortable } from '../../../shared/components/sort';
import { CountryPackService } from '../../../core/api/country-pack.service';
import { FiscalSettingsService, TaxJurisdiction } from '../../../core/api/fiscal-settings.service';
import { VxDateFieldComponent } from '../../../shared/components/date';
import { LocaleStore } from '@virteex/shared/ui-i18n';

/**
 * The company's taxes.
 *
 * Two shapes, because markets have two. Where the consumption tax is a national table (ITBIS, IVA,
 * IGV) the list below is the tax: the rates provisioning seeded from the market's scheme, editable.
 * Where it is not — the United States, where sales tax is the sum of the state, county and city the
 * sale is delivered to, and Brazil — a national rate would be wrong everywhere, so nothing is seeded
 * and the list stayed empty with «There is nothing here yet» and no hint of what to do (QA C-06).
 *
 * For those markets the page now leads with the tax as it actually works: the states the company
 * collects in, each with its rate and the date it took effect, and a guided form to add the first
 * one with a state picker. Invoices to customers in a registered state are charged that state's
 * combined rate; county and city rates hang off the state in Settings › Tax jurisdictions.
 */
@Component({
  selector: 'app-taxes-page',
  standalone: true,
  imports: [...VX_SORT, ReactiveFormsModule, VxDateFieldComponent, CanOpenDirective, LucideAngularModule, RouterLink, TranslateModule, ...FORMAT_PIPES, ListShellComponent, HasPermissionDirective, VxAmountComponent],
  templateUrl: './taxes.page.html',
  styleUrls: ['./taxes.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaxesPage implements OnInit {
  private readonly translate = inject(TranslateService);
  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.taxes(), { type: (tax) => this.translate.instant(taxTypeLabel(tax.type)) });
  readonly taxTypeLabel = taxTypeLabel;
  private readonly dialog = inject(DialogService);
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly TrashIcon = Trash2;

  private taxesService = inject(TaxesService);
  private notificationService = inject(NotificationService);

  taxes = signal<Tax[]>([]);
  isLoading = signal(true);

  // ── Sales tax by jurisdiction (markets with no national rate) ───────────────

  private readonly countryPack = inject(CountryPackService);
  private readonly fiscalSettings = inject(FiscalSettingsService);
  private readonly locale = inject(LocaleStore);
  private readonly fb = inject(FormBuilder);

  readonly byJurisdiction = computed(() => this.countryPack.pack()?.taxes.model === 'BY_JURISDICTION');
  readonly taxNameKey = computed(() => this.countryPack.pack()?.taxes.nameKey ?? 'masters.taxes.tax_rates');
  readonly divisions = computed(() => this.countryPack.pack()?.divisions ?? []);
  readonly jurisdictions = signal<TaxJurisdiction[]>([]);
  readonly addingState = signal(false);
  readonly savingState = signal(false);

  /**
   * One row per registered state: its own rate, the local rates under it, and the combined rate a
   * sale delivered there is charged. Only rates in force today.
   */
  readonly registeredStates = computed(() => {
    const today = todayIso();
    const current = this.jurisdictions().filter(
      (row) => row.isRegistered && row.effectiveFrom <= today && (!row.effectiveTo || row.effectiveTo >= today),
    );
    const states = current.filter((row) => row.level === 'STATE');
    return states.map((state) => {
      const local = current.filter((row) => row.stateCode === state.stateCode && row.level !== 'STATE');
      return {
        id: state.id,
        stateCode: state.stateCode,
        stateName: this.divisionName(state.stateCode),
        rate: state.rate,
        localCount: local.length,
        combined: state.rate + local.reduce((sum, row) => sum + row.rate, 0),
        effectiveFrom: state.effectiveFrom,
      };
    });
  });

  /** The states not registered yet: a state is added once, then its rate is updated by date. */
  readonly availableDivisions = computed(() => {
    const taken = new Set(this.registeredStates().map((row) => row.stateCode));
    return this.divisions().filter((division) => !taken.has(division.code));
  });

  /** Entered as a percentage — a taxpayer reads Texas as 6.25, not 0.0625. */
  readonly stateForm = this.fb.nonNullable.group({
    stateCode: ['', Validators.required],
    ratePercent: [null as number | null, [Validators.required, Validators.min(0), Validators.max(100)]],
    effectiveFrom: [todayIso(), Validators.required],
  });

  ngOnInit(): void {
    this.loadTaxes();
    this.loadJurisdictions();
  }

  loadJurisdictions(): void {
    this.fiscalSettings.jurisdictions().subscribe({
      next: (rows) => this.jurisdictions.set(rows),
      // A market with no jurisdictions shows its guided empty state; a failure to read them is
      // said once rather than leaving the section looking empty.
      error: () => this.jurisdictions.set([]),
    });
  }

  divisionName(code: string): string {
    return this.divisions().find((division) => division.code === code)?.name ?? code;
  }

  startState(): void {
    this.stateForm.reset({ stateCode: '', ratePercent: null, effectiveFrom: todayIso() });
    this.addingState.set(true);
  }

  saveState(): void {
    if (this.stateForm.invalid) {
      this.stateForm.markAllAsTouched();
      return;
    }
    const value = this.stateForm.getRawValue();
    const country = this.countryPack.pack()?.countryCode ?? this.locale.tenantContext()?.countryCode ?? '';
    const stateName = this.divisionName(value.stateCode);
    this.savingState.set(true);
    this.fiscalSettings
      .createJurisdiction({
        countryCode: country.toUpperCase(),
        stateCode: value.stateCode,
        level: 'STATE',
        name: this.translate.instant('masters.taxes.state_rate_name', {
          state: stateName,
          tax: this.translate.instant(this.taxNameKey()),
        }),
        rate: Number(value.ratePercent ?? 0) / 100,
        isRegistered: true,
        sourcing: 'DESTINATION',
        effectiveFrom: value.effectiveFrom,
        effectiveTo: null,
      })
      .subscribe({
        next: () => {
          this.savingState.set(false);
          this.addingState.set(false);
          this.notificationService.showSuccess('masters.taxes.state_registered', { state: stateName });
          this.loadJurisdictions();
        },
        error: (error: unknown) => {
          this.savingState.set(false);
          this.notificationService.showHttpError(error, 'masters.taxes.state_save_failed');
        },
      });
  }

  loadTaxes(): void {
    this.isLoading.set(true);
    this.taxesService.getTaxes().subscribe({
      next: (data) => {
        this.taxes.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.notificationService.showError('masters.taxes.taxes_could_not_loaded');
        this.isLoading.set(false);
      },
    });
  }

  async deleteTax(tax: Tax): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'dialog.delete_tax.title',
      message: 'dialog.delete_tax.message',
      messageParams: { name: tax.name },
      confirmText: 'common.delete',
      variant: 'danger',
    });
    if (confirmed) {
      this.taxesService.deleteTax(tax.id).subscribe({
        next: () => {
          this.notificationService.showSuccess('masters.taxes.tax_deleted');
          this.loadTaxes();
        },
        error: (error: unknown) => this.notificationService.showHttpError(error, 'masters.taxes.error_deleting_tax'),
      });
    }
  }
}

function todayIso(): string {
  // The company's today, not the browser's or UTC (QA R3-M02).
  return tenantToday();
}
