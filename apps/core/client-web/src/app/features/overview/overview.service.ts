import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, delay } from 'rxjs/operators';
import {
  Receipt,
  FilePlus,
  FileText,
  UserPlus,
  Package,
  FileBarChart,
  BarChart3,
  TrendingUp,
  Megaphone,
  Sparkles,
  Calendar,
  CreditCard,
  Users,
} from 'lucide-angular';

import { AuthService } from '../../core/services/auth';

/**
 * Capa de datos de la pestaña «Overview» (página de inicio del workspace).
 *
 * Diseño: cada sección se expone como un Observable tipado con *fallback*
 * elegante (`catchError → []`), de modo que la UI siempre puede pintar estados
 * loading / ready / empty / error sin romperse. Hoy las secciones de actividad,
 * noticias y eventos devuelven datos de ejemplo; migrar a endpoints reales solo
 * requiere sustituir el cuerpo de cada método por la llamada HTTP correspondiente
 * (la firma y los tipos no cambian, así la UI permanece intacta).
 */
@Injectable({ providedIn: 'root' })
export class OverviewService {
  private auth = inject(AuthService);

  /** Latencia simulada para que los estados de carga sean realistas (solo mock). */
  private static readonly MOCK_LATENCY_MS = 450;

  // ── Accesos rápidos ────────────────────────────────────────────────────────
  // Configuración declarativa. Se filtra por permisos en `getQuickActions()`, que
  // es la fuente de verdad de la UI. El backend sigue siendo la autoridad real.
  private readonly quickActions: QuickAction[] = [
    { id: 'new-invoice',  labelKey: 'OVERVIEW.QUICK.NEW_INVOICE',  icon: FilePlus,  route: '/invoices/new',  permissions: ['invoices:view'], accent: 'primary' },
    { id: 'new-quote',    labelKey: 'OVERVIEW.QUICK.NEW_QUOTE',    icon: FileText,  route: '/quotes/new',    permissions: ['sales:view'],    accent: 'purple'  },
    { id: 'new-customer', labelKey: 'OVERVIEW.QUICK.NEW_CUSTOMER', icon: UserPlus,  route: '/customers/new', permissions: ['contacts:view'], accent: 'green'   },
    { id: 'new-product',  labelKey: 'OVERVIEW.QUICK.NEW_PRODUCT',  icon: Package,   route: '/products/new',  permissions: ['inventory:view'],accent: 'orange'  },
    { id: 'invoices',     labelKey: 'OVERVIEW.QUICK.INVOICES',     icon: Receipt,   route: '/invoices',      permissions: ['invoices:view'], accent: 'blue'    },
    { id: 'reports',      labelKey: 'OVERVIEW.QUICK.REPORTS',      icon: FileBarChart, route: '/reports',    permissions: ['reports:view'],  accent: 'primary' },
  ];

  /** Accesos rápidos visibles para el usuario actual (espejo de RBAC). */
  getQuickActions(): QuickAction[] {
    return this.quickActions.filter(
      (a) => !a.permissions?.length || this.auth.hasPermissions(a.permissions)
    );
  }

  // ── Actividad reciente ─────────────────────────────────────────────────────
  /** TODO(backend): GET /overview/recent-activity. */
  getRecentActivity(): Observable<ActivityItem[]> {
    const now = Date.now();
    const minutes = (m: number) => new Date(now - m * 60_000).toISOString();

    const data: ActivityItem[] = [
      { id: 'a1', kind: 'invoice', icon: Receipt,     title: 'Factura #00128 emitida a Proyectos Globales S.A.', meta: 'RD$ 45,800.00', route: '/invoices', timestamp: minutes(8) },
      { id: 'a2', kind: 'payment', icon: CreditCard,  title: 'Pago recibido de Distribuidora del Este',          meta: 'RD$ 12,300.00', route: '/customer-receipts', timestamp: minutes(52) },
      { id: 'a3', kind: 'report',  icon: BarChart3,   title: 'Reporte «Ventas por vendedor» generado',           route: '/reports', timestamp: minutes(140) },
      { id: 'a4', kind: 'product', icon: Package,     title: 'Producto «Silla Ergonómica Pro» añadido al inventario', route: '/inventory', timestamp: minutes(320) },
      { id: 'a5', kind: 'contact', icon: Users,       title: 'Nuevo cliente «Ferretería La Económica» registrado', route: '/contacts', timestamp: minutes(1180) },
      { id: 'a6', kind: 'invoice', icon: Receipt,     title: 'Factura #00125 marcada como pagada',                meta: 'RD$ 8,900.00', route: '/invoices', timestamp: minutes(1620) },
    ];

    return of(data).pipe(
      delay(OverviewService.MOCK_LATENCY_MS),
      catchError(() => of([] as ActivityItem[]))
    );
  }

  // ── Noticias de Virtex ─────────────────────────────────────────────────────
  /** TODO(backend): GET /overview/news. */
  getNews(): Observable<NewsItem[]> {
    const now = Date.now();
    const days = (d: number) => new Date(now - d * 86_400_000).toISOString();

    const data: NewsItem[] = [
      { id: 'n1', icon: Sparkles,  tag: 'Novedad',       title: 'Nueva página de inicio Overview', summary: 'Accede más rápido a tus tareas frecuentes, actividad reciente y novedades de Virtex.', date: days(0) },
      { id: 'n2', icon: TrendingUp, tag: 'Mejora',       title: 'Reportes financieros más veloces', summary: 'Optimizamos el motor de reportes: hasta un 40% más rápido en cuentas por cobrar.', date: days(3) },
      { id: 'n3', icon: Megaphone, tag: 'Anuncio',       title: 'Facturación electrónica DGII e-CF', summary: 'Soporte ampliado para comprobantes fiscales electrónicos. Revisa la configuración fiscal.', date: days(9) },
    ];

    return of(data).pipe(
      delay(OverviewService.MOCK_LATENCY_MS),
      catchError(() => of([] as NewsItem[]))
    );
  }

  // ── Eventos ────────────────────────────────────────────────────────────────
  /** TODO(backend): GET /overview/events. */
  getEvents(): Observable<EventItem[]> {
    const now = Date.now();
    const days = (d: number) => new Date(now + d * 86_400_000).toISOString();

    const data: EventItem[] = [
      { id: 'e1', icon: Calendar, title: 'Cierre contable mensual', date: days(2),  type: 'Recordatorio' },
      { id: 'e2', icon: Calendar, title: 'Webinar: Novedades de Virtex Q3', date: days(6), location: 'En línea', type: 'Evento' },
      { id: 'e3', icon: Calendar, title: 'Vencimiento declaración IT-1', date: days(11), type: 'Fiscal' },
    ];

    return of(data).pipe(
      delay(OverviewService.MOCK_LATENCY_MS),
      catchError(() => of([] as EventItem[]))
    );
  }
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

export type ActivityKind = 'invoice' | 'report' | 'product' | 'contact' | 'payment' | 'sale';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  icon: unknown;
  title: string;
  /** Texto secundario opcional (importe, estado…). */
  meta?: string;
  /** Ruta a la que navegar al hacer clic. */
  route?: string;
  /** ISO 8601. */
  timestamp: string;
}

export interface NewsItem {
  id: string;
  icon: unknown;
  title: string;
  summary: string;
  tag?: string;
  /** ISO 8601. */
  date: string;
  /** Enlace externo opcional. */
  url?: string;
}

export interface EventItem {
  id: string;
  icon: unknown;
  title: string;
  /** ISO 8601. */
  date: string;
  location?: string;
  type?: string;
}
