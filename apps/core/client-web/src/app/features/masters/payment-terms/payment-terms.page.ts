import { Component, ChangeDetectionStrategy, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule, Clock } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';

import { ListShellComponent } from '../../../shared/components/gestures';
import { CustomersService } from '../../../core/api/customers.service';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';

interface PaymentTermInUse {
  name: string;
  days: number | null;
  customerCount: number;
}

/**
 * The payment terms the tenant's customers are actually on.
 *
 * ## What this replaces
 *
 * Four invented terms — Net 15, Net 30, Due on receipt, "50% Upfront, 50% on Delivery" — held in a
 * signal, fetched from nothing, behind a "New term" button wired to nothing. There is no
 * `payment_terms` table and no endpoint, so the screen was inventing a catalogue the product does
 * not keep, and the last row described an arrangement the data model cannot even express: a term is
 * a name and a number of days.
 *
 * What the product does keep is the term on each customer — `paymentTerms` and `paymentTermDays`,
 * which is what dates an invoice. So this shows the terms in use and how many customers are on
 * each, which is the question this screen was pretending to answer, and points at where a term is
 * actually set rather than offering to create one nothing would read.
 */
@Component({
  selector: 'app-payment-terms-page',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule, ListShellComponent],
  templateUrl: './payment-terms.page.html',
  styleUrls: ['./payment-terms.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentTermsPage implements OnInit {
  protected readonly ClockIcon = Clock;

  private readonly customers = inject(CustomersService);
  private readonly errors = inject(ErrorHandlerService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private readonly rows = signal<{ paymentTerms?: string | null; paymentTermDays?: number | null }[]>([]);

  readonly terms = computed<PaymentTermInUse[]>(() => {
    const byName = new Map<string, PaymentTermInUse>();
    for (const row of this.rows()) {
      const name = (row.paymentTerms ?? '').trim();
      const days = row.paymentTermDays ?? null;
      if (!name && days === null) continue;
      const key = `${name}|${days ?? ''}`;
      const existing = byName.get(key);
      if (existing) {
        existing.customerCount += 1;
        continue;
      }
      byName.set(key, { name, days, customerCount: 1 });
    }
    return [...byName.values()].sort(
      (a, b) => (a.days ?? 0) - (b.days ?? 0) || a.name.localeCompare(b.name),
    );
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.customers.getCustomers().subscribe({
      next: (list) => {
        this.rows.set(list ?? []);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.errors.keyFor(err));
        this.loading.set(false);
      },
    });
  }
}
