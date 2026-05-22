
import { Component, Input, Output, EventEmitter, inject, signal, effect, DestroyRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule, Globe, CreditCard, Building2 } from 'lucide-angular';
import { CountryService, CountryConfig } from '../../../../../core/services/country.service';
import { debounceTime, switchMap, tap, filter, distinctUntilChanged, catchError } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { AsyncValidators } from '../../../../../shared/validators/async.validators';

@Component({
  selector: 'app-step-configuration',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LucideAngularModule],
  template: `
    <div [formGroup]="form" class="space-y-6">
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
          <lucide-icon [img]="Building2Icon" class="w-8 h-8"></lucide-icon>
        </div>
        <h2 class="text-2xl font-bold text-gray-900 dark:text-white">Identidad Fiscal</h2>
        <p class="mt-2 text-gray-600 dark:text-gray-400">
          Selecciona tu país e ingresa tu identificación fiscal para configurar tu entorno.
        </p>
      </div>

      <div class="space-y-4">
        <!-- Country Selection -->
        <div class="form-group">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            País
          </label>
          <div class="relative">
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
              <lucide-icon [img]="GlobeIcon" class="w-5 h-5"></lucide-icon>
            </div>
            <select
              formControlName="country"
              (change)="onCountryChange($event)"
              class="pl-10 w-full rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-primary focus:border-primary transition-colors"
            >
              <option value="DO">República Dominicana</option>
              <option value="CO">Colombia</option>
              <option value="MX">México</option>
              <option value="US">United States</option>
              <option value="PA">Panamá</option>
              <option value="CR">Costa Rica</option>
              <option value="PE">Perú</option>
              <option value="CL">Chile</option>
            </select>
          </div>
        </div>

        <!-- Tax ID Input -->
        <div class="form-group">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {{ currentLabel() }}
          </label>
          <div class="relative">
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
              <lucide-icon [img]="CreditCardIcon" class="w-5 h-5"></lucide-icon>
            </div>
            <input
              type="text"
              formControlName="taxId"
              [placeholder]="currentPlaceholder()"
              class="pl-10 w-full rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-primary focus:border-primary transition-colors"
              [class.border-red-500]="form.get('taxId')?.invalid && form.get('taxId')?.touched"
              [class.border-green-500]="isValidTaxId()"
            />
            <!-- Loading Indicator -->
             <div *ngIf="isValidating()" class="absolute inset-y-0 right-0 pr-3 flex items-center">
                <div class="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full"></div>
             </div>
          </div>
          <p *ngIf="form.get('taxId')?.invalid && form.get('taxId')?.touched" class="mt-1 text-sm text-red-500">
             {{ getErrorMessage() }}
          </p>
          <p *ngIf="isValidTaxId()" class="mt-1 text-sm text-green-500">
             Identificación válida. Empresa encontrada.
          </p>
        </div>

        <!-- Auto-detected info summary -->
        <div *ngIf="foundCompany()" class="p-4 bg-primary/5 rounded-lg border border-primary/20">
            <p class="text-sm text-gray-700 dark:text-gray-300"><strong>Razón Social:</strong> {{ foundCompany()?.legalName }}</p>
            <p class="text-sm text-gray-700 dark:text-gray-300"><strong>Estado:</strong> {{ foundCompany()?.status }}</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
  `]
})
export class StepConfiguration implements OnInit {
  @Input() form!: FormGroup;
  @Input() parentForm!: FormGroup;

  protected readonly Building2Icon = Building2;
  protected readonly GlobeIcon = Globe;
  protected readonly CreditCardIcon = CreditCard;

  countryService = inject(CountryService);
  destroyRef = inject(DestroyRef); // Inject DestroyRef
  private http = inject(HttpClient);

  currentLabel = signal('Tax ID');
  currentPlaceholder = signal('Ingrese su identificación');
  isValidating = signal(false);
  foundCompany = signal<any>(null);

  constructor() {
      // Monitor country changes
      effect(() => {
          const config = this.countryService.currentCountry();
          if (config) {
              this.currentLabel.set(config.taxIdLabel || 'Tax ID');
              this.currentPlaceholder.set(config.taxIdMask || 'Ingrese su identificación');

              // If backend provides a default fiscal region ID, we should set it here or in the page
              if (config.fiscalRegionId && this.parentForm) {
                 this.parentForm.patchValue({
                     configuration: { fiscalRegionId: config.fiscalRegionId }
                 });
              }
          }
      });
  }

  ngOnInit() {
      // Async validator for uniqueness
      if (this.form) {
          const taxControl = this.form.get('taxId');
          if (taxControl) {
              taxControl.addAsyncValidators(AsyncValidators.createTaxIdValidator(this.http));
              taxControl.updateValueAndValidity();
          }
      }

      this.form.get('taxId')?.valueChanges.pipe(
          debounceTime(500),
          distinctUntilChanged(),
          filter(value => value && value.length > 5),
          tap(() => this.isValidating.set(true)),
          switchMap(value => {
              const country = this.form.get('country')?.value;
              return this.countryService.lookupTaxId(value, country).pipe(
                  catchError(() => of(null))
              );
          }),
          takeUntilDestroyed(this.destroyRef) // Pass DestroyRef
      ).subscribe((data) => {
          this.isValidating.set(false);
          if (data && data.isValid) {
              this.foundCompany.set(data);
              if (this.parentForm) {
                  this.parentForm.patchValue({
                      business: {
                          companyName: data.legalName,
                          industry: data.industry,
                      }
                  });
                  // If response includes regionId (rare, usually from country config), use it
              }
          } else {
              this.foundCompany.set(null);
          }
      });
  }

  onCountryChange(event: any) {
      const countryCode = event.target.value;
      this.countryService.getCountryConfig(countryCode).subscribe();
  }

  isValidTaxId() {
      return this.foundCompany() !== null;
  }

  getErrorMessage() {
      const control = this.form.get('taxId');
      if (control?.hasError('taxIdExists')) {
          return 'Esta organización ya está registrada.';
      }
      return 'Formato inválido';
  }
}
