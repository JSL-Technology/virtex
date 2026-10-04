import { Router } from '@angular/router';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { CountryService, SupportedCountry } from '../../../../core/services/country.service';
import { NotificationService } from '../../../../core/services/notification';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Building, Plus, X } from 'lucide-angular';
import { SubsidiariesService, Subsidiary, CreateSubsidiaryDto } from './subsidiaries.service';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxDialogComponent } from '../../../../shared/components/dialog';
import { VxSpinnerComponent, VxEmptyStateComponent } from '../../../../shared/components/feedback';

@Component({
  selector: 'app-subsidiaries',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, ReactiveFormsModule, TranslateModule, ...VX_FORM_A11Y, VxDialogComponent, VxSpinnerComponent, VxEmptyStateComponent],
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

  readonly subsidiaries = signal<Subsidiary[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly showModal = signal(false);
  readonly submitting = signal(false);
  /** The countries the product supports: the country decides the subsidiary's fiscal rules. */
  readonly countries = signal<SupportedCountry[]>([]);
  createForm: FormGroup;
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



  constructor() {
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
    // `#settings/subsidiaries/new` (from «Nueva sucursal»): open the form straight away, and leave
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
