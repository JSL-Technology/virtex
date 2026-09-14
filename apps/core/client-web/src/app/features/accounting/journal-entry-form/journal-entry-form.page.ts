import { Component, ChangeDetectionStrategy, inject, OnInit, signal, Input } from '@angular/core';
import { Router } from '@angular/router';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { LucideAngularModule, Save, Plus, Trash2 } from 'lucide-angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { JournalEntries } from '../../../core/services/journal-entries';
import { JournalEntry as ApiJournalEntry } from '../../../core/api/journal-entries.service';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { NotificationService } from '../../../core/services/notification';
import { AccountingService } from '../../../core/api/accounting.service';
import { Account } from '../../../core/models/account.model';
import { LedgersService } from '../../../core/api/ledgers.service';
import { JournalsService } from '../../../core/api/journals.service';
import { Ledger } from '../../../core/models/ledger.model';
import { Journal } from '../../../core/models/journal.model';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

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


@Component({
  selector: 'app-journal-entry-form-page',
  standalone: true,
  imports: [ReactiveFormsModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, DraftShellComponent, ...VX_FORM_A11Y],
  templateUrl: './journal-entry-form.page.html',
  styleUrls: ['./journal-entry-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JournalEntryFormPage implements OnInit {
  @Input() id?: string;

  private fb = inject(FormBuilder);
  private router = inject(Router);
  private journalEntriesService = inject(JournalEntries);
  private notificationService = inject(NotificationService);
  // A toast is raised from an event handler, where a pipe cannot run, so this one message is
  // resolved imperatively. Everything the reader sees in the template goes through the pipe.
  private translate = inject(TranslateService);
  private accountingService = inject(AccountingService);
  private ledgersService = inject(LedgersService);
  private journalsService = inject(JournalsService);
  /** Optional: the page is also reachable through the router outlet, where there is no tab. */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });


  protected readonly PlusIcon = Plus;
  protected readonly TrashIcon = Trash2;

  /** Qué falta antes de guardar. Entra en las líneas y nombra la que falla. */
  readonly problems = signal<DraftProblem[]>([]);

  entryForm!: FormGroup;
  isEditMode = signal(false);
  isSaving = signal(false);
  /** True while the entry being edited is being fetched. */
  isLoading = signal(false);
  /**
   * Why this entry cannot be modified, or null.
   *
   * The ledger's rule, mirrored: only a POSTED entry may be modified, and only if none of its
   * lines has been reconciled. Saying so on arrival is the difference between a screen that
   * explains itself and one that answers 400 after the work is done.
   */
  readonly editBlockedKey = signal<string | null>(null);
  /** The entry being modified, once loaded. */
  readonly original = signal<ApiJournalEntry | null>(null);
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
      //  Modificar un asiento es reversarlo y reponerlo, nunca reescribirlo — es la regla que el
      //  disparador `virtex_guard_posted_entry_update` impone en la base de datos —, y el servidor
      //  exige por eso una razón. El formulario la pide solo al editar.
      this.entryForm.addControl(
        'modificationReason',
        this.fb.control('', [Validators.required, Validators.minLength(5)]),
      );
      this.loadEntry(this.id);
    } else {
      this.addLine();
      this.addLine();
    }
  }

  /**
   * Traer el asiento que se va a modificar.
   *
   * Esto no existía: la ruta `journal-entries/:id/edit` está enlazada desde cada fila del registro
   * y montaba un formulario EN BLANCO con dos líneas vacías. Guardar no modificaba nada — llamaba
   * a `create` — así que el gesto «editar este asiento» creaba un segundo asiento y dejaba el
   * original intacto. Ninguna pantalla del producto permitía corregir un asiento.
   */
  private loadEntry(id: string): void {
    this.isLoading.set(true);
    this.journalEntriesService.getById(id).subscribe({
      next: (entry) => {
        const loaded = entry as unknown as ApiJournalEntry;
        this.original.set(loaded);
        this.isLoading.set(false);
        this.tab?.setTitle(
          loaded.entryNumber ??
            this.translate.instant('accounting.journal_entry_form.edit_title'),
        );

        if (loaded.status !== 'Posted') {
          this.editBlockedKey.set('accounting.journal_entry_form.only_posted_can_be_modified');
        }

        this.entryForm.patchValue({
          date: loaded.date,
          ledgerId: (entry as unknown as { ledgerId?: string }).ledgerId ?? '',
          journalId: (entry as unknown as { journalId?: string }).journalId ?? '',
          description: loaded.description,
        });

        this.lines.clear();
        for (const line of loaded.lines ?? []) {
          const group = this.createLine();
          group.patchValue({
            accountId: line.accountId,
            description: line.description ?? '',
            debit: Number(line.debit) || 0,
            credit: Number(line.credit) || 0,
          });
          this.lines.push(group);
        }
        //  Un asiento siempre tiene al menos dos líneas, pero un asiento roto no puede dejar el
        //  formulario sin ninguna: sin filas no hay dónde escribir la corrección.
        while (this.lines.length < 2) this.addLine();

        this.entryForm.markAsPristine();
      },
      error: () => {
        this.isLoading.set(false);
        this.editBlockedKey.set('accounting.journal_entry_form.entry_not_found');
      },
    });
  }

  loadInitialData(): void {
    this.accountingService.getAccounts().subscribe({
        next: data => this.accounts.set(data),
        error: () => this.notificationService.showError('accounting.journal_entry_form.accounts_load_failed')
    });
    this.ledgersService.getLedgers().subscribe({
      next: data => this.ledgers.set(data),
      error: () => this.notificationService.showError('accounting.journal_entry_form.ledgers_load_failed')
    });
    this.journalsService.getJournals().subscribe({
      next: data => this.journals.set(data),
      error: () => this.notificationService.showError('accounting.journal_entry_form.journals_load_failed')
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

  cancel(): void {
    void this.router.navigate(['/accounting/journal-entries']);
  }

  saveEntry(): void {
    this.entryForm.markAllAsTouched();
    
    if (this.entryForm.invalid) {
      //  El descuadre y el importe cero se dicen junto a los totales, donde está el número que hay
      //  que corregir; aquí quedan los campos, incluidos los de cada línea.
      this.problems.set(
        draftProblems(this.entryForm, {
          date: 'accounting.journal_entry_form.date_label',
          ledgerId: 'accounting.journal_entry_form.ledger_label',
          journalId: 'accounting.journal_entry_form.journal_label',
          description: 'accounting.journal_entry_form.description_label',
          modificationReason: 'accounting.journal_entry_form.modification_reason_label',
          accountId: 'accounting.journal_entry_form.account_column',
          debit: 'accounting.journal_entry_form.debit_column',
          credit: 'accounting.journal_entry_form.credit_column',
        }).filter((problem) => problem.fieldId !== 'lines'),
      );
      return;
    }

    this.problems.set([]);

    if (this.isSaving()) return;
    this.isSaving.set(true);

    const formData = this.entryForm.getRawValue();
    const editing = this.isEditMode() && !!this.id;

    const request = editing
      ? this.journalEntriesService.update(this.id!, formData)
      : this.journalEntriesService.create(formData);

    request.subscribe({
      next: () => {
        this.entryForm.markAsPristine();
        this.tab?.markClean();
        this.notificationService.showSuccess(
          editing
            ? 'accounting.journal_entry_form.entry_modified_original_reversed_new_one'
            : 'accounting.journal_entry_form.entry_created',
        );
        //  Esta ventana ya cumplió: el registro existe y la página se va a la lista. Si se dejara
        //  abierta seguiría anunciándose como «el formulario nuevo», y el siguiente clic en «Nuevo»
        //  la enfocaría con el documento ya guardado dentro. Ver `TabContext.close`.
        void this.router.navigate(['/accounting/journal-entries']).then(() => this.tab?.close());
      },
      error: (err) => {
        this.notificationService.showError(
          err.error?.message ||
            (editing ? 'errors.update_journal_entry' : 'errors.create_journal_entry'),
        );
        this.isSaving.set(false);
      },
      complete: () => {
        this.isSaving.set(false);
      }
    });
  }
}