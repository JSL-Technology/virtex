import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Observable, map, of, throwError } from 'rxjs';
import { TranslateModule, accountNameOf, VxNumberInputDirective } from '@virteex/shared/ui-i18n';
import { VX_SELECT } from '../../../shared/components/select';
import { PercentInputDirective } from '../../../shared/directives/percent-input.directive';
import { AccountingService } from '../../../core/api/accounting.service';
import { Account } from '../../../core/models/account.model';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { SettingsChanges, SettingsSaveBarComponent, SettingsShellService } from '../shell';
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
  imports: [VxNumberInputDirective, FormsModule, TranslateModule, PercentInputDirective, SettingsSaveBarComponent, ...VX_SELECT],
  templateUrl: './settings-section.component.html',
  styleUrls: ['./settings-section.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsSectionComponent implements OnInit {
  private readonly api = inject(OrganizationSettingsService);
  private readonly accounting = inject(AccountingService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly shell = inject(SettingsShellService, { optional: true });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly section = input.required<SettingsSectionId>();
  /**
   * Inside a page that shows several sections and saves them together («Default accounts»): no save
   * bar of its own, and the page — not this — tells the shell about unsaved work.
   */
  readonly embedded = input(false);
  /** The heading of this block, when the page shows several. */
  readonly titleKey = input<string | null>(null);
  /** The anchor an old link brings into view (`#settings/inventory-policies` → `inventory`). */
  readonly anchor = input<string | null>(null);
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

  /** Whether the person may change these settings: the shell says, from the edit permission. */
  readonly canEdit = computed(() => this.shell?.canEdit() ?? true);

  readonly dirty = computed(
    () =>
      Object.keys(this.accountEdits()).length > 0 ||
      Object.keys(this.fieldEdits()).length > 0 ||
      this.baseCurrencyEdit() !== null,
  );

  private readonly changes: SettingsChanges = {
    dirty: this.dirty,
    save: () => this.save(),
    discard: () => this.discard(),
  };

  ngOnInit(): void {
    this.load();
    if (!this.embedded() && this.shell) {
      this.shell.register(this.changes);
      this.destroyRef.onDestroy(() => this.shell?.unregister(this.changes));
    }
  }

  /** How many fields have been changed: for the page that saves several sections at once. */
  readonly changeCount = computed(
    () => Object.keys(this.accountEdits()).length + Object.keys(this.fieldEdits()).length + (this.baseCurrencyEdit() !== null ? 1 : 0),
  );

  /** Whether the edits include a default account: the change that moves future postings. */
  readonly changesAccounts = computed(() => Object.keys(this.accountEdits()).length > 0);

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

  /**
   * Saves the edits. Default accounts decide where every future posting lands, so changing one is
   * confirmed first, saying so — unless the page saving several sections already asked.
   */
  async save(options: { confirmed?: boolean } = {}): Promise<boolean> {
    if (!this.dirty() || !this.canEdit()) return false;
    if (this.changesAccounts() && !options.confirmed) {
      const confirmed = await this.dialog.confirm({
        title: 'settings.sections.confirm_accounts_title',
        message: 'settings.sections.confirm_accounts_message',
        messageParams: { count: Object.keys(this.accountEdits()).length },
        confirmText: 'settings.shell.save',
        variant: 'warning',
      });
      if (!confirmed) return false;
    }
    const patch: SettingsSectionPatch = {};
    if (Object.keys(this.accountEdits()).length) patch.accounts = this.accountEdits();
    if (Object.keys(this.fieldEdits()).length) patch.fields = this.fieldEdits();
    if (this.baseCurrencyEdit()) patch.baseCurrency = this.baseCurrencyEdit()!;
    this.saving.set(true);
    return new Promise((resolve) => {
      this.api.update(this.section(), patch).subscribe({
        next: (view) => {
          this.saving.set(false);
          this.accept(view);
          if (!this.embedded()) this.notifications.showSuccess('settings.sections.saved');
          resolve(true);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.notifications.showHttpError(error, 'settings.sections.save_failed');
          resolve(false);
        },
      });
    });
  }

  /** The default an account field returns to: the account its chart role points at. */
  protected defaultAccountOf(field: string): SettingsAccountRef | null {
    return this.view()?.defaultAccounts?.[field] ?? null;
  }

  protected defaultFieldOf(field: string): unknown {
    return this.view()?.defaultFields?.[field] ?? null;
  }

  /** Whether a field currently differs from its default, so «Restore default» is worth offering. */
  protected differsFromDefault(field: string, kind: 'account' | 'field'): boolean {
    if (kind === 'account') {
      const fallback = this.defaultAccountOf(field);
      return Boolean(fallback) && this.accountIdOf(field) !== fallback!.id;
    }
    const fallback = this.defaultFieldOf(field);
    return fallback !== null && fallback !== undefined && String(this.fieldValueOf(field) ?? '') !== String(fallback);
  }

  protected restoreDefault(field: string, kind: 'account' | 'field'): void {
    if (kind === 'account') this.setAccount(field, this.defaultAccountOf(field)?.id ?? null);
    else {
      const fallback = this.defaultFieldOf(field);
      this.setField(field, typeof this.fieldValueOf(field) === 'number' ? Number(fallback) : fallback);
    }
  }

  /** Brings this block into view when an old link pointed at it. */
  private reveal(): void {
    if (!this.anchor()) return;
    queueMicrotask(() => this.host.nativeElement.scrollIntoView({ block: 'start', behavior: 'smooth' }));
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
    const first = this.view() === null;
    this.view.set(view);
    this.discard();
    this.loading.set(false);
    if (first) this.reveal();
  }

  /** The account's label, for a default shown as a hint. */
  protected refLabel(account: SettingsAccountRef): string {
    return `${account.code} — ${accountNameOf(account.name as never)}`;
  }
}
