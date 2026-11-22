import { Injectable, computed, signal, inject } from '@angular/core';
import { take } from 'rxjs/operators';
import { Account } from '../../../core/models/account.model';
import { FlattenedAccount } from '../../../core/models/flattened-account.model';
import { TreeService } from '../../../core/services/tree';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import { NotificationService } from '../../../core/services/notification';
import { AccountType } from '../../../core/models/account.model';
import { accountNameFor } from '@virtex/shared/ui-i18n';
type Sort = { field: keyof FlattenedAccount; direction: 'asc' | 'desc' };
/** A summary account, as the parent picker offers it. */
export interface ParentAccountOption {
  id: string;
  code: string;
  name: Account['name'];
  type: AccountType;
}
type Filters = { status: 'ALL' | 'ACTIVE' | 'INACTIVE'; type: 'ALL' | AccountType; };

@Injectable({ providedIn: 'root' })
export class ChartOfAccountsStateService {
  private readonly apiService = inject(ChartOfAccountsApiService);
  private readonly treeService = inject(TreeService);
  private readonly notificationService = inject(NotificationService);

  // --- Estado Interno (Signals) ---
  readonly isLoading = signal<boolean>(true);
  readonly error = signal<string | null>(null);
  private readonly allAccounts = signal<Account[]>([]); // Lista plana desde la API
  private readonly expandedAccountIds = signal<Set<string>>(new Set());
  
  // Estado para filtros, búsqueda y ordenación
  readonly searchTerm = signal<string>('');
  readonly filters = signal<Filters>({ status: 'ALL', type: 'ALL' });
  readonly sort = signal<Sort>({ field: 'code', direction: 'asc' });

  // --- Estado Derivado (Computed Signals) ---

  // Construye el árbol jerárquico a partir de la lista plana
  readonly accountTree = computed(() => this.treeService.buildTree(this.allAccounts(), this.sort()));

  // Aplana el árbol y añade propiedades de UI (nivel, expansión, etc.)
  readonly flattenedAccounts = computed<FlattenedAccount[]>(() => {
    const tree = this.accountTree();
    const expandedIds = this.expandedAccountIds();
    const flatAccounts = this.treeService.flattenTree(tree);
    return flatAccounts.map(acc => ({
      ...acc,
      isExpanded: expandedIds.has(acc.id)
    }));
  });

  // Filtra las cuentas aplanadas para mostrarlas en la UI
  readonly displayAccounts = computed<FlattenedAccount[]>(() => {
    const accounts = this.flattenedAccounts();
    const expandedIds = this.expandedAccountIds();
    const term = this.searchTerm().toLowerCase();
    const currentFilters = this.filters();

    const filteredAccounts = accounts.filter(acc => {
      const statusMatch = currentFilters.status === 'ALL' || (currentFilters.status === 'ACTIVE' ? acc.isActive : !acc.isActive);
      const typeMatch = currentFilters.type === 'ALL' || acc.type === currentFilters.type;
      return statusMatch && typeMatch;
    });

    if (!term) {
      // Si no hay búsqueda, mostrar la jerarquía filtrada
      return filteredAccounts.filter(acc => acc.level === 0 || expandedIds.has(acc.parentId!));
    }

    // Con búsqueda, mostrar una lista plana que coincida
    return filteredAccounts.filter(
      (acc) => accountNameFor(acc.name).includes(term) || acc.code.toLowerCase().includes(term),
    );
  });

  /**
   * The accounts an account of `type` can sit under (FIN-COA-05): summary accounts of that same
   * type. A revenue account under the assets, or a sub-account under an account that takes postings,
   * makes every total of the tree wrong, and the server refuses both. Editing `accountId`, the account
   * itself and its descendants are left out too: under one of them the tree would loop.
   *
   * No type chosen yet: every summary account, and choosing one gives the new account its type.
   */
  parentOptionsFor(type: AccountType | null, accountId: string | null): ParentAccountOption[] {
    const accounts = this.allAccounts();
    const excluded = accountId ? this.subtreeOf(accounts, accountId) : new Set<string>();
    return accounts
      .filter((account) => !account.isPostable && (!type || account.type === type) && !excluded.has(account.id))
      .map((account) => ({ id: account.id, name: account.name, code: account.code, type: account.type }));
  }

  /**
   * Where an account's inflation restatement can go (FIN-AC-04): a postable account of the same
   * type, not restated itself, not the account's own, and taking no other account's restatement —
   * the server refuses every other choice.
   */
  restatementTargetsFor(type: AccountType | null, accountId: string | null): ParentAccountOption[] {
    if (!type) return [];
    const accounts = this.allAccounts();
    const taken = new Set(
      accounts.filter((account) => account.inflationAdjustmentAccountId && account.id !== accountId).map((account) => account.inflationAdjustmentAccountId as string),
    );
    return accounts
      .filter(
        (account) =>
          account.isPostable &&
          account.type === type &&
          account.id !== accountId &&
          !account.isInflationAdjustable &&
          !account.inflationAdjustmentAccountId &&
          account.fxTreatment !== 'REVALUED' &&
          account.systemRole !== 'INFLATION_ADJUSTMENT' &&
          !taken.has(account.id),
      )
      .map((account) => ({ id: account.id, name: account.name, code: account.code, type: account.type }));
  }

  /** Whether the account takes another account's restatement (it is then never restated itself). */
  isRestatementTarget(id: string): boolean {
    return this.allAccounts().some((account) => account.inflationAdjustmentAccountId === id);
  }

  /** The type of the summary account `id`, to give a new sub-account the type of its parent. */
  typeOf(id: string): AccountType | null {
    return this.allAccounts().find((account) => account.id === id)?.type ?? null;
  }

  /** `rootId` and every account below it. */
  private subtreeOf(accounts: readonly Account[], rootId: string): Set<string> {
    const children = new Map<string, string[]>();
    for (const account of accounts) {
      if (!account.parentId) continue;
      const siblings = children.get(account.parentId) ?? [];
      siblings.push(account.id);
      children.set(account.parentId, siblings);
    }
    const subtree = new Set<string>([rootId]);
    const pending = [rootId];
    while (pending.length > 0) {
      for (const child of children.get(pending.pop() as string) ?? []) {
        if (!subtree.has(child)) {
          subtree.add(child);
          pending.push(child);
        }
      }
    }
    return subtree;
  }

  // --- Acciones Públicas ---

  /** Whether the chart has been read, or is being read, in this session. A failed read clears it. */
  private requested = false;

  public loadAccounts(): void {
    this.requested = true;
    this.isLoading.set(true);
    this.error.set(null);
    this.apiService.getAccounts().pipe(take(1)).subscribe({
      next: (accounts) => {
        this.allAccounts.set(accounts);
        this.isLoading.set(false);
      },
      error: () => {
        this.requested = false;
        //  A catalogue key: the list shell translates what it is given, and an English sentence
        //  here reached every user as is.
        this.error.set('accounting.chart_of_accounts.load_failed');
        this.isLoading.set(false);
      }
    });
  }

  /**
   * Reads the chart unless it has been read already. The account form needs it for its parent
   * picker, and it is not always opened from the list that reads it: a link or a restored tab opens
   * it directly, and its parent picker then offered nothing.
   */
  public ensureLoaded(): void {
    if (!this.requested) this.loadAccounts();
  }

  public refreshAccounts(): void {
    this.loadAccounts();
  }

  public toggleAccountExpansion(accountId: string): void {
    this.expandedAccountIds.update(currentSet => {
      const newSet = new Set(currentSet);
      if (newSet.has(accountId)) {
        newSet.delete(accountId);
      } else {
        newSet.add(accountId);
      }
      return newSet;
    });
  }

  public deleteAccount(accountId: string): void {
    this.apiService.deleteAccount(accountId).pipe(take(1)).subscribe({
        next: () => {
            this.notificationService.showSuccess('core.state.account_deleted_successfully');
            this.refreshAccounts();
        },
        // An account with movements is refused, and the reason says what to do instead (block it).
        error: (error: unknown) => this.notificationService.showHttpError(error, 'core.state.failed_delete_account')
    });
  }

  // --- Acciones para UI ---

  public setSearchTerm(term: string): void {
    this.searchTerm.set(term);
  }

  public setFilter(filter: keyof Filters, value: any): void {
    this.filters.update(current => ({ ...current, [filter]: value }));
  }

  public setSort(field: keyof FlattenedAccount): void {
    this.sort.update(current => {
      const direction = current.field === field && current.direction === 'asc' ? 'desc' : 'asc';
      return { field, direction };
    });
  }
}