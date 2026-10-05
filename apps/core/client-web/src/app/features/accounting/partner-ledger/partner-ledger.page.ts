import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Observable, map } from 'rxjs';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VX_SELECT } from '../../../shared/components/select';
import { NotificationService } from '../../../core/services/notification';
import { CustomersService } from '../../contacts/data/customers.service';
import { SuppliersService } from '../../contacts/data/suppliers.service';
import { Customer } from '../../../core/models/customer.model';
import { Supplier } from '../../../core/models/supplier.model';
import { PartnerKind, PartnerStatement, StatementsService, documentRoute } from '../data/statements.service';

const pad = (n: number) => String(n).padStart(2, '0');
const todayIso = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

interface Partner {
  id: string;
  name: string;
}

/**
 * Partner ledger (audit H-17): one customer's or supplier's documents, in order, with the balance
 * after each — Odoo's *Partner Ledger*, SAP FBL5N/FBL1N, a customer statement in NetSuite.
 *
 * It replaces «Libros auxiliares», a page with no endpoint that rendered an empty state from the
 * menu. The general ledger's lines do not carry the partner, so the statement is built from the
 * subledger documents themselves: invoices and credit notes, receipts; bills, payments and debit
 * notes — each void appearing on the day its reversal was booked.
 */
@Component({
  selector: 'app-partner-ledger-page',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, ...FORMAT_PIPES, ...VX_SELECT, ListShellComponent],
  templateUrl: './partner-ledger.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss', './partner-ledger.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartnerLedgerPage implements OnInit {
  private readonly statements = inject(StatementsService);
  private readonly customers = inject(CustomersService);
  private readonly suppliers = inject(SuppliersService);
  private readonly notifications = inject(NotificationService);

  /** `?type=customer|supplier&partnerId=` — from a customer's or supplier's own page. */
  readonly type = input<PartnerKind>();
  readonly partnerId = input<string>();

  readonly kind = signal<PartnerKind>('customer');
  readonly partner = signal<string | null>(null);
  readonly from = signal(`${new Date().getFullYear()}-01-01`);
  readonly to = signal(todayIso());
  readonly currency = signal<string | null>(null);
  readonly statement = signal<PartnerStatement | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly movements = computed(() => this.statement()?.movements ?? []);
  readonly empty = computed(() => !this.loading() && !this.error() && !!this.statement() && this.movements().length === 0);
  protected readonly route = documentRoute;

  protected readonly searchPartners = (query: string, limit: number): Observable<Partner[]> => {
    const rows: Observable<Array<Customer | Supplier>> =
      this.kind() === 'customer' ? this.customers.searchCustomers(query, limit) : this.suppliers.searchSuppliers(query, limit);
    return rows.pipe(map((list) => (list ?? []).map(toPartner)));
  };
  protected readonly resolvePartner = (id: string): Observable<Partner> => {
    const row: Observable<Customer | Supplier> =
      this.kind() === 'customer' ? this.customers.getCustomerById(id) : this.suppliers.getSupplierById(id);
    return row.pipe(map(toPartner));
  };
  protected readonly partnerName = (partner: Partner): string => partner.name;
  protected readonly partnerValue = (partner: Partner): string => partner.id;

  ngOnInit(): void {
    if (this.type()) this.kind.set(this.type() as PartnerKind);
    if (this.partnerId()) {
      this.partner.set(this.partnerId() as string);
      this.load();
    }
  }

  setKind(kind: PartnerKind): void {
    this.kind.set(kind);
    this.partner.set(null);
    this.currency.set(null);
    this.statement.set(null);
  }

  setPartner(id: string | null): void {
    this.partner.set(id);
    this.currency.set(null);
    this.load();
  }

  load(): void {
    const partnerId = this.partner();
    if (!partnerId) {
      this.statement.set(null);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.statements.statement(this.kind(), partnerId, { from: this.from(), to: this.to(), currency: this.currency() }).subscribe({
      next: (statement) => {
        this.statement.set(statement);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'partner_ledger.load_failed'));
        this.loading.set(false);
      },
    });
  }
}

function toPartner(row: Customer | Supplier): Partner {
  return { id: row.id as string, name: 'companyName' in row ? row.companyName : (row as Supplier).name };
}
