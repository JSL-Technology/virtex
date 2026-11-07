import { VxEmptyStateComponent, VxErrorStateComponent, VxSpinnerComponent } from '../../../../shared/components/feedback';
import { SettingsActionsDirective, SettingsChanges, SettingsShellService } from '../../shell';
import { SettingsDisclosureComponent, SettingsGroupComponent } from '../../shared';
import { VxBadgeComponent, type VxTone } from '../../../../shared/components/badge';
import { ListMenuConfig, VX_CONTEXT_MENU } from '../../../../shared/components/context-menu';
import { DialogService } from '../../../../core/services/dialog.service';
import { CountryNamesService } from '../../../../core/i18n/countries';
import { LucideAngularModule, MoreHorizontal, Percent, Trash2 } from 'lucide-angular';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FiscalSettingsService,
  MarketCoverage,
  WithholdingRegime,
} from '../../../../core/api/fiscal-settings.service';
import { NotificationService } from '../../../../core/services/notification';
import { TranslateModule, FORMAT_PIPES, VxNumberInputDirective } from '@virteex/shared/ui-i18n';
import { composeKey } from '@virteex/shared/types';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

/**
 * The withholding regimes the tenant maintains, and what the product covers in their market.
 *
 * ## Why the two are on one screen
 *
 * They answer the same question from opposite sides. The coverage says what this product does for
 * you here; the regimes are what you supply when the answer is "the rate depends on something only
 * you know". Most of this product's markets are ones where the built-in catalogue deliberately
 * holds nothing — Colombia's ReteICA is municipal, Peru's detracciones depend on the good — so for
 * those tenants this table is the whole of their withholding configuration.
 *
 * `legalBasis` is a required field on the form for the same reason it is required on the entity:
 * the point of moving withholding off the request was to stop the rate being a number somebody
 * typed.
 */
@Component({
  selector: 'app-withholding-regimes-page',
  standalone: true,
  imports: [
    VxNumberInputDirective,
    VxEmptyStateComponent,
    VxErrorStateComponent,
    VxSpinnerComponent,
    VxBadgeComponent,
    SettingsActionsDirective,
    SettingsGroupComponent,
    SettingsDisclosureComponent,
    CommonModule,
    ReactiveFormsModule,
    TranslateModule,
    LucideAngularModule,
    ...VX_CONTEXT_MENU,
    ...FORMAT_PIPES,
    ...VX_FORM_A11Y,
  ],
  templateUrl: './withholding-regimes.page.html',
  styleUrls: ['./withholding-regimes.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WithholdingRegimesPage implements OnInit {
  /** Whether this person may change the section; read-only otherwise (from the settings shell). */
  private readonly shell = inject(SettingsShellService, { optional: true });
  protected readonly canEdit = this.shell?.canEdit ?? signal(true);
  private readonly dialog = inject(DialogService);
  private readonly countryNames = inject(CountryNamesService);
  protected readonly MoreIcon = MoreHorizontal;
  protected readonly RegimeIcon = Percent;

  /** The list could not be read: said in place, with a retry, not as an empty list (EST-02). */
  readonly loadFailed = signal(false);
  /** A regime typed and not saved: closing the window asks before dropping it (GUA-01). */
  readonly formDirty = signal(false);
  private readonly changes: SettingsChanges = {
    dirty: this.formDirty,
    discard: () => this.closeForm(),
  };

  /** Deleting, the one row action: in the shared row menu, asked first (ACC-04). */
  readonly regimesMenu: ListMenuConfig<WithholdingRegime> = {
    resource: 'withholding_regimes',
    row: (ctx) => {
      const row = ctx.entity as WithholdingRegime;
      return [
        {
          id: 'danger',
          items: [{ id: 'delete', label: 'settings.pages.withholding.delete', icon: Trash2, danger: true, visible: () => this.canEdit(), run: () => this.remove(row) }],
        },
      ];
    },
  };

  private readonly api = inject(FiscalSettingsService);
  private readonly fb = inject(FormBuilder);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly regimes = signal<WithholdingRegime[]>([]);
  readonly coverage = signal<MarketCoverage | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly showForm = signal(false);

  protected readonly kinds = [
    { value: 'VAT', labelKey: 'settings.pages.withholding.kind_vat' },
    { value: 'INCOME', labelKey: 'settings.pages.withholding.kind_income' },
  ] as const;

  protected readonly scopes = [
    { value: 'ANY', labelKey: 'settings.pages.withholding.scope_any' },
    { value: 'SERVICES', labelKey: 'settings.pages.withholding.scope_services' },
    { value: 'GOODS', labelKey: 'settings.pages.withholding.scope_goods' },
  ] as const;

  protected readonly payerTypes = [
    { value: 'COMPANY', labelKey: 'settings.pages.withholding.company' },
    { value: 'WITHHOLDING_AGENT', labelKey: 'settings.pages.withholding.designated_withholding_agent' },
    { value: 'GOVERNMENT', labelKey: 'settings.pages.withholding.government' },
    { value: 'INDIVIDUAL', labelKey: 'settings.pages.withholding.individual' },
  ] as const;

  readonly form = this.fb.group({
    code: ['', Validators.required],
    label: ['', Validators.required],
    kind: ['VAT', Validators.required],
    ratePercent: [0, [Validators.required, Validators.min(0), Validators.max(100)]],
    payers: [[] as string[], Validators.required],
    scope: ['ANY'],
    legalBasis: ['', [Validators.required, Validators.minLength(3)]],
  });

  ngOnInit(): void {
    this.load();
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.formDirty.set(this.showForm() && this.form.dirty));
    if (this.shell) {
      this.shell.register(this.changes);
      this.destroyRef.onDestroy(() => this.shell?.unregister(this.changes));
    }
    this.api
      .coverage()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (coverage) => this.coverage.set(coverage),
        // The coverage statement is context, not the point of the page: failing to load it must
        // not stop a tenant configuring the regimes they came here for.
        error: () => this.coverage.set(null),
      });
  }

  load(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.api
      .withholdingRegimes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.regimes.set(rows);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.loadFailed.set(true);
        },
      });
  }

  toggleForm(): void {
    if (this.showForm()) this.closeForm();
    else this.openForm();
  }

  openForm(): void {
    this.showForm.set(true);
    queueMicrotask(() => document.getElementById('w-code')?.focus());
  }

  closeForm(): void {
    this.showForm.set(false);
    this.form.reset({ kind: 'VAT', scope: 'ANY', ratePercent: 0, payers: [] });
    this.formDirty.set(false);
  }

  /** `VAT` → «Sobre el impuesto»: the table showed the enum. */
  kindLabel(kind: string): string {
    return this.kinds.find((item) => item.value === kind)?.labelKey ?? kind;
  }

  countryName(code: string | null | undefined): string {
    return (code && this.countryNames.nameOf(code)) || code || '';
  }

  levelTone(level: string): VxTone {
    switch (level) {
      case 'implemented':
        return 'ok';
      case 'needs-credentials':
        return 'warning';
      case 'not-implemented':
        return 'danger';
      default:
        return 'neutral';
    }
  }

  togglePayer(value: string): void {
    const current = this.form.controls.payers.value ?? [];
    this.form.controls.payers.setValue(
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  isPayerSelected(value: string): boolean {
    return (this.form.controls.payers.value ?? []).includes(value);
  }

  save(): void {
    if (this.form.invalid || (this.form.controls.payers.value ?? []).length === 0) {
      this.form.markAllAsTouched();
      this.notifications.showError('settings.pages.withholding.name_least_one_kind_buyer_applies');
      return;
    }
    const value = this.form.getRawValue();
    this.saving.set(true);

    this.api
      .createWithholdingRegime({
        code: value.code ?? '',
        label: value.label ?? '',
        kind: value.kind as WithholdingRegime['kind'],
        // Entered as a percentage, stored as a fraction, like every other rate in the product.
        rate: Number(value.ratePercent ?? 0) / 100,
        payers: value.payers ?? [],
        payees: [],
        scope: value.scope as WithholdingRegime['scope'],
        legalBasis: value.legalBasis ?? '',
        isActive: true,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.closeForm();
          this.load();
        },
        error: (error) => {
          this.saving.set(false);
          this.notifications.showHttpError(error, 'settings.pages.withholding.save_failed');
        },
      });
  }

  async remove(row: WithholdingRegime): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'settings.pages.withholding.delete_title',
      message: 'settings.pages.withholding.delete_message',
      messageParams: { name: row.label },
      confirmText: 'settings.pages.withholding.delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.api
      .deleteWithholdingRegime(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.load(),
        error: () => this.notifications.showError('settings.pages.withholding.delete_failed'),
      });
  }

  percent(rate: number): number {
    return rate * 100;
  }

  /** The catalogue key for a coverage level, so the reader's language decides how it is worded. */
  levelKey(level: string): string {
    return composeKey('settings.pages.withholding.coverage', level);
  }

  capabilityKey(capability: string): string {
    return composeKey('settings.pages.withholding.capability', capability);
  }
}
