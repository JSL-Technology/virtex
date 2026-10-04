import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { Observable, map, of, throwError } from 'rxjs';
import { accountNameOf } from '@virteex/shared/ui-i18n';
import { VX_SELECT } from '../../../shared/components/select';
import { PercentInputDirective } from '../../../shared/directives/percent-input.directive';
import { AccountingService } from '../../../core/api/accounting.service';
import { Account } from '../../../core/models/account.model';
import { NotificationService } from '../../../core/services/notification';
import {
  OrganizationSettingsService,
  SettingsAccountRef,
  SettingsSectionId,
  SettingsSectionPatch,
  SettingsSectionView,
} from '../data/organization-settings.service';

/** A group of default accounts, as one block of the screen. */
export interface AccountGroup {
  titleKey: string;
  fields: ReadonlyArray<{ field: string; labelKey: string; helpKey?: string }>;
}

/** A policy value the section edits. */
export interface PolicyField {
  field: string;
  labelKey: string;
  helpKey?: string;
  kind: 'integer' | 'percent' | 'select';
  min?: number;
  max?: number;
  /** For `select`: the values and the catalogue prefix that names each. */
  options?: readonly string[];
  optionPrefix?: string;
  nullable?: boolean;
}

/**
 * One section of the organization's settings, edited in place (QA M-09).
 *
 * Eleven sections said «En desarrollo» while the settings row already held the default accounts
 * every posting service reads, the exchange-rate policy and the taxpayer type. The pages are now
 * declarations — which accounts and which policies a section shows — and this renders and saves
 * them, offering in each picker only accounts of the type the role needs that take postings. The
 * API applies the same rules; this only saves the user a refusal.
 */
@Component({
  selector: 'app-settings-section',
  standalone: true,
  imports: [FormsModule, TranslateModule, PercentInputDirective, ...VX_SELECT],
  templateUrl: './settings-section.component.html',
  styleUrls: ['./settings-section.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsSectionComponent implements OnInit {
  private readonly api = inject(OrganizationSettingsService);
  private readonly accounting = inject(AccountingService);
  private readonly notifications = inject(NotificationService);

  readonly section = input.required<SettingsSectionId>();
  readonly groups = input<readonly AccountGroup[]>([]);
  readonly policies = input<readonly PolicyField[]>([]);
  /** Currencies only: show the books' currency, editable until there are books. */
  readonly showBaseCurrency = input(false);

  protected readonly view = signal<SettingsSectionView | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);

  /** What the user changed, by field; only this is sent. */
  protected readonly accountEdits = signal<Record<string, string | null>>({});
  protected readonly fieldEdits = signal<Record<string, unknown>>({});
  protected readonly baseCurrencyEdit = signal<string | null>(null);

  protected readonly dirty = computed(
    () =>
      Object.keys(this.accountEdits()).length > 0 ||
      Object.keys(this.fieldEdits()).length > 0 ||
      this.baseCurrencyEdit() !== null,
  );

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.get(this.section()).subscribe({
      next: (view) => this.accept(view),
      error: (error: unknown) => {
        this.loading.set(false);
        this.loadError.set(this.notifications.httpErrorMessage(error, 'settings.sections.load_failed'));
      },
    });
  }

  /** Account currently chosen for a field: the edit if there is one, else what is saved. */
  protected accountIdOf(field: string): string | null {
    const edits = this.accountEdits();
    if (field in edits) return edits[field];
    return this.view()?.accounts[field]?.id ?? null;
  }

  protected fieldValueOf(field: string): unknown {
    const edits = this.fieldEdits();
    return field in edits ? edits[field] : this.view()?.fields[field];
  }

  protected setAccount(field: string, id: string | null): void {
    const saved = this.view()?.accounts[field]?.id ?? null;
    this.accountEdits.update((edits) => {
      const next = { ...edits };
      if (id === saved) delete next[field];
      else next[field] = id;
      return next;
    });
  }

  protected setField(field: string, value: unknown): void {
    const saved = this.view()?.fields[field];
    this.fieldEdits.update((edits) => {
      const next = { ...edits };
      if (value === saved) delete next[field];
      else next[field] = value;
      return next;
    });
  }

  protected setBaseCurrency(code: string): void {
    const saved = this.view()?.baseCurrency?.code ?? null;
    this.baseCurrencyEdit.set(code.trim().toUpperCase() === saved ? null : code.trim().toUpperCase());
  }

  save(): void {
    if (!this.dirty()) return;
    const patch: SettingsSectionPatch = {};
    if (Object.keys(this.accountEdits()).length) patch.accounts = this.accountEdits();
    if (Object.keys(this.fieldEdits()).length) patch.fields = this.fieldEdits();
    if (this.baseCurrencyEdit()) patch.baseCurrency = this.baseCurrencyEdit()!;
    this.saving.set(true);
    this.api.update(this.section(), patch).subscribe({
      next: (view) => {
        this.saving.set(false);
        this.accept(view);
        this.notifications.showSuccess('settings.sections.saved');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notifications.showHttpError(error, 'settings.sections.save_failed');
      },
    });
  }

  discard(): void {
    this.accountEdits.set({});
    this.fieldEdits.set({});
    this.baseCurrencyEdit.set(null);
  }

  /**
   * One picker per account field, built once per loaded view so the select keeps stable inputs:
   * a search that offers only accounts that can fill the role (of its type, active, taking
   * postings), and a resolver that names the saved account without a request.
   */
  protected readonly pickers = computed(() => {
    const view = this.view();
    const pickers: Record<string, { search: (q: string, l: number) => Observable<Account[]>; resolve: (id: string) => Observable<Account> }> = {};
    if (!view) return pickers;
    for (const field of Object.keys(view.accounts)) {
      const expected = view.expectedTypes[field] ?? null;
      const saved = view.accounts[field];
      pickers[field] = {
        search: (query, limit) =>
          this.accounting.searchAccounts(query, Math.max(limit * 3, 50)).pipe(
            map((accounts) =>
              accounts
                .filter((a) => a.isPostable && a.isActive !== false && (!expected || a.type === expected))
                .slice(0, limit),
            ),
          ),
        resolve: (id) =>
          saved && saved.id === id ? of(saved as unknown as Account) : throwError(() => new Error('unknown account')),
      };
    }
    return pickers;
  });

  protected readonly accountLabel = (account: Account): string =>
    `${account.code} — ${accountNameOf(account.name as never)}`;
  protected readonly accountValue = (account: Account): string => account.id;

  /** The account type a field expects, for its hint. */
  protected expectedTypeOf(field: string): string | null {
    return this.view()?.expectedTypes[field] ?? null;
  }

  private accept(view: SettingsSectionView): void {
    this.view.set(view);
    this.discard();
    this.loading.set(false);
  }
}
