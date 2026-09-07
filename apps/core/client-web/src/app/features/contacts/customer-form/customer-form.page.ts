import { Component, ChangeDetectionStrategy, inject, OnInit, signal, input, effect } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule, Save } from 'lucide-angular';
import { CustomersService, CreateCustomerDto, UpdateCustomerDto } from '../../../core/api/customers.service';
import { NotificationService } from '../../../core/services/notification';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-customer-form-page',
  imports: [RouterLink, ReactiveFormsModule, LucideAngularModule, TranslateModule],
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

  protected readonly SaveIcon = Save;

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

  saveCustomer(): void {
    if (this.customerForm.invalid) {
      this.customerForm.markAllAsTouched();
      this.notificationService.showError('CONTACTS.CUSTOMER_FORM.FAVOR_COMPLETA_CAMPOS_REQUERIDOS');
      return;
    }

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
