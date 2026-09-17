import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThan, Repository } from 'typeorm';
import { AuditLog, ActionType } from '../audit/entities/audit-log.entity';
import { User } from '../users/entities/user.entity/user.entity';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import { VendorBill, VendorBillStatus } from '../accounts-payable/entities/vendor-bill.entity';
import {
  AccountingPeriod,
  PeriodStatus,
} from '../accounting/entities/accounting-period.entity';
import { hasPermission } from '@virteex/shared/util-auth';
import { PERMISSIONS } from '../shared/permissions';
import {
  ActivityItemDto,
  NewsItemDto,
  OverviewEventDto,
} from './dto/overview.dto';

/**
 * Which document each audited table is, what permission it takes to see it, and where in the
 * payload its own identifiers live.
 *
 * Only business documents appear here. Provisioning writes far more audit rows than anything a
 * person does — a new tenant alone produces a hundred `accounting_periods` and fifty
 * `document_sequences` — and a feed led by those says nothing about the business. Anything not in
 * this table is not activity as far as this page is concerned.
 */
const ACTIVITY_SOURCES: Record<
  string,
  {
    permission: string;
    reference: string[];
    counterparty?: string[];
    amount?: string[];
    currency?: string[];
  }
> = {
  invoices: {
    permission: PERMISSIONS.INVOICES_VIEW,
    reference: ['invoiceNumber', 'fiscalNumber'],
    counterparty: ['customerName'],
    amount: ['total'],
    currency: ['currencyCode'],
  },
  customer_payments: {
    permission: PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW,
    reference: ['receiptNumber'],
    amount: ['totalAmount'],
    currency: ['currencyCode'],
  },
  vendor_bills: {
    permission: PERMISSIONS.ACCOUNTS_PAYABLE_VIEW,
    reference: ['ncf', 'billNumber'],
    counterparty: ['supplierName', 'vendorName'],
    amount: ['total'],
    currency: ['currencyCode'],
  },
  vendor_payment: {
    permission: PERMISSIONS.ACCOUNTS_PAYABLE_VIEW,
    reference: ['paymentNumber', 'reference'],
    amount: ['totalAmount', 'amount'],
    currency: ['currencyCode'],
  },
  journal_entries: {
    permission: PERMISSIONS.JOURNAL_ENTRIES_VIEW,
    reference: ['entryNumber'],
    counterparty: ['description'],
  },
  customers: {
    permission: PERMISSIONS.CUSTOMERS_VIEW,
    reference: ['companyName', 'name'],
  },
  suppliers: {
    permission: PERMISSIONS.SUPPLIERS_VIEW,
    reference: ['companyName', 'name'],
  },
  products: {
    permission: PERMISSIONS.PRODUCTS_VIEW,
    reference: ['name', 'sku'],
  },
  quotes: {
    permission: PERMISSIONS.CRM_VIEW,
    reference: ['quoteNumber', 'number'],
    counterparty: ['customerName'],
    amount: ['total'],
    currency: ['currencyCode'],
  },
};

/** Looking at something is not activity, and neither is signing in. */
const ACTIVITY_ACTIONS = [ActionType.CREATE, ActionType.UPDATE, ActionType.DELETE];

/**
 * What the workspace's home page shows, taken from what the tenant's own data says.
 *
 * ## What this replaces
 *
 * The page had no server behind it at all. Its client service carried six invented invoices and
 * payments — "Factura #00128 emitida a Proyectos Globales S.A., RD$ 45,800.00" — three invented
 * product announcements and three invented calendar entries, each returned through a simulated
 * 450 ms delay so the loading states looked convincing. A new tenant who had issued nothing saw a
 * month of trading that never happened, in Spanish, whatever language they had chosen. Data a
 * person cannot tell from real data, and cannot act on, is worse than an empty state: it teaches
 * them not to trust the screen.
 *
 * Everything here comes from a table: activity from the audit trail, obligations from the
 * documents that carry a due date and the periods that are still open. Product news has no source
 * inside the product, so it is served from a feed the operator configures — and when none is
 * configured the section is empty rather than invented.
 */
@Injectable()
export class OverviewService {
  private readonly logger = new Logger(OverviewService.name);

  constructor(
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(VendorBill) private readonly bills: Repository<VendorBill>,
    @InjectRepository(AccountingPeriod)
    private readonly periods: Repository<AccountingPeriod>,
    private readonly config: ConfigService,
  ) {}

  /**
   * What has happened here lately, filtered to what this seat may see.
   *
   * The permission filter is per document type, not per page: a salesperson who may read invoices
   * but not the ledger sees the invoices and not the entries they posted. Showing the row and
   * hiding the amount would still disclose that the document exists, which for a payroll journal
   * is most of the secret.
   */
  async activity(
    organizationId: string,
    permissions: string[],
    limit = 10,
  ): Promise<ActivityItemDto[]> {
    // Through the shared matcher, not `includes`: a role granted `invoices:*` — or the wildcard an
    // administrator carries — satisfies `invoices:view`, and a plain membership test silently
    // showed an administrator an empty page.
    const allowed = Object.keys(ACTIVITY_SOURCES).filter((entity) =>
      hasPermission(permissions, [ACTIVITY_SOURCES[entity].permission]),
    );
    if (allowed.length === 0) return [];

    const rows = await this.auditLogs.find({
      where: {
        organizationId,
        entity: In(allowed),
        actionType: In(ACTIVITY_ACTIONS),
      },
      order: { timestamp: 'DESC' },
      take: limit,
    });
    if (rows.length === 0) return [];

    const actorNames = await this.actorNames(rows);

    return rows.map((row) => {
      const source = ACTIVITY_SOURCES[row.entity];
      const payload = (row.newValue ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        entity: row.entity,
        entityId: row.entityId,
        action: row.actionType,
        reference: pickString(payload, source.reference),
        counterparty: pickString(payload, source.counterparty ?? []),
        amount: pickNumber(payload, source.amount ?? []),
        currencyCode: pickString(payload, source.currency ?? []),
        actorName: row.userId ? actorNames.get(row.userId) ?? null : null,
        timestamp: row.timestamp.toISOString(),
      };
    });
  }

  /**
   * What falls due next, from the documents themselves.
   *
   * Receivables and payables that are open and dated, and accounting periods that end inside the
   * window and are still open. No fiscal calendar: filing dates are law, they differ per market and
   * per taxpayer regime, and a deadline this product invented would be worse than one it omits —
   * a tenant who files late because a screen showed the wrong day has been harmed by the software.
   */
  async events(
    organizationId: string,
    permissions: string[],
    days = 30,
    limit = 10,
  ): Promise<OverviewEventDto[]> {
    const today = startOfDay(new Date());
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + days);

    const events: OverviewEventDto[] = [];

    // The same permission the invoice list takes, not the collections one: "this invoice falls due"
    // is the invoice's own due date, and gating it more tightly than the list it came from would
    // hide from a salesperson what they can already read a click away.
    if (hasPermission(permissions, [PERMISSIONS.INVOICES_VIEW])) {
      const open = await this.invoices.find({
        where: {
          organizationId,
          status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID]),
          dueDate: Between(isoDate(addDays(today, -365)), isoDate(horizon)) as never,
        },
        order: { dueDate: 'ASC' },
        take: limit,
      });
      for (const invoice of open) {
        events.push({
          id: `invoice:${invoice.id}`,
          kind: isoDate(invoice.dueDate) < isoDate(today) ? 'RECEIVABLE_OVERDUE' : 'RECEIVABLE_DUE',
          date: isoDate(invoice.dueDate),
          reference: invoice.invoiceNumber ?? null,
          counterparty: invoice.customerName ?? null,
          amount: Number(invoice.balance),
          currencyCode: invoice.currencyCode ?? null,
          route: '/invoices',
        });
      }
    }

    if (hasPermission(permissions, [PERMISSIONS.ACCOUNTS_PAYABLE_VIEW])) {
      const open = await this.bills.find({
        where: {
          organizationId,
          status: In([VendorBillStatus.OPEN, VendorBillStatus.PARTIALLY_PAID]),
          dueDate: Between(isoDate(addDays(today, -365)), isoDate(horizon)) as never,
        },
        order: { dueDate: 'ASC' },
        take: limit,
      });
      for (const bill of open) {
        events.push({
          id: `bill:${bill.id}`,
          kind: isoDate(bill.dueDate) < isoDate(today) ? 'PAYABLE_OVERDUE' : 'PAYABLE_DUE',
          date: isoDate(bill.dueDate),
          reference: bill.ncf ?? null,
          counterparty: null,
          amount: Number(bill.balance),
          currencyCode: null,
          route: '/accounts-payable',
        });
      }
    }

    if (hasPermission(permissions, [PERMISSIONS.ACCOUNTING_VIEW])) {
      const closing = await this.periods.find({
        where: {
          organizationId,
          status: PeriodStatus.OPEN,
          endDate: Between(isoDate(addDays(today, -31)), isoDate(horizon)) as never,
        },
        order: { endDate: 'ASC' },
        take: limit,
      });
      for (const period of closing) {
        events.push({
          id: `period:${period.id}`,
          kind: 'PERIOD_CLOSE',
          date: isoDate(period.endDate),
          reference: period.name,
          counterparty: null,
          amount: null,
          currencyCode: null,
          route: '/accounting/periods',
        });
      }
    }

    return events.sort((a, b) => a.date.localeCompare(b.date)).slice(0, limit);
  }

  /**
   * Product news, from a feed the operator configures.
   *
   * There is no news inside an ERP, so there is nothing here to derive. `OVERVIEW_NEWS_URL` names
   * a JSON document of `{ id, title, summary, tag?, date, url? }`; with none set the section is
   * empty and the page hides it. An unreachable or malformed feed is also empty — a home page does
   * not fail because a marketing endpoint is down.
   */
  async news(): Promise<NewsItemDto[]> {
    const url = this.config.get<string>('OVERVIEW_NEWS_URL');
    if (!url) return [];

    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) return [];
      const body: unknown = await response.json();
      if (!Array.isArray(body)) return [];

      return body
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .map((item, index) => ({
          id: String(item['id'] ?? index),
          title: String(item['title'] ?? ''),
          summary: String(item['summary'] ?? ''),
          tag: item['tag'] != null ? String(item['tag']) : null,
          date: String(item['date'] ?? new Date().toISOString()),
          url: item['url'] != null ? String(item['url']) : null,
        }))
        .filter((item) => item.title.length > 0);
    } catch (error) {
      this.logger.warn(`No se pudo leer el feed de novedades (${url}): ${(error as Error).message}`);
      return [];
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** One query for every actor in the batch, rather than one per row. */
  private async actorNames(rows: AuditLog[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((row) => row.userId).filter((id): id is string => !!id))];
    if (ids.length === 0) return new Map();

    const people = await this.users.find({
      where: { id: In(ids) },
      select: ['id', 'firstName', 'lastName'],
    });
    return new Map(
      people.map((person) => [
        person.id,
        `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim(),
      ]),
    );
  }
}

function pickString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

function pickNumber(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    const parsed = typeof value === 'string' ? Number(value) : value;
    if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** `date` columns come back as strings or Dates depending on the driver's mood; normalise both. */
function isoDate(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}
