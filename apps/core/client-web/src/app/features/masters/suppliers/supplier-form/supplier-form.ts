import { Component, ChangeDetectionStrategy, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule, Save } from 'lucide-angular';
import { SuppliersService, CreateSupplierDto, UpdateSupplierDto } from '../../../../core/api/suppliers.service';
import { NotificationService } from '../../../../core/services/notification';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-supplier-form-page',
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule, LucideAngularModule, TranslateModule],
  templateUrl: './supplier-form.html',
  styleUrls: ['./supplier-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupplierForm implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private suppliersService = inject(SuppliersService);
  private notificationService = inject(NotificationService);

  protected readonly SaveIcon = Save;

  supplierForm!: FormGroup;
  isEditMode = signal(false);
  isLoading = signal(true);
  private supplierId: string | null = null;

  ngOnInit(): void {
    this.supplierForm = this.fb.group({
      name: ['', Validators.required],
      contactPerson: [''],
      email: ['', [Validators.email]],
      phone: [''],
      taxId: [''],
      address: [''],
    });

    this.supplierId = this.route.snapshot.paramMap.get('id');
    if (this.supplierId) {
      this.isEditMode.set(true);
      this.loadSupplierData(this.supplierId);
    } else {
      this.isLoading.set(false);
    }
  }

  loadSupplierData(id: string): void {
    this.suppliersService.getSupplierById(id).subscribe({
      next: (supplier) => {
        this.supplierForm.patchValue(supplier);
        this.isLoading.set(false);
      },
      error: () => {
        this.notificationService.showError('MASTERS.SUPPLIER_FORM.PUDO_CARGAR_PROVEEDOR');
        this.router.navigate(['/masters/suppliers']);
      },
    });
  }

  saveSupplier(): void {
    if (this.supplierForm.invalid) {
      this.supplierForm.markAllAsTouched();
      this.notificationService.showError('MASTERS.SUPPLIER_FORM.FAVOR_COMPLETA_CAMPOS_REQUERIDOS');
      return;
    }

    this.isLoading.set(true);
    const formValue = this.supplierForm.getRawValue();

    const operation = this.isEditMode()
      ? this.suppliersService.updateSupplier(this.supplierId!, formValue as UpdateSupplierDto)
      : this.suppliersService.createSupplier(formValue as CreateSupplierDto);

    operation.subscribe({
      next: () => {
        this.notificationService.showSuccess(this.isEditMode() ? 'MASTERS.SUPPLIER_FORM.PROVEEDOR_ACTUALIZADO_EXITOSAMENTE' : 'MASTERS.SUPPLIER_FORM.PROVEEDOR_CREADO_EXITOSAMENTE');
        this.router.navigate(['/masters/suppliers']);
      },
      error: () => {
        this.notificationService.showError(this.isEditMode() ? 'MASTERS.SUPPLIER_FORM.ERROR_ACTUALIZAR_PROVEEDOR' : 'MASTERS.SUPPLIER_FORM.ERROR_CREAR_PROVEEDOR');
        this.isLoading.set(false);
      },
    });
  }
}
