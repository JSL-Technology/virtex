import { Component, ChangeDetectionStrategy, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule, ChevronLeft } from 'lucide-angular';
import { AccountsPayableService, CreateVendorBillDto, UpdateVendorBillDto } from '../../../core/services/accounts-payable';
import { NotificationService } from '../../../core/services/notification';
import { of } from 'rxjs';
import { switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-vendor-bill-form-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, LucideAngularModule],
  templateUrl: './form.page.html',
  styleUrls: ['./form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorBillFormPage implements OnInit {
  protected readonly BackIcon = ChevronLeft;

  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private accountsPayableService = inject(AccountsPayableService);
  private notificationService = inject(NotificationService);

  form!: FormGroup;
  isEditMode = signal(false);
  billId = signal<string | null>(null);
  isLoading = signal(false);

  ngOnInit(): void {
    this.initForm();
    this.checkMode();
  }

  initForm(): void {
    this.form = this.fb.group({
      supplierId: ['', [Validators.required]],
      billNumber: ['', [Validators.required]],
      issueDate: ['', [Validators.required]],
      dueDate: ['', [Validators.required]],
      notes: [''],
      lineItems: this.fb.array([this.createLineItem()]),
    });
  }

  createLineItem(): FormGroup {
    return this.fb.group({
      description: ['', [Validators.required]],
      quantity: [1, [Validators.required, Validators.min(1)]],
      price: [0, [Validators.required, Validators.min(0)]],
      expenseAccountId: ['', [Validators.required]],
    });
  }

  get lineItems(): FormArray {
    return this.form.get('lineItems') as FormArray;
  }

  addLineItem(): void {
    this.lineItems.push(this.createLineItem());
  }

  removeLineItem(index: number): void {
    this.lineItems.removeAt(index);
  }

  checkMode(): void {
    this.route.paramMap.pipe(
      switchMap(params => {
        const id = params.get('id');
        if (id) {
          this.isEditMode.set(true);
          this.billId.set(id);
          this.isLoading.set(true);
          return this.accountsPayableService.getVendorBillById(id);
        }
        return of(null);
      })
    ).subscribe(bill => {
      if (bill) {
        // Note: The DTO and the form structure must align perfectly.
        // This is a simplified patch; a real implementation might need more complex mapping.
        this.form.patchValue(bill);
        this.isLoading.set(false);
      }
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.notificationService.showError('Por favor, completa todos los campos requeridos.');
      return;
    }

    this.isLoading.set(true);
    const formValue = this.form.value;

    const operation = this.isEditMode()
      ? this.accountsPayableService.updateVendorBill(this.billId()!, formValue as UpdateVendorBillDto)
      : this.accountsPayableService.createVendorBill(formValue as CreateVendorBillDto);

    operation.subscribe({
      next: () => {
        this.notificationService.showSuccess(`Factura ${this.isEditMode() ? 'actualizada' : 'creada'} con éxito.`);
        this.router.navigate(['/accounts-payable']);
      },
      error: (err) => {
        this.notificationService.showError('Error al guardar la factura.');
        this.isLoading.set(false);
      },
      complete: () => {
        this.isLoading.set(false);
      }
    });
  }
}
