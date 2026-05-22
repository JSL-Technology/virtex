import { Component, ChangeDetectionStrategy, inject, OnInit, signal, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule, Save } from 'lucide-angular';
import { TaxesService, CreateTaxDto, UpdateTaxDto } from '../../../../core/api/taxes.service';
import { NotificationService } from '../../../../core/services/notification';
import { TaxType } from '../../../../core/models/tax.model';

@Component({
  selector: 'app-tax-form-page',
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule, LucideAngularModule],
  templateUrl: './tax-form.page.html',
  styleUrls: ['./tax-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaxFormPage implements OnInit {
  @Input() id?: string;

  private fb = inject(FormBuilder);
  private router = inject(Router);
  private taxesService = inject(TaxesService);
  private notificationService = inject(NotificationService);

  protected readonly SaveIcon = Save;
  taxForm!: FormGroup;
  isEditMode = signal(false);
  isLoading = signal(true);
  taxTypes = Object.values(TaxType);

  ngOnInit(): void {
    this.taxForm = this.fb.group({
      name: ['', Validators.required],
      rate: [0, [Validators.required, Validators.min(0)]],
      type: [TaxType.PERCENTAGE, Validators.required],
      countryCode: ['DO'],
    });

    if (this.id) {
      this.isEditMode.set(true);
      this.loadTaxData(this.id);
    } else {
      this.isLoading.set(false);
    }
  }

  loadTaxData(id: string): void {
    this.taxesService.getTaxById(id).subscribe({
      next: (tax) => {
        this.taxForm.patchValue(tax);
        this.isLoading.set(false);
      },
      error: () => {
        this.notificationService.showError('No se pudo cargar el impuesto.');
        this.router.navigate(['/masters/taxes']);
      },
    });
  }

  saveTax(): void {
    if (this.taxForm.invalid) {
      this.taxForm.markAllAsTouched();
      this.notificationService.showError('Por favor, complete los campos requeridos.');
      return;
    }

    this.isLoading.set(true);
    const formValue = this.taxForm.getRawValue();

    const operation = this.isEditMode()
      ? this.taxesService.updateTax(this.id!, formValue as UpdateTaxDto)
      : this.taxesService.createTax(formValue as CreateTaxDto);

    operation.subscribe({
      next: () => {
        this.notificationService.showSuccess(`Impuesto ${this.isEditMode() ? 'actualizado' : 'creado'} exitosamente.`);
        this.router.navigate(['/masters/taxes']);
      },
      error: () => {
        this.notificationService.showError(`Error al ${this.isEditMode() ? 'actualizar' : 'crear'} el impuesto.`);
        this.isLoading.set(false);
      },
    });
  }
}