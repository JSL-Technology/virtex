import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormArray } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ChartOfAccountsApiService, AccountSegmentDefinition } from '../../../../core/api/chart-of-accounts.service';
import { LucideAngularModule, Save, Plus, Trash2, ArrowLeft, RotateCcw } from 'lucide-angular';
import { NotificationService } from '../../../../core/services/notification';
import { take } from 'rxjs/operators';

@Component({
  selector: 'app-segment-configuration',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, LucideAngularModule],
  templateUrl: './segment-configuration.page.html',
  styleUrls: ['./segment-configuration.page.scss'],
})
export class SegmentConfigurationPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly apiService = inject(ChartOfAccountsApiService);
  private readonly notificationService = inject(NotificationService);

  public configForm!: FormGroup;
  public isLoading = signal(true);
  public isSaving = signal(false);

  // Icons
  public readonly SaveIcon = Save;
  public readonly PlusIcon = Plus;
  public readonly TrashIcon = Trash2;
  public readonly BackIcon = ArrowLeft;
  public readonly ResetIcon = RotateCcw;

  ngOnInit(): void {
    this.initializeForm();
    this.loadDefinitions();
  }

  private initializeForm(): void {
    this.configForm = this.fb.group({
      segments: this.fb.array([])
    });
  }

  get segments(): FormArray {
    return this.configForm.get('segments') as FormArray;
  }

  private loadDefinitions(): void {
    this.isLoading.set(true);
    this.apiService.getSegmentDefinitions().pipe(take(1)).subscribe({
      next: (defs) => {
        this.segments.clear();
        if (defs.length > 0) {
          defs.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).forEach(def => {
            this.addSegmentToForm(def);
          });
        }
        this.isLoading.set(false);
      },
      error: () => {
        this.notificationService.showError('Error al cargar la configuración de segmentos.');
        this.isLoading.set(false);
      }
    });
  }

  private addSegmentToForm(def?: AccountSegmentDefinition): void {
    const segmentGroup = this.fb.group({
      name: [def?.name ?? '', [Validators.required, Validators.maxLength(50)]],
      length: [def?.length ?? 1, [Validators.required, Validators.min(1), Validators.max(10)]],
      isRequired: [def?.isRequired ?? true]
    });
    this.segments.push(segmentGroup);
  }

  public addSegment(): void {
    this.addSegmentToForm();
  }

  public removeSegment(index: number): void {
    this.segments.removeAt(index);
  }

  public onSave(): void {
    if (this.configForm.invalid) {
      this.configForm.markAllAsTouched();
      this.notificationService.showError('Por favor, corrija los errores en el formulario.');
      return;
    }

    if (this.segments.length === 0) {
      this.notificationService.showError('Debe definir al menos un segmento.');
      return;
    }

    this.isSaving.set(true);
    const dto = {
      segments: this.configForm.value.segments
    };

    this.apiService.configureSegmentDefinitions(dto).pipe(take(1)).subscribe({
      next: () => {
        this.notificationService.showSuccess('Estructura de segmentos guardada correctamente.');
        this.isSaving.set(false);
        this.router.navigate(['/accounting/chart-of-accounts']);
      },
      error: (err) => {
        const message = err?.error?.message || 'Error al guardar la configuración.';
        this.notificationService.showError(message);
        this.isSaving.set(false);
      }
    });
  }

  public onInitializeDefaults(): void {
    if (confirm('¿Está seguro de que desea inicializar la estructura por defecto? Esto reemplazará cualquier configuración actual que no haya sido guardada.')) {
        this.isSaving.set(true);
        this.apiService.initializeDefaultSegments().pipe(take(1)).subscribe({
            next: (defs) => {
                this.segments.clear();
                defs.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).forEach(def => {
                    this.addSegmentToForm(def);
                });
                this.notificationService.showSuccess('Estructura por defecto inicializada.');
                this.isSaving.set(false);
            },
            error: (err) => {
                const message = err?.error?.message || 'Error al inicializar valores por defecto.';
                this.notificationService.showError(message);
                this.isSaving.set(false);
            }
        });
    }
  }

  public onCancel(): void {
    this.router.navigate(['/accounting/chart-of-accounts']);
  }
}
