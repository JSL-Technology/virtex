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
