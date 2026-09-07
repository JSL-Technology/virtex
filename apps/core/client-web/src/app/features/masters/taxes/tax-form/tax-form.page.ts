import { Component, ChangeDetectionStrategy, inject, OnInit, signal, Input } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TaxesService, CreateTaxDto, UpdateTaxDto } from '../../../../core/api/taxes.service';
import { NotificationService } from '../../../../core/services/notification';
import { TaxType } from '../../../../core/models/tax.model';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../../shared/components/gestures';
@Component({
  selector: 'app-tax-form-page',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, DraftShellComponent],
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
  taxForm!: FormGroup;
  isEditMode = signal(false);
  isLoading = signal(true);
  taxTypes = Object.values(TaxType);
  /**
   * Qué falta antes de guardar, leído del propio formulario.
   *
   * `signal` puesta al intentar guardar y no un `computed` sobre el formulario: el resumen debe
   * aparecer cuando el usuario pulsa, no mientras teclea el primer campo — un formulario recién
   * abierto es inválido por definición y regañar por ello enseña a no leer los avisos.
   */
  readonly problems = signal<DraftProblem[]>([]);
  cancel(): void {
    void this.router.navigate(['/masters/taxes']);
  }
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
        this.notificationService.showError('MASTERS.TAX_FORM.PUDO_CARGAR_IMPUESTO');
        this.router.navigate(['/masters/taxes']);
      },
    });
  }
  saveTax(): void {
    if (this.taxForm.invalid) {
      this.taxForm.markAllAsTouched();
      //  El aviso decía «completa los campos requeridos» sin decir cuáles. El resumen los nombra,
      //  y cada línea lleva al campo — que es lo que convierte un formulario que no guarda en un
      //  formulario que dice qué le falta.
      this.problems.set(
        draftProblems(this.taxForm, {
          name: 'MASTERS.TAX_FORM.NOMBRE_IMPUESTO',
          rate: 'MASTERS.TAX_FORM.TASA',
          type: 'MASTERS.TAX_FORM.TIPO',
          countryCode: 'MASTERS.TAX_FORM.CODIGO_PAIS_OPCIONAL',
        }),
      );
      return;
    }
    this.problems.set([]);
    this.isLoading.set(true);
    const formValue = this.taxForm.getRawValue();
    const operation = this.isEditMode()
      ? this.taxesService.updateTax(this.id!, formValue as UpdateTaxDto)
      : this.taxesService.createTax(formValue as CreateTaxDto);
    operation.subscribe({
      next: () => {
        this.notificationService.showSuccess(this.isEditMode() ? 'MASTERS.TAX_FORM.IMPUESTO_ACTUALIZADO_EXITOSAMENTE' : 'MASTERS.TAX_FORM.IMPUESTO_CREADO_EXITOSAMENTE');
        this.router.navigate(['/masters/taxes']);
      },
      error: () => {
        this.notificationService.showError(this.isEditMode() ? 'MASTERS.TAX_FORM.ERROR_ACTUALIZAR_IMPUESTO' : 'MASTERS.TAX_FORM.ERROR_CREAR_IMPUESTO');
        this.isLoading.set(false);
      },
    });
  }
}