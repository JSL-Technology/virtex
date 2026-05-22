// app/features/accounting/ledger-form/app-ledger-form-page.ts
import { Component, inject, OnInit, signal, Input } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, Save } from 'lucide-angular';
// FIX: Importar DTOs desde el servicio.
import { LedgersService, CreateLedgerDto, UpdateLedgerDto } from '../../../core/api/ledgers.service';
// FIX: Importar el tipo Ledger directamente desde su modelo, ya que el servicio no lo re-exporta.
import { Ledger } from '../../../core/models/ledger.model';
import { NotificationService } from '../../../core/services/notification';

@Component({
  selector: 'app-ledger-form-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, LucideAngularModule],
  templateUrl: './app-ledger-form-page.html',
  styleUrls: ['./app-ledger-form-page.scss']
})
export class LedgerFormPage implements OnInit {
  @Input() id?: string;

  private fb = inject(FormBuilder);
  private router = inject(Router);
  private ledgersService = inject(LedgersService);
  private notificationService = inject(NotificationService);

  protected readonly SaveIcon = Save;
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
        this.notificationService.showError('No se pudo cargar el libro mayor.');
        this.router.navigate(['/accounting']);
      }
    });
  }

  saveLedger(): void {
    if (this.ledgerForm.invalid) {
      this.notificationService.showError('Por favor, completa los campos requeridos.');
      this.ledgerForm.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);
    const formValue = this.ledgerForm.getRawValue();

    // FIX: El ID es un string (UUID), no es necesario ni correcto convertirlo a número.
    const operation = this.isEditMode()
      ? this.ledgersService.updateLedger(this.id!, formValue as UpdateLedgerDto)
      : this.ledgersService.createLedger(formValue as CreateLedgerDto);

    operation.subscribe({
      next: () => {
        this.notificationService.showSuccess(`Libro Mayor ${this.isEditMode() ? 'actualizado' : 'creado'} exitosamente.`);
        this.router.navigate(['/accounting/general-ledger']);
      },
      error: (err) => {
        this.notificationService.showError(`Error al ${this.isEditMode() ? 'actualizar' : 'crear'} el Libro Mayor.`);
        this.isLoading.set(false);
      }
    });
  }
}