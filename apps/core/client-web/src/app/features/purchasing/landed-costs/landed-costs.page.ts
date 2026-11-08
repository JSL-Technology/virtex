import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, forkJoin, map } from 'rxjs';
import { TranslateModule, FORMAT_PIPES, accountNameOf } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VX_SELECT } from '../../../shared/components/select';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import { Account } from '../../../core/models/account.model';
import {
  GoodsReceiptRow,
  LandedCostApplication,
  LandedCostMethod,
  LandedCostType,
  PurchasingService,
} from '../data/purchasing.service';

/**
 * Landed costs (audit 2026-11-07, CMP-21): freight, customs and insurance applied to goods already
 * received. The cost is prorated over the receipts' stocked lines by the type's method, raises the
 * average cost of what is still in the warehouse and books the rest to the cost of sales. The
 * catalogue of types used to be the only thing that existed, and nothing applied it.
 */
@Component({
  selector: 'app-landed-costs-page',
  standalone: true,
  imports: [FormsModule, TranslateModule, ...FORMAT_PIPES, ...VX_FORM_A11Y, ...VX_SELECT, ListShellComponent, HasPermissionDirective],
  templateUrl: './landed-costs.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandedCostsPage implements OnInit {
  private readonly purchasing = inject(PurchasingService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly accounts = inject(ChartOfAccountsApiService);

  readonly loading = signal(true);
  readonly error = signal(false);
  readonly types = signal<LandedCostType[]>([]);
  readonly applied = signal<LandedCostApplication[]>([]);
  readonly receipts = signal<GoodsReceiptRow[]>([]);
  readonly methods: LandedCostMethod[] = ['VALUE', 'QUANTITY', 'WEIGHT', 'VOLUME'];

  readonly typeDraft = signal<{ name: string; allocationMethod: LandedCostMethod; glAccountId: string | null }>({
    name: '',
    allocationMethod: 'VALUE',
    glAccountId: null,
  });
  readonly draft = signal<{ landedCostId: string; receiptIds: string[]; amount: number | null; reference: string }>({
    landedCostId: '',
    receiptIds: [],
    amount: null,
    reference: '',
  });
  readonly canApply = computed(() => {
    const d = this.draft();
    return Boolean(d.landedCostId) && d.receiptIds.length > 0 && (d.amount ?? 0) > 0;
  });

  protected readonly searchAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accounts.searchAccounts(query, limit).pipe(map((list) => (list ?? []).filter((account) => account.isPostable)));
  protected readonly resolveAccount = (id: string): Observable<Account> => this.accounts.getAccountById(id);
  protected readonly accountLabel = (account: Account): string => `${account.code} — ${accountNameOf(account.name)}`;
  protected readonly accountId = (account: Account): string => account.id;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    forkJoin({
      types: this.purchasing.landedCostTypes(),
      applied: this.purchasing.landedCosts(),
      receipts: this.purchasing.receipts({ status: 'POSTED', limit: 50 }),
    }).subscribe({
      next: ({ types, applied, receipts }) => {
        this.types.set(types);
        this.applied.set(applied);
        this.receipts.set(receipts.items);
        this.error.set(false);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  /** What went into the value of the stock still on hand (the rest is cost of sales). */
  absorbedOf(row: LandedCostApplication): number {
    return Math.round(row.lines.reduce((sum, line) => sum + Number(line.absorbed), 0) * 100) / 100;
  }

  typeName(id: string): string {
    return this.types().find((type) => type.id === id)?.name ?? '—';
  }

  patchType(patch: Partial<{ name: string; allocationMethod: LandedCostMethod; glAccountId: string | null }>): void {
    this.typeDraft.update((draft) => ({ ...draft, ...patch }));
  }

  createType(): void {
    const draft = this.typeDraft();
    if (!draft.name.trim() || !draft.glAccountId) {
      this.notifications.showError('purchasing.landed_costs.type_incomplete');
      return;
    }
    this.purchasing.createLandedCostType({ name: draft.name.trim(), allocationMethod: draft.allocationMethod, glAccountId: draft.glAccountId }).subscribe({
      next: () => {
        this.typeDraft.set({ name: '', allocationMethod: 'VALUE', glAccountId: null });
        this.load();
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'purchasing.landed_costs.not_saved'),
    });
  }

  patch(patch: Partial<{ landedCostId: string; amount: number | null; reference: string }>): void {
    this.draft.update((draft) => ({ ...draft, ...patch }));
  }

  toggleReceipt(id: string, checked: boolean): void {
    this.draft.update((draft) => ({
      ...draft,
      receiptIds: checked ? [...new Set([...draft.receiptIds, id])] : draft.receiptIds.filter((r) => r !== id),
    }));
  }

  apply(): void {
    const draft = this.draft();
    if (!this.canApply()) return;
    this.purchasing
      .applyLandedCost({ landedCostId: draft.landedCostId, receiptIds: draft.receiptIds, amount: Number(draft.amount), reference: draft.reference.trim() || undefined })
      .subscribe({
        next: () => {
          this.notifications.showSuccess('purchasing.landed_costs.applied');
          this.draft.set({ landedCostId: '', receiptIds: [], amount: null, reference: '' });
          this.load();
        },
        error: (error: unknown) => this.notifications.showHttpError(error, 'purchasing.landed_costs.not_saved'),
      });
  }

  async voidApplication(id: string): Promise<void> {
    const reason = await this.dialog.prompt({
      title: 'purchasing.landed_costs.void_title',
      message: 'purchasing.landed_costs.void_message',
      placeholder: 'purchasing.landed_costs.void_placeholder',
      minLength: 5,
      tooShort: 'purchasing.landed_costs.void_too_short',
      variant: 'danger',
    });
    if (!reason) return;
    this.purchasing.voidLandedCost(id, reason.trim()).subscribe({
      next: () => this.load(),
      error: (error: unknown) => this.notifications.showHttpError(error, 'purchasing.landed_costs.not_saved'),
    });
  }
}
