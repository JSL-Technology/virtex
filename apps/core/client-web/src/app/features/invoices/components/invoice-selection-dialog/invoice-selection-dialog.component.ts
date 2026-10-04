import { Component, ChangeDetectionStrategy, DestroyRef, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Search, X } from 'lucide-angular';
import { InvoicesService, Invoice } from '../../../../core/services/invoices';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxDialogComponent } from '../../../../shared/components/dialog';
import { VxAmountComponent } from '../../../../shared/components/amount';
import { VxSpinnerComponent, VxEmptyStateComponent } from '../../../../shared/components/feedback';
import { VX_SORT, sortable } from '../../../../shared/components/sort';

@Component({
  selector: 'app-invoice-selection-dialog',
  standalone: true,
  imports: [...VX_SORT, 
    CommonModule,
    FormsModule,
    LucideAngularModule,
    TranslateModule,
    ...FORMAT_PIPES,
    VxDialogComponent,
    VxAmountComponent,
    VxSpinnerComponent,
    VxEmptyStateComponent,
    ...VX_FORM_A11Y,
  ],
  templateUrl: './invoice-selection-dialog.component.html',
  styleUrls: ['./invoice-selection-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvoiceSelectionDialogComponent {
  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.filteredInvoices());
  private readonly invoicesService = inject(InvoicesService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly SearchIcon = Search;
  protected readonly CloseIcon = X;

  readonly invoices = signal<Invoice[]>([]);
  readonly isLoading = signal(false);
  readonly searchTerm = signal('');
  readonly isOpen = signal(false);
  private readonly onSelect = signal<((invoice: Invoice) => void) | null>(null);
  private readonly searches = new Subject<string>();

  /** Kept for the template, which renders this list; the filtering now happens on the server. */
  readonly filteredInvoices = computed(() => this.invoices());

  constructor() {
    // It fetched on init, so every «Nueva factura» paid for fifty invoices it would almost never
    // show, and the search only filtered those fifty: an older invoice could not be found at all.
    // Now the list is fetched when the dialog opens, and each search asks the server, which
    // searches the whole ledger of invoices, not the page that happened to be loaded.
    this.searches
      .pipe(
        debounceTime(250),
        map((term) => term.trim()),
        distinctUntilChanged(),
        tap(() => this.isLoading.set(true)),
        switchMap((search) =>
          this.invoicesService
            .getInvoices({ limit: 50, search: search || undefined })
            .pipe(catchError(() => of({ items: [] as Invoice[] }))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        this.invoices.set(result.items);
        this.isLoading.set(false);
      });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.searches.next(term);
  }

  open(callback: (invoice: Invoice) => void): void {
    // The callback itself. It stored `() => callback`, so choosing an invoice called a function that
    // merely RETURNED the callback: «Copiar de» never copied anything (QA A-09).
    this.onSelect.set(callback);
    this.isOpen.set(true);
    this.isLoading.set(true);
    // A fresh query every time it opens: an invoice issued a minute ago must be offered.
    this.invoicesService
      .getInvoices({ limit: 50, search: this.searchTerm().trim() || undefined })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.invoices.set(result.items);
          this.isLoading.set(false);
        },
        error: () => {
          this.invoices.set([]);
          this.isLoading.set(false);
        },
      });
  }

  close(): void {
    this.isOpen.set(false);
  }

  selectInvoice(invoice: Invoice): void {
    const callback = this.onSelect();
    this.close();
    if (callback) callback(invoice);
  }
}
