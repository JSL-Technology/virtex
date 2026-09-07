import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { DialogService } from '../../../../core/services/dialog.service';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormArray } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ChartOfAccountsApiService, AccountSegmentDefinition } from '../../../../core/api/chart-of-accounts.service';
import { LucideAngularModule, Save, Plus, Trash2, ArrowLeft, RotateCcw } from 'lucide-angular';
import { NotificationService } from '../../../../core/services/notification';
import { take } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../../shared/components/gestures';

@Component({
  selector: 'app-segment-configuration',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LucideAngularModule, TranslateModule, DraftShellComponent],
  templateUrl: './segment-configuration.page.html',
  styleUrls: ['./segment-configuration.page.scss'],
})
export class SegmentConfigurationPage implements OnInit {
  private readonly translate = inject(TranslateService);
  private readonly dialog = inject(DialogService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly apiService = inject(ChartOfAccountsApiService);
  private readonly notificationService = inject(NotificationService);

  public configForm!: FormGroup;
  public isLoading = signal(true);
  public isSaving = signal(false);

  // Icons
  public readonly PlusIcon = Plus;
  public readonly TrashIcon = Trash2;
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
        this.notificationService.showError('ACCOUNTING.SEGMENT_CONFIGURATION.ERROR_CARGAR_CONFIGURACION_SEGMENTOS');
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

  /** Qué falta antes de guardar. Entra en los niveles y nombra el que falla. */
  public readonly problems = signal<DraftProblem[]>([]);

  public onSave(): void {
    if (this.configForm.invalid) {
      this.configForm.markAllAsTouched();
      this.problems.set(draftProblems(this.configForm));
      return;
    }

    if (this.segments.length === 0) {
      //  Una estructura sin ningún nivel no es un campo mal escrito: es que no hay estructura.
      this.problems.set([{ message: 'ACCOUNTING.SEGMENT_CONFIGURATION.DEBE_DEFINIR_MENOS_SEGMENTO' }]);
      return;
    }

    this.problems.set([]);

    this.isSaving.set(true);
    const dto = {
      segments: this.configForm.value.segments
    };

    this.apiService.configureSegmentDefinitions(dto).pipe(take(1)).subscribe({
      next: () => {
        this.notificationService.showSuccess('ACCOUNTING.SEGMENT_CONFIGURATION.ESTRUCTURA_SEGMENTOS_GUARDADA_CORRECTAMENTE');
        this.isSaving.set(false);
        this.router.navigate(['/accounting/chart-of-accounts']);
      },
      error: (err) => {
        const message = err?.error?.message || this.translate.instant('ERRORS.SAVE_CONFIGURATION');
        this.notificationService.showError(message);
        this.isSaving.set(false);
      }
    });
  }

  public async onInitializeDefaults(): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'DIALOG.RESET_SEGMENTS.TITLE',
      message: 'DIALOG.RESET_SEGMENTS.MESSAGE',
      variant: 'warning',
    });
    if (confirmed) {
        this.isSaving.set(true);
        this.apiService.initializeDefaultSegments().pipe(take(1)).subscribe({
            next: (defs) => {
                this.segments.clear();
                defs.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).forEach(def => {
                    this.addSegmentToForm(def);
                });
                this.notificationService.showSuccess('ACCOUNTING.SEGMENT_CONFIGURATION.ESTRUCTURA_DEFECTO_INICIALIZADA');
                this.isSaving.set(false);
            },
            error: (err) => {
                const message = err?.error?.message || this.translate.instant('ERRORS.INITIALIZE_DEFAULTS');
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
