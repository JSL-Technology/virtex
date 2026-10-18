import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { LucideAngularModule, Plus, Trash2 } from 'lucide-angular';
import { Observable, map } from 'rxjs';
import { TranslateModule, FORMAT_PIPES, accountNameOf } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent } from '../../../shared/components/badge';
import { VX_SELECT } from '../../../shared/components/select';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { AuthService } from '../../../core/services/auth';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import { Account } from '../../../core/models/account.model';
import {
  DIMENSION_NAME_PATTERN,
  DIMENSION_VALUE_PATTERN,
  Dimension,
  DimensionRule,
  DimensionValue,
  DimensionsService,
  valueTree,
} from '../data/dimensions.service';

/** The dimension being edited: a copy, so the list does not change until it is saved. */
interface Draft {
  id: string | null;
  name: string;
  description: string;
  isActive: boolean;
  inUse: boolean;
  values: DimensionValue[];
}

const emptyDraft = (): Draft => ({ id: null, name: '', description: '', isActive: true, inUse: false, values: [] });

/**
 * Analytic dimensions (audit H-21): cost centres, projects, regions — whatever the company analyses
 * its books by — their values, arranged in a tree where one rolls up into another, and the
 * accounts on which one is mandatory. Odoo's analytic plans, NetSuite's segments.
 *
 * The cost-centre register this replaces was a table no screen and no posting used; its rows are
 * now the values of the «Centro de Costo» and «Centro de Beneficio» dimensions. A name or a code
 * that lines already carry is read-only — renaming it would move the history out of every report —
 * and a value no longer wanted is retired rather than deleted.
 */
@Component({
  selector: 'app-dimensions-page',
  standalone: true,
  imports: [FormsModule, TranslateModule, LucideAngularModule, ...FORMAT_PIPES, ...VX_SELECT, ListShellComponent, VxBadgeComponent, HasPermissionDirective],
  templateUrl: './dimensions.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss', '../../../shared/styles/document-form.scss', './dimensions.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DimensionsPage implements OnInit {
  private readonly dimensions = inject(DimensionsService);
  private readonly accounts = inject(ChartOfAccountsApiService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly auth = inject(AuthService);

  protected readonly AddIcon = Plus;
  protected readonly RemoveIcon = Trash2;

  readonly list = signal<Dimension[]>([]);
  readonly rules = signal<DimensionRule[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly draft = signal<Draft | null>(null);
  readonly problem = signal<string | null>(null);

  readonly ruleAccount = signal<string | null>(null);
  readonly ruleDimension = signal<string>('');

  readonly canManage = computed(() => this.auth.hasPermissions(['dimensions:manage']));
  readonly empty = computed(() => !this.loading() && !this.error() && this.list().length === 0 && !this.draft());
  /** The draft's values in tree order, with the depth to indent them by. */
  readonly tree = computed(() => valueTree(this.draft()?.values ?? []));

  protected readonly searchAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accounts.searchAccounts(query, limit).pipe(map((list) => (list ?? []).filter((account) => account.isPostable && account.isActive)));
  protected readonly resolveAccount = (id: string): Observable<Account> => this.accounts.getAccountById(id);
  protected readonly accountLabel = (account: Account): string => `${account.code} — ${accountNameOf(account.name)}`;
  protected readonly accountId = (account: Account): string => account.id;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.dimensions.list().subscribe({
      next: (list) => {
        this.list.set(list);
        this.loading.set(false);
        const current = this.draft();
        if (current?.id) {
          const fresh = list.find((dimension) => dimension.id === current.id);
          this.draft.set(fresh ? toDraft(fresh) : null);
        }
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'dimensions.page.load_failed'));
        this.loading.set(false);
      },
    });
    this.dimensions.rules().subscribe({
      next: (rules) => this.rules.set(rules),
      error: () => this.rules.set([]),
    });
  }

  select(dimension: Dimension): void {
    this.problem.set(null);
    this.draft.set(toDraft(dimension));
  }

  startNew(): void {
    this.problem.set(null);
    this.draft.set({ ...emptyDraft(), values: [{ value: '', name: null, isActive: true, parent: null }] });
  }

  closeEditor(): void {
    this.draft.set(null);
    this.problem.set(null);
  }

  patch(changes: Partial<Draft>): void {
    this.draft.update((draft) => (draft ? { ...draft, ...changes } : draft));
  }

  patchValue(index: number, changes: Partial<DimensionValue>): void {
    this.draft.update((draft) => {
      if (!draft) return draft;
      // A renamed code carries its children with it.
      const before = draft.values[index]?.value;
      const renamed = changes.value !== undefined && before && before !== changes.value;
      const values = draft.values.map((value, position) => {
        if (position === index) return { ...value, ...changes };
        if (renamed && value.parent === before) return { ...value, parent: changes.value as string };
        return value;
      });
      return { ...draft, values };
    });
  }

  addValue(): void {
    this.draft.update((draft) => (draft ? { ...draft, values: [...draft.values, { value: '', name: null, isActive: true, parent: null }] } : draft));
  }

  removeValue(index: number): void {
    this.draft.update((draft) => {
      if (!draft) return draft;
      const removed = draft.values[index]?.value;
      const values = draft.values
        .filter((_, position) => position !== index)
        .map((value) => (value.parent === removed ? { ...value, parent: null } : value));
      return { ...draft, values };
    });
  }

  /** Position of a value in the draft, for the tree-ordered rows to edit the right one. */
  indexOf(value: DimensionValue): number {
    return this.draft()?.values.indexOf(value) ?? -1;
  }

  /** The values another may roll up into: any but itself and its own descendants. */
  parentOptions(value: DimensionValue): DimensionValue[] {
    const draft = this.draft();
    if (!draft) return [];
    const descendants = new Set<string>([value.value]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const candidate of draft.values) {
        if (candidate.parent && descendants.has(candidate.parent) && !descendants.has(candidate.value)) {
          descendants.add(candidate.value);
          grew = true;
        }
      }
    }
    return draft.values.filter((candidate) => candidate.value && !descendants.has(candidate.value));
  }

  save(): void {
    const draft = this.draft();
    if (!draft) return;
    const problem = validate(draft);
    this.problem.set(problem);
    if (problem) return;

    const body = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      isActive: draft.isActive,
      values: draft.values.map((value) => ({
        ...(value.id ? { id: value.id } : {}),
        value: value.value.trim(),
        name: value.name?.trim() || null,
        isActive: value.isActive,
        parent: value.parent || null,
      })),
    };
    this.saving.set(true);
    const request = draft.id ? this.dimensions.update(draft.id, body) : this.dimensions.create(body);
    request.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.dimensions.invalidate();
        this.notifications.showSuccess('dimensions.page.saved', { name: saved.name });
        this.draft.set(toDraft(saved));
        this.load();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notifications.showHttpError(error, 'dimensions.page.save_failed');
      },
    });
  }

  async remove(): Promise<void> {
    const draft = this.draft();
    if (!draft?.id) return;
    const confirmed = await this.dialog.confirm({
      title: 'dimensions.page.delete_title',
      message: 'dimensions.page.delete_message',
      messageParams: { name: draft.name },
      confirmText: 'dimensions.page.delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.dimensions.remove(draft.id).subscribe({
      next: () => {
        this.dimensions.invalidate();
        this.notifications.showSuccess('dimensions.page.deleted', { name: draft.name });
        this.draft.set(null);
        this.load();
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'dimensions.page.delete_failed'),
    });
  }

  addRule(): void {
    const accountId = this.ruleAccount();
    const dimensionId = this.ruleDimension();
    if (!accountId || !dimensionId) return;
    this.dimensions.addRule(accountId, dimensionId).subscribe({
      next: () => {
        this.ruleAccount.set(null);
        this.ruleDimension.set('');
        this.notifications.showSuccess('dimensions.rules.added');
        this.dimensions.rules().subscribe({ next: (rules) => this.rules.set(rules) });
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'dimensions.rules.add_failed'),
    });
  }

  removeRule(rule: DimensionRule): void {
    this.dimensions.removeRule(rule.accountId, rule.dimensionId).subscribe({
      next: () => this.rules.update((rules) => rules.filter((candidate) => candidate !== rule)),
      error: (error: unknown) => this.notifications.showHttpError(error, 'dimensions.rules.remove_failed'),
    });
  }

  accountName(name: unknown): string {
    return accountNameOf(name as Parameters<typeof accountNameOf>[0]);
  }

  activeCount(dimension: Dimension): number {
    return dimension.values.filter((value) => value.isActive).length;
  }
}

function toDraft(dimension: Dimension): Draft {
  return {
    id: dimension.id,
    name: dimension.name,
    description: dimension.description ?? '',
    isActive: dimension.isActive,
    inUse: dimension.inUse,
    values: dimension.values.map((value) => ({ ...value })),
  };
}

/** What the server would refuse, said before the round trip. Returns a translation key or null. */
export function validate(draft: Draft): string | null {
  const name = draft.name.trim();
  if (!name) return 'dimensions.page.name_required';
  if (!DIMENSION_NAME_PATTERN.test(name) || name.length > 64) return 'validation.constraints.dimension_name';
  const codes = new Set<string>();
  for (const value of draft.values) {
    const code = value.value.trim();
    if (!code) return 'dimensions.page.code_required';
    if (!DIMENSION_VALUE_PATTERN.test(code) || code.length > 64) return 'dimensions.page.code_invalid';
    if (codes.has(code)) return 'dimensions.page.code_duplicated';
    codes.add(code);
  }
  return null;
}
