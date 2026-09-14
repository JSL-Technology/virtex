import { Component, ChangeDetectionStrategy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';

import { ListShellComponent } from '../../../shared/components/gestures';
import { Currency, CurrenciesService } from '../../../core/api/currencies.service';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';
import { NotificationService } from '../../../core/services/notification';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

/**
 * The currencies the tenant transacts in.
 *
 * ## What this replaces
 *
 * Three hard-coded rows — Dominican peso, US dollar, euro — and a "New currency" button wired to
 * nothing. The screen made no request at all, so it was not a stale view of the data: it was
 * unrelated to it. The tenant's real list held twenty-three currencies, none of which could be seen
 * here, and a currency added anywhere else in the product never appeared. `GET /currencies` had
 * answered since before this screen was written.
 *
 * Which currency is the base one is the tenant's, not a row's: it comes from the locale context the
 * session resolves, so it cannot disagree with what the ledger actually posts in.
 */
@Component({
  selector: 'app-currencies-page',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule, ListShellComponent, FormsModule, ...VX_FORM_A11Y],
  templateUrl: './currencies.page.html',
  styleUrls: ['./currencies.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CurrenciesPage implements OnInit {
  protected readonly PlusCircleIcon = PlusCircle;

  private readonly api = inject(CurrenciesService);
  private readonly errors = inject(ErrorHandlerService);
  private readonly notifications = inject(NotificationService);
  private readonly locale = inject(LocaleStore);

  readonly currencies = signal<Currency[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);

  readonly creating = signal(false);
  readonly draftCode = signal('');
  readonly draftName = signal('');
  readonly draftSymbol = signal('');

  /** The tenant's functional currency — what an amount with no code of its own is in. */
  readonly baseCurrency = computed(() => this.locale.currency());

  readonly canSave = computed(
    () =>
      !this.saving() &&
      this.draftCode().trim().length === 3 &&
      this.draftName().trim().length > 0 &&
      this.draftSymbol().trim().length > 0,
  );

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getCurrencies().subscribe({
      next: (list) => {
        this.currencies.set([...(list ?? [])].sort((a, b) => a.code.localeCompare(b.code)));
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.errors.keyFor(err));
        this.loading.set(false);
      },
    });
  }

  toggleCreate(): void {
    this.creating.update((open) => !open);
    if (!this.creating()) this.resetDraft();
  }

  save(): void {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.api
      .create({
        code: this.draftCode().trim().toUpperCase(),
        name: this.draftName().trim(),
        symbol: this.draftSymbol().trim(),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.creating.set(false);
          this.resetDraft();
          this.notifications.showSuccess('masters.currencies.created');
          this.load();
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.notifications.showError(this.errors.keyFor(err));
        },
      });
  }

  private resetDraft(): void {
    this.draftCode.set('');
    this.draftName.set('');
    this.draftSymbol.set('');
  }
}
