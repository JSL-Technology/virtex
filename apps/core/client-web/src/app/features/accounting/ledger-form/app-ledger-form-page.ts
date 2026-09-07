// app/features/accounting/ledger-form/app-ledger-form-page.ts
import { Component, inject, OnInit, signal, Input } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
// FIX: Importar DTOs desde el servicio.
import { LedgersService, CreateLedgerDto, UpdateLedgerDto } from '../../../core/api/ledgers.service';
// FIX: Importar el tipo Ledger directamente desde su modelo, ya que el servicio no lo re-exporta.
import { Ledger } from '../../../core/models/ledger.model';
import { NotificationService } from '../../../core/services/notification';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';

@Component({
  selector: 'app-ledger-form-page',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, DraftShellComponent],
  templateUrl: './app-ledger-form-page.html',
  styleUrls: ['./app-ledger-form-page.scss']
})
export class LedgerFormPage implements OnInit {
  @Input() id?: string;

  private fb = inject(FormBuilder);
  private router = inject(Router);
  private ledgersService = inject(LedgersService);
  private notificationService = inject(NotificationService);

  readonly problems = signal<DraftProblem[]>([]);

  ledgerForm!: FormGroup;
  isEditMode = signal(false);
  isLoading = signal(false);

  ngOnInit(): void {
    this.ledgerForm = this.fb.group({
      name: ['', Validators.required],
      description: [''],
      isDefault: [false, Validators.required]
    });

    if (this.id) {
      this.isEditMode.set(true);
      this.loadLedgerData(this.id);
    }
  }

  private loadLedgerData(id: string): void {
    this.isLoading.set(true);
    // FIX: El backend espera un UUID (string), por lo tanto, no se debe usar parseInt.
    this.ledgersService.getLedger(id).subscribe({
      next: (data: Ledger) => {
        this.ledgerForm.patchValue(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.notificationService.showError('ACCOUNTING.LEDGER_FORM.PUDO_CARGAR_LIBRO_MAYOR');
        this.router.navigate(['/accounting']);
      }
    });
  }

  cancel(): void {
    void this.router.navigate(['/accounting/general-ledger']);
  }

  saveLedger(): void {
    if (this.ledgerForm.invalid) {
      this.ledgerForm.markAllAsTouched();
      this.problems.set(
        draftProblems(this.ledgerForm, {
          name: 'ACCOUNTING.LEDGER_FORM.NOMBRE_LIBRO',
          description: 'ACCOUNTING.LEDGER_FORM.DESCRIPCION',
          isDefault: 'ACCOUNTING.LEDGER_FORM.ESTABLECER_COMO_LIBRO_DEFECTO',
        }),
      );
      return;
    }

    this.problems.set([]);

    this.isLoading.set(true);
    const formValue = this.ledgerForm.getRawValue();

    // FIX: El ID es un string (UUID), no es necesario ni correcto convertirlo a número.
    const operation = this.isEditMode()
      ? this.ledgersService.updateLedger(this.id!, formValue as UpdateLedgerDto)
      : this.ledgersService.createLedger(formValue as CreateLedgerDto);

    operation.subscribe({
      next: () => {
        this.notificationService.showSuccess(this.isEditMode() ? 'ACCOUNTING.LEDGER_FORM.LIBRO_MAYOR_ACTUALIZADO_EXITOSAMENTE' : 'ACCOUNTING.LEDGER_FORM.LIBRO_MAYOR_CREADO_EXITOSAMENTE');
        this.router.navigate(['/accounting/general-ledger']);
      },
      error: (err) => {
        this.notificationService.showError(this.isEditMode() ? 'ACCOUNTING.LEDGER_FORM.ERROR_ACTUALIZAR_LIBRO_MAYOR' : 'ACCOUNTING.LEDGER_FORM.ERROR_CREAR_LIBRO_MAYOR');
        this.isLoading.set(false);
      }
    });
  }
}