import { Component, ChangeDetectionStrategy, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { SuppliersService, CreateSupplierDto, UpdateSupplierDto } from '../../../../core/api/suppliers.service';
import { NotificationService } from '../../../../core/services/notification';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../../shared/components/gestures';

@Component({
  selector: 'app-supplier-form-page',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, DraftShellComponent],
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


  /** Qué falta antes de guardar. Se llena al pulsar, no mientras se teclea el primer campo. */
  readonly problems = signal<DraftProblem[]>([]);

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

  cancel(): void {
    void this.router.navigate(['/masters/suppliers']);
  }

  saveSupplier(): void {
    if (this.supplierForm.invalid) {
      this.supplierForm.markAllAsTouched();
      //  «Completa los campos requeridos» no dice cuáles. El resumen los nombra y cada línea
      //  lleva al campo, que es lo que separa un formulario que no guarda de uno que explica.
      this.problems.set(
        draftProblems(this.supplierForm, {
          name: 'MASTERS.SUPPLIER_FORM.NOMBRE_PROVEEDOR',
          contactPerson: 'MASTERS.SUPPLIER_FORM.PERSONA_CONTACTO',
          taxId: 'MASTERS.SUPPLIER_FORM.ID_FISCAL_RNC_ETC',
          address: 'MASTERS.SUPPLIER_FORM.DIRECCION',
          email: 'MASTERS.SUPPLIER_FORM.CORREO_ELECTRONICO',
          phone: 'MASTERS.SUPPLIER_FORM.TELEFONO',
        }),
      );
      return;
    }

    this.problems.set([]);

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
