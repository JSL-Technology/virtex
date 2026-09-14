import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  Receipt,
  FilePlus,
  FileText,
  UserPlus,
  Package,
  FileBarChart,
  BookOpen,
  CalendarCheck,
  AlertTriangle,
  Truck,
  Banknote,
  CreditCard,
  Users,
} from 'lucide-angular';

import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth';
import { FormatService } from '@virteex/shared/ui-i18n';

/**
 * The workspace home page's data.
 *
 * ## What this was
 *
 * Three methods that returned invented data through a simulated 450 ms delay so the loading states
 * would look convincing: six invoices and payments ("Factura #00128 emitida a Proyectos Globales
 * S.A. — RD$ 45,800.00"), three product announcements and three calendar entries, every one of
 * them a Spanish string compiled into the bundle. A tenant who had issued nothing saw a month of
 * trading that never happened, in a language they may not have chosen, and could click through to
 * documents that did not exist. Data a reader cannot tell from real data is worse than an empty
 * state: it teaches them not to trust the screen.
 *
 * Everything now comes from `/overview`, which reads the tenant's own tables. The server returns
 * *facts* — which table, which action, which document number — and the sentence is composed here,
 * in the reader's language, because a sentence built on the server is a sentence in one language.
 */
@Injectable({ providedIn: 'root' })
export class OverviewService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly format = inject(FormatService);
  private readonly apiUrl = `${environment.apiUrl}/overview`;

  // ── Accesos rápidos ────────────────────────────────────────────────────────
  // Configuración declarativa. Se filtra por permisos en `getQuickActions()`, que
  // es la fuente de verdad de la UI. El backend sigue siendo la autoridad real.
  private readonly quickActions: QuickAction[] = [
    { id: 'new-invoice',  labelKey: 'overview.quick.new_invoice',  icon: FilePlus,  route: '/invoices/new',  permissions: ['invoices:view'], accent: 'primary' },
    { id: 'new-quote',    labelKey: 'overview.quick.new_quote',    icon: FileText,  route: '/quotes/new',    permissions: ['sales:view'],    accent: 'purple'  },
    { id: 'new-customer', labelKey: 'overview.quick.new_customer', icon: UserPlus,  route: '/customers/new', permissions: ['contacts:view'], accent: 'green'   },
    { id: 'new-product',  labelKey: 'overview.quick.new_product',  icon: Package,   route: '/products/new',  permissions: ['inventory:view'],accent: 'orange'  },
    { id: 'invoices',     labelKey: 'overview.quick.invoices',     icon: Receipt,   route: '/invoices',      permissions: ['invoices:view'], accent: 'blue'    },
    { id: 'reports',      labelKey: 'overview.quick.reports',      icon: FileBarChart, route: '/reports',    permissions: ['reports:view'],  accent: 'primary' },
  ];

  /** Accesos rápidos visibles para el usuario actual (espejo de RBAC). */
  getQuickActions(): QuickAction[] {
    return this.quickActions.filter(
      (a) => !a.permissions?.length || this.auth.hasPermissions(a.permissions)
    );
  }

  // ── Actividad reciente ─────────────────────────────────────────────────────

  /**
   * What has actually happened in this tenant, from the audit trail, filtered server-side to the
   * document types this seat may read.
   */
  getRecentActivity(limit = 8): Observable<ActivityItem[]> {
    return this.http
      .get<ActivityDto[]>(`${this.apiUrl}/activity`, {
        params: new HttpParams().set('limit', limit),
      })
      .pipe(map((rows) => rows.map((row) => toActivityItem(row))));
  }

  // ── Vencimientos y cierres ─────────────────────────────────────────────────

  /** What falls due next, from the documents that carry a date — not from a calendar we invented. */
  getEvents(days = 30, limit = 8): Observable<EventItem[]> {
    return this.http
      .get<EventDto[]>(`${this.apiUrl}/events`, {
        params: new HttpParams().set('days', days).set('limit', limit),
      })
      .pipe(map((rows) => rows.map((row) => toEventItem(row, this.format))));
  }

  // ── Novedades del producto ─────────────────────────────────────────────────

  /**
   * Product news, from whatever feed the operator configured. Empty when none is — which is what
   * the page shows rather than three announcements nobody published.
   */
  getNews(): Observable<NewsItem[]> {
    return this.http.get<NewsItem[]>(`${this.apiUrl}/news`);
  }
}

// ── Traducción de los hechos del servidor a lo que la página pinta ────────────

/** Which icon and which sentence belong to each audited table. */
const ENTITY_VIEW: Record<string, { kind: ActivityKind; icon: unknown; key: string; route: string }> = {
  invoices:          { kind: 'invoice', icon: Receipt,    key: 'INVOICES',          route: '/invoices' },
  customer_payments: { kind: 'payment', icon: CreditCard, key: 'CUSTOMER_PAYMENTS', route: '/customer-receipts' },
  vendor_bills:      { kind: 'bill',    icon: Truck,      key: 'VENDOR_BILLS',      route: '/accounts-payable' },
  vendor_payments:   { kind: 'payment', icon: Banknote,   key: 'VENDOR_PAYMENTS',   route: '/accounts-payable/payments' },
  journal_entries:   { kind: 'entry',   icon: BookOpen,   key: 'JOURNAL_ENTRIES',   route: '/accounting/journal-entries' },
  customers:         { kind: 'contact', icon: Users,      key: 'CUSTOMERS',         route: '/contacts' },
  suppliers:         { kind: 'contact', icon: Users,      key: 'SUPPLIERS',         route: '/contacts/suppliers' },
  products:          { kind: 'product', icon: Package,    key: 'PRODUCTS',          route: '/inventory' },
};

const EVENT_VIEW: Record<string, { icon: unknown; overdue: boolean }> = {
  RECEIVABLE_DUE:      { icon: Receipt,       overdue: false },
  RECEIVABLE_OVERDUE:  { icon: AlertTriangle, overdue: true  },
  PAYABLE_DUE:         { icon: Truck,         overdue: false },
  PAYABLE_OVERDUE:     { icon: AlertTriangle, overdue: true  },
  PERIOD_CLOSE:        { icon: CalendarCheck, overdue: false },
};

function toActivityItem(row: ActivityDto): ActivityItem {
  const view = ENTITY_VIEW[row.entity] ?? {
    kind: 'entry' as ActivityKind,
    icon: FileText,
    key: 'GENERIC',
    route: '',
  };
  return {
    id: row.id,
    kind: view.kind,
    icon: view.icon,
    // Composed by the template through `translate`, so the sentence is in the reader's language
    // rather than in whichever language the server happens to be written in.
    titleKey: `overview.activity.item.${view.key}.${row.action}`,
    reference: row.reference,
    counterparty: row.counterparty,
    amount: row.amount,
    currencyCode: row.currencyCode,
    actorName: row.actorName,
    route: view.route || undefined,
    timestamp: row.timestamp,
  };
}

function toEventItem(row: EventDto, format: FormatService): EventItem {
  const view = EVENT_VIEW[row.kind] ?? { icon: CalendarCheck, overdue: false };
  return {
    id: row.id,
    icon: view.icon,
    overdue: view.overdue,
    titleKey: `overview.events.item.${row.kind}`,
    typeKey: `overview.events.kind.${row.kind}`,
    /**
     * A period's reference is its month, and a month has a name in every language.
     *
     * For every other event the reference is a document number — `FACT-2026-000042` — which is the
     * same string for every reader. For a period the server sends the stored `name`, composed by
     * the tenant provisioner from a Spanish month list, so an English reader was told
     * `Period “Agosto 2026” closes`. The event already carries the date that name describes, so
     * the month is rendered from that instead and the stored string is not shown at all.
     */
    reference:
      row.kind === 'PERIOD_CLOSE'
        ? format.date(row.date, 'monthYear', { dateOnly: true })
        : row.reference,
    counterparty: row.counterparty,
    amount: row.amount,
    currencyCode: row.currencyCode,
    date: row.date,
    route: row.route,
  };
}

// ── Lo que el servidor envía ──────────────────────────────────────────────────

interface ActivityDto {
  id: string;
  entity: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'EXPORT';
  reference: string | null;
  counterparty: string | null;
  amount: number | null;
  currencyCode: string | null;
  actorName: string | null;
  timestamp: string;
}

interface EventDto {
  id: string;
  kind: string;
  date: string;
  reference: string | null;
  counterparty: string | null;
  amount: number | null;
  currencyCode: string | null;
  route: string;
}

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type QuickActionAccent = 'primary' | 'green' | 'orange' | 'purple' | 'blue';

export interface QuickAction {
  id: string;
  /** Clave i18n de la etiqueta. */
  labelKey: string;
  /** Icono Lucide (objeto de datos del icono). */
  icon: unknown;
  /** Ruta del workspace que abre/enfoca la pestaña correspondiente. */
  route: string;
  /** Permisos requeridos (espejo del permissionsGuard). */
  permissions?: string[];
  accent: QuickActionAccent;
}

export type ActivityKind = 'invoice' | 'bill' | 'entry' | 'product' | 'contact' | 'payment';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  icon: unknown;
  /** i18n key of the sentence; `reference` is its only parameter. */
  titleKey: string;
  reference: string | null;
  counterparty: string | null;
  amount: number | null;
  currencyCode: string | null;
  actorName: string | null;
  route?: string;
  /** ISO 8601. */
  timestamp: string;
}

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  tag: string | null;
  /** ISO 8601. */
  date: string;
  url: string | null;
}

export interface EventItem {
  id: string;
  icon: unknown;
  /** Past its date: worth showing differently from something merely upcoming. */
  overdue: boolean;
  titleKey: string;
  typeKey: string;
  reference: string | null;
  counterparty: string | null;
  amount: number | null;
  currencyCode: string | null;
  /** ISO date. */
  date: string;
  route: string;
}
