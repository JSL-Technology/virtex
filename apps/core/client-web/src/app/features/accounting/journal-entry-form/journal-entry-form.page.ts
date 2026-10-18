import { Component, ChangeDetectionStrategy, inject, OnInit, signal, computed, Input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { LucideAngularModule, Save, Plus, Trash2 } from 'lucide-angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
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
import { FORMAT_PIPES, accountNameOf } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxDateFieldComponent } from '../../../shared/components/date';
import { VX_SELECT } from '../../../shared/components/select';
import { ChartOfAccountsApiService } from '../data/chart-of-accounts.service';
import { Dimension, DimensionValue, DimensionsService, valueLabel, valueTree } from '../data/dimensions.service';
import { Observable } from 'rxjs';

// Validador personalizado para el asiento contable
export const journalEntryValidator = (control: AbstractControl): ValidationErrors | null => {
  const lines = control.get('lines') as FormArray;
  if (!lines || lines.length === 0) {
    return null; // No hay líneas para validar
  }

  let totalDebit = 0;
  let totalCredit = 0;
  //  Líneas que cargan débito Y crédito a la vez. El servidor las rechaza
  //  (`line_line_carries_both_debit_credit`) y el formulario las dejaba pasar (QA M-04): se dice
  //  aquí, con el número de línea, antes de enviar nada.
  const bothSides: number[] = [];

  lines.controls.forEach((line, index) => {
    const debit = Number(line.get('debit')?.value) || 0;
    const credit = Number(line.get('credit')?.value) || 0;
    totalDebit += debit;
    totalCredit += credit;
    if (debit > 0 && credit > 0) bothSides.push(index + 1);
  });

  if (bothSides.length) {
    return { bothSides: { lines: bothSides.join(', ') } };
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


/** Where an entry came from, as the server describes it (`journal-entries/entry-origin.ts`). */
interface EntryOrigin {
  locked: boolean;
  reason: string | null;
  document: { type: string; id: string; route: string | null } | null;
}

@Component({
  selector: 'app-journal-entry-form-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, LucideAngularModule, TranslatePipe, ...FORMAT_PIPES, DraftShellComponent, ...VX_FORM_A11Y, VxDateFieldComponent, ...VX_SELECT],
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
  private chartOfAccountsService = inject(ChartOfAccountsApiService);
  private ledgersService = inject(LedgersService);
  private journalsService = inject(JournalsService);
  private dimensionsService = inject(DimensionsService);
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
  /**
   * The entry is shown for reading only: it cannot be modified (see `editBlockedKey`).
   *
   * It used to open as «Edit journal entry» with every field editable, a «Reason for the change»
   * and an active «Save entry» that did nothing when pressed — no request, no message (QA M5).
   */
  readonly readOnly = computed(() => this.editBlockedKey() !== null);
  /** The document an automatic entry belongs to, when the server could name it. */
  readonly sourceRoute = signal<string | null>(null);
  /** The entry being modified, once loaded. */
  readonly original = signal<ApiJournalEntry | null>(null);
  ledgers = signal<Ledger[]>([]);
  journals = signal<Journal[]>([]);
  totalDebit = signal(0);
  totalCredit = signal(0);

  /**
   * The dimensions a line can be tagged with (audit H-21): the active ones, each with its active
   * values in tree order. A line of an entry being modified keeps a value retired since, so it
   * still shows what the line carries.
   */
  readonly tagDimensions = signal<Dimension[]>([]);
  /** Which dimensions each account requires, from the rules — the server checks them again. */
  readonly requiredByAccount = signal<Map<string, string[]>>(new Map());
  /** Whether the tagging row under each line is open. Opens itself when there is something to say. */
  readonly showDimensions = signal(false);
  readonly hasDimensions = computed(() => this.tagDimensions().length > 0);
  protected readonly valueLabel = valueLabel;

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
        // The accounting of a document — an invoice, a payroll run — is corrected from that
        // document, never here; the server refuses it, so the screen does not offer it.
        const origin = (entry as unknown as { origin?: EntryOrigin }).origin;
        if (origin?.locked) {
          this.editBlockedKey.set('accounting.journal_entry_form.generated_from_document');
          this.sourceRoute.set(origin.document?.route ?? null);
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
            dimensions: { ...(line.dimensions ?? {}) },
          });
          this.lines.push(group);
        }
        //  Un asiento siempre tiene al menos dos líneas, pero un asiento roto no puede dejar el
        //  formulario sin ninguna: sin filas no hay dónde escribir la corrección.
        while (this.lines.length < 2) this.addLine();
        this.revealTagsWhenUsed();

        this.entryForm.markAsPristine();
        if (this.readOnly()) this.lockForm();
      },
      error: () => {
        this.isLoading.set(false);
        this.editBlockedKey.set('accounting.journal_entry_form.entry_not_found');
        this.lockForm();
      },
    });
  }

  /** Nothing on a read-only entry can be typed into, and the reason is not asked for. */
  private lockForm(): void {
    this.entryForm.removeControl('modificationReason', { emitEvent: false });
    this.entryForm.disable({ emitEvent: false });
    this.showDimensions.set(this.lines.controls.some((line) => Object.keys(line.get('dimensions')?.value ?? {}).length > 0));
  }

  /**
   * Busca cuentas en el servidor.
   *
   * Campo de función y no método: `vx-select` lo recibe como entrada, y una referencia a método
   * llegaría sin `this`. Declararlo así mantiene además su identidad estable entre ciclos de
   * detección de cambios.
   */
  protected readonly searchAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accountingService.searchAccounts(query, limit);

  /** Nombra la cuenta que un id designa: el asiento puede llegar ya con cuentas puestas. */
  protected readonly resolveAccount = (id: string): Observable<Account> =>
    this.chartOfAccountsService.getAccountById(id);

  /** «1101 — Efectivo en caja». El código primero: es como se busca una cuenta. */
  protected readonly accountLabel = (account: Account): string =>
    `${account.code} — ${accountNameOf(account.name)}`;

  protected readonly accountId = (account: Account): string => account.id;

  loadInitialData(): void {
    this.ledgersService.getLedgers().subscribe({
      next: (data) => {
        this.ledgers.set(data);
        //  El libro principal viene elegido. Casi todo asiento manual va a él, y dejar el campo
        //  vacío obligaba a elegir lo obvio en cada asiento.
        const control = this.entryForm?.get('ledgerId');
        if (control && !control.value) {
          const preset = data.find((ledger) => ledger.isDefault) ?? (data.length === 1 ? data[0] : null);
          if (preset) control.setValue(preset.id, { emitEvent: false });
        }
      },
      error: () => this.notificationService.showError('accounting.journal_entry_form.ledgers_load_failed')
    });
    // Tagging is optional context: an entry must still be writable when dimensions cannot load,
    // or the user cannot read them. The server validates the tags either way.
    this.dimensionsService.forTagging().subscribe({
      next: (list) => {
        this.tagDimensions.set(
          list
            .filter((dimension) => dimension.isActive)
            .map((dimension) => ({ ...dimension, values: dimension.values.filter((value) => value.isActive) })),
        );
        this.revealTagsWhenUsed();
      },
      error: () => this.tagDimensions.set([]),
    });
    this.dimensionsService.rules().subscribe({
      next: (rules) => {
        const byAccount = new Map<string, string[]>();
        for (const rule of rules) {
          if (!rule.isRequired) continue;
          byAccount.set(rule.accountId, [...(byAccount.get(rule.accountId) ?? []), rule.dimensionName]);
        }
        this.requiredByAccount.set(byAccount);
        this.revealTagsWhenUsed();
      },
      error: () => this.requiredByAccount.set(new Map()),
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
      dimensions: [{} as Record<string, string>],
    });
  }

  /** The line's value for a dimension, or empty. */
  lineTag(index: number, dimension: string): string {
    const tags = (this.lines.at(index)?.get('dimensions')?.value ?? {}) as Record<string, string>;
    return tags[dimension] ?? '';
  }

  setLineTag(index: number, dimension: string, value: string): void {
    const control = this.lines.at(index)?.get('dimensions');
    if (!control) return;
    const tags = { ...((control.value ?? {}) as Record<string, string>) };
    if (value) tags[dimension] = value;
    else delete tags[dimension];
    control.setValue(tags);
    control.markAsDirty();
  }

  /** The dimensions the account on this line requires. */
  requiredFor(index: number): string[] {
    const accountId = this.lines.at(index)?.get('accountId')?.value as string | undefined;
    return accountId ? (this.requiredByAccount().get(accountId) ?? []) : [];
  }

  /** The values to offer for a dimension on a line: the active ones, plus the one it already carries. */
  tagOptions(index: number, dimension: Dimension): Array<{ value: DimensionValue; depth: number }> {
    const current = this.lineTag(index, dimension.name);
    const values =
      current && !dimension.values.some((value) => value.value === current)
        ? [...dimension.values, { value: current, name: null, isActive: false, parent: null }]
        : dimension.values;
    return valueTree(values);
  }

  /** `  ` per level, so a child reads under its parent in a native select. */
  indent(depth: number): string {
    return '\u00a0\u00a0'.repeat(depth);
  }

  /** Lines missing a dimension their account requires: line number and dimension. */
  missingTags(): Array<{ line: number; dimension: string }> {
    const missing: Array<{ line: number; dimension: string }> = [];
    this.lines.controls.forEach((_, index) => {
      for (const dimension of this.requiredFor(index)) {
        if (!this.lineTag(index, dimension)) missing.push({ line: index + 1, dimension });
      }
    });
    return missing;
  }

  private revealTagsWhenUsed(): void {
    if (!this.hasDimensions()) return;
    const tagged = this.lines?.controls.some((line) => Object.keys(line.get('dimensions')?.value ?? {}).length > 0);
    if (tagged || this.requiredByAccount().size > 0) this.showDimensions.set(true);
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
    // An entry that cannot be modified is not saved, whatever the form says.
    if (this.editBlockedKey()) return;
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

    // A dimension the account requires, said per line before the round trip.
    const missing = this.missingTags();
    if (missing.length) {
      this.showDimensions.set(true);
      this.problems.set(
        missing.map((gap) => ({
          message: 'accounting.journal_entry_form.dimension_required',
          params: gap,
        })),
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
        //  El motivo del servidor —período cerrado, cuenta que no admite movimientos, fecha fuera
        //  del rango permitido— es lo que el usuario necesita para corregir el asiento; el
        //  genérico «No se pudo crear el asiento» no le decía nada (QA C-05, A-17).
        this.notificationService.showHttpError(
          err,
          editing ? 'errors.update_journal_entry' : 'errors.create_journal_entry',
        );
        this.isSaving.set(false);
      },
      complete: () => {
        this.isSaving.set(false);
      }
    });
  }
}