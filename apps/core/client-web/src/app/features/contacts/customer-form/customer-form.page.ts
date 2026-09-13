import { Component, ChangeDetectionStrategy, inject, OnInit, signal, input, effect } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CustomersService, CreateCustomerDto, UpdateCustomerDto } from '../../../core/api/customers.service';
import { NotificationService } from '../../../core/services/notification';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { CountryNamesService } from '../../../core/i18n/countries';

@Component({
  selector: 'app-customer-form-page',
  imports: [ReactiveFormsModule, TranslateModule, DraftShellComponent],
  templateUrl: './customer-form.page.html',
  styleUrls: ['./customer-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerFormPage implements OnInit {
  id = input<string>();

  /**
   * The fiscal classifications a customer can hold, in the order they are met.
   *
   * Kept as a plain list rather than pulled from a lookup endpoint: these are the categories every
   * withholding regime in the product is written against, so a value the server does not know
   * would silently withhold nothing.
   */
  protected readonly taxpayerTypes = [
    { value: 'INDIVIDUAL', labelKey: 'CONTACTS.CUSTOMER_FORM.TIPO_CONTRIBUYENTE_INDIVIDUAL' },
    { value: 'COMPANY', labelKey: 'CONTACTS.CUSTOMER_FORM.TIPO_CONTRIBUYENTE_COMPANY' },
    {
      value: 'WITHHOLDING_AGENT',
      labelKey: 'CONTACTS.CUSTOMER_FORM.TIPO_CONTRIBUYENTE_WITHHOLDING_AGENT',
    },
    { value: 'GOVERNMENT', labelKey: 'CONTACTS.CUSTOMER_FORM.TIPO_CONTRIBUYENTE_GOVERNMENT' },
    { value: 'FOREIGN', labelKey: 'CONTACTS.CUSTOMER_FORM.TIPO_CONTRIBUYENTE_FOREIGN' },
  ] as const;

  private fb = inject(FormBuilder);
  private router = inject(Router);
  private customersService = inject(CustomersService);
  private notificationService = inject(NotificationService);
  private readonly countryNames = inject(CountryNamesService);

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
      email: ['', [Validators.required, Validators.email]],
      phone: ['', Validators.required],
      taxId: [''],
      // The buyer's fiscal classification, which decides what they withhold at source. Left blank
      // the server withholds nothing automatically, which is the safe default: the classification
      // is assigned by the tax authority and is not derivable from anything else on this form.
      taxpayerType: [''],
      address: [''],
      city: [''],
      stateOrProvince: [''],
      postalCode: [''],
      country: ['DO', Validators.required],
      //  Los términos de pago: uno para imprimir, otro para calcular. El campo de texto existía en
      //  la base de datos desde el principio y nadie lo leía —una cadena no se le suma a una
      //  fecha—, así que toda factura nacía venciendo el mismo día en que se emitía.
      paymentTerms: [''],
      paymentTermDays: [null as number | null],
    });
  }

  loadCustomerData(id: string): void {
    this.isLoading.set(true);
    this.customersService.getCustomerById(id).subscribe({
      next: (customer) => {
        this.customerForm.patchValue(customer);
        this.isLoading.set(false);
      },
      error: () => {
        this.notificationService.showError('CONTACTS.CUSTOMER_FORM.PUDO_CARGAR_CLIENTE');
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
          companyName: 'CONTACTS.CUSTOMER_FORM.NOMBRE_EMPRESA',
          contactPerson: 'CONTACTS.CUSTOMER_FORM.PERSONA_CONTACTO',
          taxId: 'CONTACTS.CUSTOMER_FORM.ID_FISCAL_RNC_ETC',
          taxpayerType: 'CONTACTS.CUSTOMER_FORM.TIPO_CONTRIBUYENTE',
          email: 'CONTACTS.CUSTOMER_FORM.CORREO_ELECTRONICO',
          phone: 'CONTACTS.CUSTOMER_FORM.TELEFONO',
          address: 'CONTACTS.CUSTOMER_FORM.LINEA_DIRECCION',
          city: 'CONTACTS.CUSTOMER_FORM.CIUDAD',
          stateOrProvince: 'CONTACTS.CUSTOMER_FORM.ESTADO_PROVINCIA',
          postalCode: 'CONTACTS.CUSTOMER_FORM.CODIGO_POSTAL',
          country: 'CONTACTS.CUSTOMER_FORM.PAIS',
          paymentTerms: 'CONTACTS.CUSTOMER_FORM.TERMINOS_PAGO',
          paymentTermDays: 'CONTACTS.CUSTOMER_FORM.DIAS_CREDITO',
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
        this.notificationService.showSuccess(this.isEditMode() ? 'CONTACTS.CUSTOMER_FORM.CLIENTE_ACTUALIZADO_EXITOSAMENTE' : 'CONTACTS.CUSTOMER_FORM.CLIENTE_CREADO_EXITOSAMENTE');
        this.router.navigate(['/contacts/customers']);
      },
      error: (err) => {
        // The server says exactly what it refused and says it in the reader's language; throwing
        // that away for "Could not create the customer" is what made the failure above impossible
        // to act on. The generic key stays as the fallback for a network error with no body.
        const serverMessage = typeof err?.error?.message === 'string' ? err.error.message : null;
        this.notificationService.showError(
          serverMessage ??
            (this.isEditMode()
              ? 'CONTACTS.CUSTOMER_FORM.ERROR_ACTUALIZAR_CLIENTE'
              : 'CONTACTS.CUSTOMER_FORM.ERROR_CREAR_CLIENTE'),
        );
        this.isLoading.set(false);
      },
    });
  }
}
