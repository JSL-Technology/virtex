import { Component, ChangeDetectionStrategy, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';

import { ListShellComponent } from '../../../shared/components/gestures';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { BankAccount, TreasuryService } from '../../../core/api/treasury.service';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';

interface Bank {
  name: string;
  swiftBic: string | null;
  accountCount: number;
  currencies: string[];
}

/**
 * The banks the tenant actually holds accounts with.
 *
 * ## What this replaces
 *
 * Four invented banks — Banco Popular Dominicano, Banreservas, Scotiabank, Bank of America, with
 * their real SWIFT codes, which is what made the fiction convincing — held in a signal, fetched
 * from nothing, with a "New bank" button wired to nothing. There is no `banks` table and no
 * endpoint: the screen was inventing a catalogue the product does not keep.
 *
 * What the product does keep is bank ACCOUNTS, each carrying the bank's name and BIC. So this
 * answers the question the screen was pretending to answer — which banks do we deal with — from the
 * accounts that actually exist, and sends adding one to Treasury, where a bank account is opened
 * against a ledger account. A bank with no account is not a fact this product has.
 */
@Component({
  selector: 'app-banks-page',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule, ListShellComponent, ...FORMAT_PIPES],
  templateUrl: './banks.page.html',
  styleUrls: ['./banks.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BanksPage implements OnInit {
  protected readonly PlusCircleIcon = PlusCircle;

  private readonly treasury = inject(TreasuryService);
  private readonly errors = inject(ErrorHandlerService);
  private readonly router = inject(Router);

  readonly accounts = signal<BankAccount[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  /** One row per bank, with what the tenant holds there. */
  readonly banks = computed<Bank[]>(() => {
    const byName = new Map<string, Bank>();
    for (const account of this.accounts()) {
      const name = (account.bankName ?? '').trim();
      if (!name) continue;
      const existing = byName.get(name);
      if (existing) {
        existing.accountCount += 1;
        existing.swiftBic ??= account.swiftBic;
        if (!existing.currencies.includes(account.currencyCode)) {
          existing.currencies.push(account.currencyCode);
        }
        continue;
      }
      byName.set(name, {
        name,
        swiftBic: account.swiftBic,
        accountCount: 1,
        currencies: [account.currencyCode],
      });
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.treasury.listBankAccounts().subscribe({
      next: (list) => {
        this.accounts.set(list ?? []);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.errors.keyFor(err));
        this.loading.set(false);
      },
    });
  }

  /** A bank enters the product by opening an account with it. */
  openTreasury(): void {
    void this.router.navigate(['/accounting/treasury/bank-accounts/new']);
  }
}
