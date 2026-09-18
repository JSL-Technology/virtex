import { Component, ChangeDetectionStrategy, inject, OnInit, signal, input, effect } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CustomersService, CreateCustomerDto, UpdateCustomerDto } from '../../../core/api/customers.service';
import { NotificationService } from '../../../core/services/notification';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { CountryNamesService } from '../../../core/i18n/countries';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { TranslateService } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import {
  IdentityDocumentsService,
  IdentityDocumentTypeOption,
} from '../../../core/api/identity-documents.service';

@Component({
  selector: 'app-customer-form-page',
  imports: [ReactiveFormsModule, TranslateModule, DraftShellComponent, ...VX_FORM_A11Y],
  templateUrl: './customer-form.page.html',
  styleUrls: ['./customer-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerFormPage implements OnInit {
  /** La ventana que hospeda esta página, cuando la hay. Nula si la monta el router. */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });
  id = input<string>();

  /**
   * The fiscal classifications a customer can hold, in the order they are met.
   *
   * Kept as a plain list rather than pulled from a lookup endpoint: these are the categories every
   * withholding regime in the product is written against, so a value the server does not know
   * would silently withhold nothing.
   */
  /**
   * The identifiers this tenant's country issues, from the catalogue.
   *
   * The form used to have a single free-text `taxId` with no type beside it, so a Dominican RNC
   * and a Dominican cédula were indistinguishable in the same column and the label had to read
   * "RNC / Cédula" — one input named after the two things it was doing.
   */
  protected readonly documentTypes = signal<IdentityDocumentTypeOption[]>([]);

  protected readonly taxpayerTypes = [
    { value: 'INDIVIDUAL', labelKey: 'contacts.customer_form.individual' },
    { value: 'COMPANY', labelKey: 'contacts.customer_form.company' },
    {
      value: 'WITHHOLDING_AGENT',
      labelKey: 'contacts.customer_form.designated_withholding_agent',
    },
    { value: 'GOVERNMENT', labelKey: 'contacts.customer_form.government_body' },
    { value: 'FOREIGN', labelKey: 'contacts.customer_form.customer_abroad' },
  ] as const;

  private fb = inject(FormBuilder);
  private router = inject(Router);
  private customersService = inject(CustomersService);
  private notificationService = inject(NotificationService);
  private readonly countryNames = inject(CountryNamesService);
  private readonly identityDocuments = inject(IdentityDocumentsService);
  private readonly locale = inject(LocaleStore);
  private readonly translate = inject(TranslateService);

  /** Every country, in the reader's language. See `CountryNamesService`. */
  protected readonly countries = this.countryNames.options;


  /** Qué falta antes de guardar. Se llena al pulsar, no mientras se teclea el primer campo. */
  readonly problems = signal<DraftProblem[]>([]);

  customerForm!: FormGroup;
  isEditMode = signal(false);
  isLoading = signal(true);

  constructor() {
    effect(() => {
      const idValue = this.id();
      if (idValue) {
        this.isEditMode.set(true);
        this.loadCustomerData(idValue);
      } else {
        this.isEditMode.set(false);
        this.isLoading.set(false);
      }
    });
  }

  ngOnInit(): void {
    this.customerForm = this.fb.group({
      companyName: ['', Validators.required],
      contactPerson: [''],
      //  Optional, matching the supplier form and the server. Still validated AS an email when
      //  one is given: an optional field is not an unchecked one.
      email: ['', [Validators.email]],
      phone: [''],
      taxId: [''],
      // Which identifier `taxId` holds. Filled from the catalogue's default for this tenant's
      // country once the list arrives; there is no literal default, because the only literal that
      // would fit every market is the wrong one.
      identityDocumentTypeCode: [''],
      // The buyer's fiscal classification, which decides what they withhold at source. Left blank
      // the server withholds nothing automatically, which is the safe default: the classification
      // is assigned by the tax authority and is not derivable from anything else on this form.
      taxpayerType: [''],
      address: [''],
      city: [''],
      stateOrProvince: [''],
      postalCode: [''],
      // The TENANT's country, not `'DO'`. A Chilean tenant's customers are Chilean by default, and
      // this field decides which registry a tax id is checked against — so a hardcoded default here
      // is a wrong validation, not a cosmetic one.
      country: [this.locale.tenantContext()?.countryCode ?? '', Validators.required],
      //  Los términos de pago: uno para imprimir, otro para calcular. El campo de texto existía en
      //  la base de datos desde el principio y nadie lo leía —una cadena no se le suma a una
      //  fecha—, así que toda factura nacía venciendo el mismo día en que se emitía.
      paymentTerms: [''],
      paymentTermDays: [null as number | null],
    });

    this.identityDocuments
      .list({ appliesTo: 'both', usedFor: 'invoicing' })
      .pipe(catchError(() => of([] as IdentityDocumentTypeOption[])))
      .subscribe((types) => this.applyDocumentTypes(types));

    // The tax-id shape check follows the selected document type — an RNC and a cédula are not the
    // same shape — so it is re-applied whenever the type changes.
    this.customerForm
      .get('identityDocumentTypeCode')
      ?.valueChanges.subscribe(() => this.syncTaxIdValidators());
  }

  /**
   * Adopt the catalogue, preselecting the country's default only when nothing is chosen yet.
   *
   * Never on an existing customer that already has a type: silently rewriting it on render is a
   * data change disguised as a display.
   */
  private applyDocumentTypes(types: IdentityDocumentTypeOption[]): void {
    this.documentTypes.set(types);
    const control = this.customerForm?.get('identityDocumentTypeCode');
    if (control && !control.value) {
      const preset = types.find((type) => type.isDefault) ?? types[0];
      if (preset) control.setValue(preset.code, { emitEvent: false });
    }
    // Whether the type was just preset or arrived with an existing customer, the tax-id field's
    // shape check follows it.
    this.syncTaxIdValidators();
  }

  /**
   * Apply the selected document's shape to the tax-id field for immediate feedback (B-01).
   *
   * `pattern` travels from the catalogue precisely so a mistyped RNC or CUIT is caught as the user
   * types rather than at submit; it was published and never consumed. The check digit stays the
   * server's. The field itself is NOT made required: a walk-in consumer has no tax id, and the
   * buyer-tax-id rule is enforced per fiscal document type at invoice time, not here.
   */
  private syncTaxIdValidators(): void {
    const taxId = this.customerForm?.get('taxId');
    if (!taxId) return;
    const selected = this.customerForm?.get('identityDocumentTypeCode')?.value as string | undefined;
    const type = this.documentTypes().find((option) => option.code === selected);
    taxId.setValidators(type ? [Validators.pattern(new RegExp(type.pattern))] : []);
    taxId.updateValueAndValidity({ emitEvent: false });
  }

  /**
   * What to call a document on screen.
   *
   * `labelVerbatim` wins where the catalogue sets it: "CUIT" and "CNPJ" are the words printed on
   * the paper the user is copying from, and translating them makes them harder to find.
   */
  protected documentLabel(type: IdentityDocumentTypeOption): string {
    return this.identityDocuments.label(type, (key) => this.translate.instant(key));
  }

  /** The example for the selected document, so the placeholder shows that country's shape. */
  protected documentExample(): string {
    const selected = this.customerForm?.get('identityDocumentTypeCode')?.value as string | undefined;
    return this.documentTypes().find((type) => type.code === selected)?.example ?? '';
  }

  loadCustomerData(id: string): void {
    this.isLoading.set(true);
    this.customersService.getCustomerById(id).subscribe({
      next: (customer) => {
        this.customerForm.patchValue(customer);
        this.isLoading.set(false);
      },
      error: () => {
        this.notificationService.showError('contacts.customer_form.customer_could_not_loaded');
        this.router.navigate(['/contacts/customers']);
      },
    });
  }

  cancel(): void {
    void this.router.navigate(['/contacts/customers']);
  }

  saveCustomer(): void {
    if (this.customerForm.invalid) {
      this.customerForm.markAllAsTouched();
      this.problems.set(
        draftProblems(this.customerForm, {
          companyName: 'contacts.customer_form.company_name',
          contactPerson: 'contacts.customer_form.contact_person',
          taxId: 'contacts.customer_form.tax_id',
          taxpayerType: 'contacts.customer_form.taxpayer_type',
          email: 'contacts.customer_form.email',
          phone: 'contacts.customer_form.phone',
          address: 'contacts.customer_form.address_line',
          city: 'contacts.customer_form.city',
          stateOrProvince: 'contacts.customer_form.state_province',
          postalCode: 'contacts.customer_form.postal_code',
          country: 'contacts.customer_form.country',
          paymentTerms: 'contacts.customer_form.payment_terms',
          paymentTermDays: 'contacts.customer_form.credit_days',
        }),
      );
      return;
    }

    this.problems.set([]);

    this.isLoading.set(true);
    const { taxpayerType, ...rest } = this.customerForm.getRawValue();

    // "Sin clasificar" is the select's empty option, and the field help tells the user to leave it
    // there when they do not know the classification. It was sent as the empty string, which
    // `@IsEnum(TaxpayerType)` rejects — `@IsOptional()` only forgives null and undefined — so the
    // DEFAULT state of the form could not be saved at all: every customer created without touching
    // this select came back `400 taxpayerType does not accept that value`. Null is the value that
    // means "unclassified" in the column, and the one the validator lets through.
    const formValue = {
      ...rest,
      taxpayerType: taxpayerType || null,
      //  Vacío no es cero: cero significa «al contado» y vacío «usa el valor por defecto de la
      //  organización». El `<input type="number">` entrega cadena vacía para ambos.
      paymentTermDays:
        rest.paymentTermDays === '' || rest.paymentTermDays === null
          ? null
          : Number(rest.paymentTermDays),
    };

    const customerId = this.id();
    const operation = customerId
      ? this.customersService.updateCustomer(customerId, formValue as UpdateCustomerDto)
      : this.customersService.createCustomer(formValue as CreateCustomerDto);

    operation.subscribe({
      next: () => {
        this.notificationService.showSuccess(this.isEditMode() ? 'contacts.customer_form.customer_updated' : 'contacts.customer_form.customer_created');
        //  Esta ventana ya cumplió: el registro existe y la página se va a la lista. Si se dejara
        //  abierta seguiría anunciándose como «el formulario nuevo», y el siguiente clic en «Nuevo»
        //  la enfocaría con el documento ya guardado dentro. Ver `TabContext.close`.
        void this.router.navigate(['/contacts/customers']).then(() => this.tab?.close());
      },
      error: (err) => {
        // The server says exactly what it refused and says it in the reader's language; throwing
        // that away for "Could not create the customer" is what made the failure above impossible
        // to act on. The generic key stays as the fallback for a network error with no body.
        const serverMessage = typeof err?.error?.message === 'string' ? err.error.message : null;
        this.notificationService.showError(
          serverMessage ??
            (this.isEditMode()
              ? 'contacts.customer_form.error_updating_customer'
              : 'contacts.customer_form.error_creating_customer'),
        );
        this.isLoading.set(false);
      },
    });
  }
}
