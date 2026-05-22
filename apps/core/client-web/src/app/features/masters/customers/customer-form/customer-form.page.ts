import { Component, ChangeDetectionStrategy, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule, Save } from 'lucide-angular';
import { CustomersService, CreateCustomerDto, UpdateCustomerDto } from '../../../../core/api/customers.service';
import { NotificationService } from '../../../../core/services/notification';

@Component({
  selector: 'app-customer-form-page',
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule, LucideAngularModule],
  templateUrl: './customer-form.page.html',
  styleUrls: ['./customer-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerFormPage implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private customersService = inject(CustomersService);
  private notificationService = inject(NotificationService);

  protected readonly SaveIcon = Save;

  customerForm!: FormGroup;
  isEditMode = signal(false);
  isLoading = signal(true);
  private customerId: string | null = null;

  ngOnInit(): void {
    this.customerForm = this.fb.group({
      companyName: ['', Validators.required],
      taxId: [''],
      contactPerson: [''],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', Validators.required],
      address: [''],
      city: [''],
      stateOrProvince: [''],
      postalCode: [''],
      country: ['DO', Validators.required],
    });

    this.customerId = this.route.snapshot.paramMap.get('id');
    if (this.customerId) {
      this.isEditMode.set(true);
      this.loadCustomerData(this.customerId);
      return;
    }

    this.isLoading.set(false);
  }

  loadCustomerData(id: string): void {
    this.customersService.getCustomerById(id).subscribe({
      next: (customer) => {
        this.customerForm.patchValue(customer);
        this.isLoading.set(false);
      },
      error: () => {
        this.notificationService.showError('No se pudo cargar el cliente.');
        this.router.navigate(['/masters/customers']);
      }
    });
  }

  saveCustomer(): void {
    if (this.customerForm.invalid) {
      this.customerForm.markAllAsTouched();
      this.notificationService.showError('Por favor, completa los campos requeridos.');
      return;
    }

    this.isLoading.set(true);
    const formValue = this.customerForm.getRawValue();

    const operation = this.isEditMode()
      ? this.customersService.updateCustomer(this.customerId!, formValue as UpdateCustomerDto)
      : this.customersService.createCustomer(formValue as CreateCustomerDto);

    operation.subscribe({
      next: () => {
        this.notificationService.showSuccess(`Cliente ${this.isEditMode() ? 'actualizado' : 'creado'} exitosamente.`);
        this.router.navigate(['/masters/customers']);
      },
      error: () => {
        this.notificationService.showError(`Error al ${this.isEditMode() ? 'actualizar' : 'crear'} el cliente.`);
        this.isLoading.set(false);
      }
    });
  }
}
