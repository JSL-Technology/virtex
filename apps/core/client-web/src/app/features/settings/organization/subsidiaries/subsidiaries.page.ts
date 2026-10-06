import { Router } from '@angular/router';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { CountryService, SupportedCountry } from '../../../../core/services/country.service';
import { NotificationService } from '../../../../core/services/notification';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Building, Plus, X, Pencil } from 'lucide-angular';
import { SubsidiariesService, Subsidiary, CreateSubsidiaryDto, UpdateSubsidiaryDto } from './subsidiaries.service';
import { Observable, map } from 'rxjs';
import { accountNameOf, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { Account, AccountType } from '../../../../core/models/account.model';
import { ChartOfAccountsApiService } from '../../../accounting/data/chart-of-accounts.service';
import { VX_SELECT } from '../../../../shared/components/select';
import { VxDateFieldComponent } from '../../../../shared/components/date';
import { VxBadgeComponent } from '../../../../shared/components/badge';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxDialogComponent } from '../../../../shared/components/dialog';
import { VxSpinnerComponent, VxEmptyStateComponent } from '../../../../shared/components/feedback';

@Component({
  selector: 'app-subsidiaries',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, ReactiveFormsModule, TranslateModule, ...VX_FORM_A11Y, ...VX_SELECT, ...FORMAT_PIPES, VxDialogComponent, VxSpinnerComponent, VxEmptyStateComponent, VxDateFieldComponent, VxBadgeComponent],
  templateUrl: './subsidiaries.page.html',
  styleUrls: ['./subsidiaries.page.scss'],
  // Signals and OnPush (QA A-16): the state lived in plain fields under a modal host that does not
  // re-check its children on its own, so "loading" could stay on screen after the answer arrived.
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubsidiariesPage implements OnInit {
  // Icons
  protected readonly BuildingIcon = Building;
  protected readonly PlusIcon = Plus;
  protected readonly XIcon = X;
  protected readonly EditIcon = Pencil;

  readonly subsidiaries = signal<Subsidiary[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly showModal = signal(false);
  readonly submitting = signal(false);
  /** The countries the product supports: the country decides the subsidiary's fiscal rules. */
  readonly countries = signal<SupportedCountry[]>([]);
  createForm: FormGroup;
  /** The subsidiary whose consolidation facts are being edited, while that dialog is open. */
  readonly editing = signal<Subsidiary | null>(null);
  readonly savingEdit = signal(false);
  readonly editForm: FormGroup;
  private readonly accounts = inject(ChartOfAccountsApiService);
  private readonly notifications = inject(NotificationService);

  private subsidiariesService = inject(SubsidiariesService);

  private fb = inject(FormBuilder);
  private readonly countryService = inject(CountryService);
  private readonly router = inject(Router);
  /**
   * The example identifier for the country currently selected on the form.
   *
   * The input used to carry `placeholder="Ej. 132-45678-9"` — the shape of a Dominican RNC, in
   * Spanish, written into the template — shown to a tenant in any of the nineteen markets. The
   * country's own example has always been served by `PublicCountryConfig.taxIdExample`; it just
   * was not read here.
   */
  protected taxIdExample(): string {
    const country = this.createForm?.get('country')?.value as string | undefined;
    if (!country) return '';
    return this.countryService.currentCountry()?.countryCode === country.toUpperCase()
      ? (this.countryService.currentCountry()?.taxIdExample ?? '')
      : (this.taxIdExamples.get(country.toUpperCase()) ?? '');
  }

  /**
   * The selected country's own name for its fiscal identifier — RNC, RUC, CNPJ (A-01).
   *
   * It used to be `settings.subsidiaries.tax_id` renamed per locale in `regional.json`, which made
   * the label follow the READER's language rather than the subsidiary's jurisdiction: a tenant read
   * "RNC" in Spanish and "Tax ID" in English for the same Dominican company. The name is a property
   * of the country now, served as `taxIdLabel` (derived from the catalogue's company row), so it
   * follows the picker.
   */
  protected taxIdLabel(): string {
    const country = this.createForm?.get('country')?.value as string | undefined;
    if (!country) return '';
    return this.countryService.currentCountry()?.countryCode === country.toUpperCase()
      ? (this.countryService.currentCountry()?.taxIdLabel ?? '')
      : (this.taxIdLabels.get(country.toUpperCase()) ?? '');
  }

  /** Examples and labels already fetched, so switching the picker does not refetch on every render. */
  private readonly taxIdExamples = new Map<string, string>();
  private readonly taxIdLabels = new Map<string, string>();

  /** Fetch and remember the example and label for a country, when the picker moves. */
  protected onCountryChanged(countryCode: string | null | undefined): void {
    const country = countryCode?.trim().toUpperCase();
    if (!country || this.taxIdExamples.has(country)) return;
    this.countryService
      .getCountryConfig(country)
      .pipe(catchError(() => of(null)))
      .subscribe((config) => {
        if (config) {
          this.taxIdExamples.set(country, config.taxIdExample);
          this.taxIdLabels.set(country, config.taxIdLabel);
        }
      });
  }



  /** The parent's own postable asset accounts: the investment sits in the PARENT's books. */
  protected readonly searchInvestmentAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accounts
      .searchAccounts(query, Math.max(limit * 3, 50))
      .pipe(map((rows) => rows.filter((a) => a.isPostable && a.type === AccountType.ASSET).slice(0, limit)));
  protected readonly resolveAccount = (id: string): Observable<Account> => this.accounts.getAccountById(id);
  protected readonly accountLabel = (account: Account): string => `${account.code} — ${accountNameOf(account.name)}`;
  protected readonly accountId = (account: Account): string => account.id;

  constructor() {
    this.editForm = this.fb.group({
      ownership: [100, [Validators.required, Validators.min(0), Validators.max(100)]],
      acquisitionDate: [''],
      acquisitionCost: [null as number | null, [Validators.min(0)]],
      investmentAccountId: [''],
      controlEndedOn: [''],
    });
    this.createForm = this.fb.group({
      legalName: ['', [Validators.required]],
      taxId: ['', [Validators.required]],
      country: ['', [Validators.required]],
      ownership: [100, [Validators.required, Validators.min(0), Validators.max(100)]]
    });

    // Each subsidiary has its own country, so the tax-id example follows the picker rather than
    // being the Dominican one for all of them, which is what the hardcoded placeholder did.
    this.createForm
      .get('country')
      ?.valueChanges.subscribe((country: string) => this.onCountryChanged(country));
  }

  ngOnInit() {
    this.loadSubsidiaries();
    // `#settings/subsidiaries/new` («Nueva subsidiaria», from the company switcher): open the form straight away, and leave
    // the fragment at the section so closing the form or reloading does not reopen it.
    if (this.router.url.split('#')[1] === 'settings/subsidiaries/new') {
      this.openCreateModal();
      void this.router.navigate([], { fragment: 'settings/subsidiaries', replaceUrl: true });
    }
    this.countryService
      .getSupportedCountries()
      .pipe(catchError(() => of([] as SupportedCountry[])))
      .subscribe((countries) => this.countries.set(countries));
  }

  loadSubsidiaries() {
    this.loading.set(true);
    this.loadError.set(null);
    this.subsidiariesService.getSubsidiaries().subscribe({
      next: (data) => {
        this.subsidiaries.set(data);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        // It went to the console: the screen kept the empty state, which reads as "you have none".
        this.loadError.set(this.notifications.httpErrorMessage(error, 'settings.subsidiaries.load_failed'));
        this.loading.set(false);
      },
    });
  }

  openCreateModal() {
    this.createForm.reset({ ownership: 100, country: this.countryService.currentCountry()?.countryCode ?? '' });
    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
  }

  openEdit(link: Subsidiary): void {
    this.editForm.reset({
      ownership: Number(link.ownership),
      acquisitionDate: link.acquisitionDate ?? '',
      acquisitionCost: link.acquisitionCost,
      investmentAccountId: link.investmentAccountId ?? '',
      controlEndedOn: link.controlEndedOn ?? '',
    });
    this.editing.set(link);
  }

  closeEdit(): void {
    this.editing.set(null);
  }

  /** Control cannot end before it began; the server says so too, this says it before the trip. */
  protected controlEndsTooEarly(): boolean {
    const { acquisitionDate, controlEndedOn } = this.editForm.value as { acquisitionDate: string; controlEndedOn: string };
    return Boolean(acquisitionDate && controlEndedOn && controlEndedOn < acquisitionDate);
  }

  saveEdit(): void {
    const link = this.editing();
    if (!link) return;
    if (this.editForm.invalid || this.controlEndsTooEarly()) {
      this.editForm.markAllAsTouched();
      return;
    }
    const value = this.editForm.getRawValue() as {
      ownership: number;
      acquisitionDate: string;
      acquisitionCost: number | null;
      investmentAccountId: string;
      controlEndedOn: string;
    };
    // Empty fields are sent as null: clearing a date is a change, not an omission.
    const body: UpdateSubsidiaryDto = {
      ownership: Number(value.ownership),
      acquisitionDate: value.acquisitionDate || null,
      acquisitionCost: value.acquisitionCost === null || (value.acquisitionCost as unknown) === '' ? null : Number(value.acquisitionCost),
      investmentAccountId: value.investmentAccountId || null,
      controlEndedOn: value.controlEndedOn || null,
    };
    this.savingEdit.set(true);
    this.subsidiariesService.updateSubsidiary(link.subsidiaryOrganizationId, body).subscribe({
      next: (saved) => {
        this.subsidiaries.update((list) =>
          list.map((row) =>
            row.subsidiaryOrganizationId === saved.subsidiaryOrganizationId ? { ...row, ...saved, subsidiary: row.subsidiary } : row,
          ),
        );
        this.savingEdit.set(false);
        this.notifications.showSuccess('settings.subsidiaries.updated');
        this.closeEdit();
      },
      error: (error: unknown) => {
        this.savingEdit.set(false);
        this.notifications.showHttpError(error, 'settings.subsidiaries.update_failed');
      },
    });
  }

  onSubmit() {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    const data: CreateSubsidiaryDto = this.createForm.value;
    this.subsidiariesService.createSubsidiary(data).subscribe({
      next: (created) => {
        this.subsidiaries.update((list) => [...list, created]);
        this.notifications.showSuccess('settings.subsidiaries.created');
        this.submitting.set(false);
        this.closeModal();
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        this.notifications.showHttpError(error, 'settings.subsidiaries.create_failed');
      },
    });
  }
}
