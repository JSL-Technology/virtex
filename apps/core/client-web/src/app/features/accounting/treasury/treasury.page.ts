import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Calendar, Landmark, RefreshCw } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import {
  BankAccount,
  BankTransfer,
  CashPosition,
  TreasuryService,
} from '../../../core/api/treasury.service';
import { toIsoDate } from '../../reports/financial-statements/report-period';

/**
 * The cash position, and the movements between the tenant's own accounts.
 *
 * Neither existed. Treasury had one endpoint — a transfer between two chart-of-accounts ids — and
 * no page at all, so there was no way to see how much the company had, in which account, in which
 * currency. The nearest thing was the balance sheet, which grouped every current asset together
 * and was itself made of invented figures.
 *
 * Account numbers arrive masked from the server. They are not unmasked here, and the page has no
 * way to obtain the full number: it is needed to reconcile a statement, not to look at.
 */
@Component({
  selector: 'app-treasury-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './treasury.page.html',
  styleUrls: ['./treasury.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreasuryPage {
  private readonly api = inject(TreasuryService);

  protected readonly CalendarIcon = Calendar;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly BankIcon = Landmark;

  readonly asOfDate = signal(toIsoDate(new Date()));
  readonly position = signal<CashPosition | null>(null);
  readonly accounts = signal<BankAccount[]>([]);
  readonly transfers = signal<BankTransfer[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);

  /**
   * Whether any two bank accounts post to the same control account.
   *
   * When they do, the total counts that account's balance once rather than once per bank account
   * pointing at it — which is right, and surprising enough that the page says so instead of
   * leaving the reader to wonder why the rows do not add up to the total.
   */
  readonly hasSharedControlAccount = computed(() => {
    const rows = this.position()?.accounts ?? [];
    return new Set(rows.map((row) => row.glAccountId)).size !== rows.length;
  });

  readonly accountsById = computed(
    () => new Map(this.accounts().map((account) => [account.id, account])),
  );

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.failed.set(false);

    this.api.cashPosition(this.asOfDate()).subscribe({
      next: (position) => {
        this.position.set(position);
        this.loading.set(false);
      },
      error: () => {
        this.position.set(null);
        this.failed.set(true);
        this.loading.set(false);
      },
    });
    this.api.listBankAccounts().subscribe({
      next: (accounts) => this.accounts.set(accounts),
      error: () => this.failed.set(true),
    });
    this.api.listTransfers().subscribe({
      next: (transfers) => this.transfers.set(transfers),
      error: () => this.failed.set(true),
    });
  }

  onDateChange(value: string): void {
    if (!value) return;
    this.asOfDate.set(value);
    this.load();
  }

  accountName(bankAccountId: string): string {
    return this.accountsById().get(bankAccountId)?.name ?? bankAccountId.slice(0, 8);
  }

  accountCurrency(bankAccountId: string): string {
    return this.accountsById().get(bankAccountId)?.currencyCode ?? '';
  }
}
