import { Component, ChangeDetectionStrategy, inject, OnInit, signal, computed, Input } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { LucideAngularModule, Save, Plus, Trash2 } from 'lucide-angular';
import { LanguageService } from '../../../core/services/language';
import { JournalEntries } from '../../../core/services/journal-entries';
import { NotificationService } from '../../../core/services/notification';
import { AccountingService } from '../../../core/api/accounting.service';
import { Account } from '../../../core/models/account.model';
import { LedgersService } from '../../../core/api/ledgers.service';
import { JournalsService } from '../../../core/api/journals.service';
import { Ledger } from '../../../core/models/ledger.model';
import { Journal } from '../../../core/models/journal.model';

// Validador personalizado para el asiento contable
export const journalEntryValidator = (control: AbstractControl): ValidationErrors | null => {
  const lines = control.get('lines') as FormArray;
  if (!lines || lines.length === 0) {
    return null; // No hay líneas para validar
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of lines.controls) {
    totalDebit += Number(line.get('debit')?.value) || 0;
    totalCredit += Number(line.get('credit')?.value) || 0;
  }

  // Redondear para evitar problemas de precisión con decimales
  totalDebit = Math.round(totalDebit * 100) / 100;
  totalCredit = Math.round(totalCredit * 100) / 100;

  if (totalDebit === 0 && totalCredit === 0) {
    // Solo marcamos como error si el formulario ha sido tocado por el usuario
    if (control.touched) {
       return { zeroAmount: true };
    }
  }

  if (totalDebit !== totalCredit) {
    return { unbalanced: true };
  }

  return null;
};


const translations = {
  en: {
    title: 'New Journal Entry',
    editTitle: 'Edit Journal Entry',
    dateLabel: 'Date',
    ledgerLabel: 'Ledger',
    journalLabel: 'Journal',
    descriptionLabel: 'Description',
    descriptionPlaceholder: 'Enter a description for the entry',
    accountColumn: 'Account',
    descriptionColumn: 'Description',
    debitColumn: 'Debit',
    creditColumn: 'Credit',
    accountPlaceholder: 'Select an account',
    ledgerPlaceholder: 'Select a ledger',
    journalPlaceholder: 'Select a journal',
    addLine: 'Add Line',
    cancel: 'Cancel',
    save: 'Save Entry',
    saving: 'Saving...',
    totals: 'Totals',
    unbalancedError: 'Debits and credits must be balanced.',
    zeroAmountError: 'The total amount cannot be zero.',
    requiredFieldsError: 'Please fill in all required fields.'
  },
  es: {
    title: 'Nuevo Asiento Contable',
    editTitle: 'Editar Asiento Contable',
    dateLabel: 'Fecha',
    ledgerLabel: 'Libro Mayor',
    journalLabel: 'Diario',
    descriptionLabel: 'Descripción',
    descriptionPlaceholder: 'Introduce una descripción para el asiento',
    accountColumn: 'Cuenta',
    descriptionColumn: 'Descripción',
    debitColumn: 'Débito',
    creditColumn: 'Crédito',
    accountPlaceholder: 'Selecciona una cuenta',
    ledgerPlaceholder: 'Selecciona un libro mayor',
    journalPlaceholder: 'Selecciona un diario',
    addLine: 'Añadir Línea',
    cancel: 'Cancelar',
    save: 'Guardar Asiento',
    saving: 'Guardando...',
    totals: 'Totales',
    unbalancedError: 'Los débitos y créditos deben estar balanceados.',
    zeroAmountError: 'El monto total no puede ser cero.',
    requiredFieldsError: 'Por favor, completa todos los campos requeridos.'
  }
};


@Component({
  selector: 'app-journal-entry-form-page',
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule, LucideAngularModule, DecimalPipe],
  templateUrl: './journal-entry-form.page.html',
  styleUrls: ['./journal-entry-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JournalEntryFormPage implements OnInit {
  @Input() id?: string;

  private fb = inject(FormBuilder);
  private router = inject(Router);
  private languageService = inject(LanguageService);
  private journalEntriesService = inject(JournalEntries);
  private notificationService = inject(NotificationService);
  private accountingService = inject(AccountingService);
  private ledgersService = inject(LedgersService);
  private journalsService = inject(JournalsService);

  language = this.languageService.currentLang;
  t = computed(() => translations[this.language() as keyof typeof translations]);

  protected readonly SaveIcon = Save;
  protected readonly PlusIcon = Plus;
  protected readonly TrashIcon = Trash2;

  entryForm!: FormGroup;
  isEditMode = signal(false);
  isSaving = signal(false);
  accounts = signal<Account[]>([]);
  ledgers = signal<Ledger[]>([]);
  journals = signal<Journal[]>([]);
  totalDebit = signal(0);
  totalCredit = signal(0);

  ngOnInit(): void {
    const today = new Date().toISOString().split('T')[0];

    this.entryForm = this.fb.group({
      date: [today, Validators.required],
      ledgerId: ['', Validators.required],
      journalId: ['', Validators.required],
      description: ['', Validators.required],
      lines: this.fb.array([], [Validators.required, Validators.minLength(2)])
    }, { validators: journalEntryValidator });

    this.lines.valueChanges.subscribe((linesValue) => {
      this.calculateTotals(linesValue);
    });

    this.loadInitialData();

    if (this.id) {
      this.isEditMode.set(true);
      // Lógica para cargar un asiento existente
    } else {
      this.addLine();
      this.addLine();
    }
  }

  loadInitialData(): void {
    this.accountingService.getAccounts().subscribe({
        next: data => this.accounts.set(data),
        error: () => this.notificationService.showError('Error al cargar las cuentas contables.')
    });
    this.ledgersService.getLedgers().subscribe({
      next: data => this.ledgers.set(data),
      error: () => this.notificationService.showError('Error al cargar los libros mayores.')
    });
    this.journalsService.getJournals().subscribe({
      next: data => this.journals.set(data),
      error: () => this.notificationService.showError('Error al cargar los diarios.')
    });
  }

  get lines(): FormArray {
    return this.entryForm.get('lines') as FormArray;
  }

  createLine(): FormGroup {
    return this.fb.group({
      accountId: ['', Validators.required],
      description: [''],
      debit: [0, [Validators.required, Validators.min(0)]],
      credit: [0, [Validators.required, Validators.min(0)]],
    });
  }

  addLine(): void {
    this.lines.push(this.createLine());
  }

  removeLine(index: number): void {
    if (this.lines.length > 2) {
      this.lines.removeAt(index);
    }
  }

  calculateTotals(linesValue: any[]): void {
    const debits = linesValue.reduce((acc, line) => acc + (Number(line.debit) || 0), 0);
    const credits = linesValue.reduce((acc, line) => acc + (Number(line.credit) || 0), 0);
    this.totalDebit.set(debits);
    this.totalCredit.set(credits);
  }

  saveEntry(): void {
    this.entryForm.markAllAsTouched();
    
    if (this.entryForm.invalid) {
      this.notificationService.showError(this.t().requiredFieldsError);
      return;
    }

    if (this.isSaving()) return;
    this.isSaving.set(true);

    const formData = this.entryForm.getRawValue();

    this.journalEntriesService.create(formData).subscribe({
      next: () => {
        this.notificationService.showSuccess('Asiento contable creado con éxito!');
        this.router.navigate(['/accounting/journal-entries']);
      },
      error: (err) => {
        this.notificationService.showError(err.error?.message || 'Error al crear el asiento contable.');
        this.isSaving.set(false);
      },
      complete: () => {
        this.isSaving.set(false);
      }
    });
  }
}