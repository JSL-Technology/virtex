import { Component, ChangeDetectionStrategy, inject, OnInit, signal, input, effect } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CustomersService, CreateCustomerDto, UpdateCustomerDto } from '../../../core/api/customers.service';
import { NotificationService } from '../../../core/services/notification';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';

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
        }),
      );
      return;
    }

    this.problems.set([]);

    this.isLoading.set(true);
    const formValue = this.customerForm.getRawValue();

    const customerId = this.id();
    const operation = customerId
      ? this.customersService.updateCustomer(customerId, formValue as UpdateCustomerDto)
      : this.customersService.createCustomer(formValue as CreateCustomerDto);

    operation.subscribe({
      next: () => {
        this.notificationService.showSuccess(this.isEditMode() ? 'CONTACTS.CUSTOMER_FORM.CLIENTE_ACTUALIZADO_EXITOSAMENTE' : 'CONTACTS.CUSTOMER_FORM.CLIENTE_CREADO_EXITOSAMENTE');
        this.router.navigate(['/contacts/customers']);
      },
      error: () => {
        this.notificationService.showError(this.isEditMode() ? 'CONTACTS.CUSTOMER_FORM.ERROR_ACTUALIZAR_CLIENTE' : 'CONTACTS.CUSTOMER_FORM.ERROR_CREAR_CLIENTE');
        this.isLoading.set(false);
      },
    });
  }
}
