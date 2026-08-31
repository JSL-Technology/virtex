import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  LucideAngularModule,
  ArrowRight,
  FilePlus,
  LayoutDashboard,
  Megaphone,
  CalendarDays,
  Activity as ActivityIcon,
  RefreshCw,
} from 'lucide-angular';

import { AuthService } from '../../core/services/auth';
import { TabStateService } from '../../core/tabs/tab-state.service';
import { TabAware } from '../../core/tabs/tab.model';
import { FormatService } from '../../core/i18n/format.service';
import {
  OverviewService,
  ActivityItem,
  NewsItem,
  EventItem,
} from './overview.service';
import { FORMAT_PIPES } from '../../core/i18n/pipes/format.pipes';

type SectionStatus = 'loading' | 'ready' | 'error';

/**
 * Página de inicio del workspace («Overview»). Es la pestaña fija por defecto
 * (estilo «Welcome» de VS Code): saludo personalizado, accesos rápidos,
 * actividad reciente y novedades/eventos de Virtex.
 *
 * Implementa {@link TabAware}: como Dockview no destruye el DOM de las pestañas
 * inactivas, refrescamos los datos al reactivar la pestaña (§7.1).
 */
@Component({
  selector: 'app-overview-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './overview.page.html',
  styleUrls: ['./overview.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewPage implements OnInit, TabAware {
  private overview = inject(OverviewService);
  private auth = inject(AuthService);
  private tabState = inject(TabStateService);
  private translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  // Iconos expuestos a la plantilla.
  protected readonly ArrowRightIcon = ArrowRight;
  protected readonly NewInvoiceIcon = FilePlus;
  protected readonly DashboardIcon = LayoutDashboard;
  protected readonly NewsIcon = Megaphone;
  protected readonly EventsIcon = CalendarDays;
  protected readonly ActivityIcon = ActivityIcon;
  protected readonly RefreshIcon = RefreshCw;

  readonly today = new Date();

  /** Usuario actual (para el saludo). */
  readonly user = this.auth.currentUser;
  readonly firstName = computed(() => this.user()?.firstName?.trim() || '');

  /** Clave i18n del saludo según la hora del día. */
  readonly greetingKey = computed(() => {
    const h = new Date().getHours();
    if (h < 12) return 'OVERVIEW.GREETING.MORNING';
    if (h < 19) return 'OVERVIEW.GREETING.AFTERNOON';
    return 'OVERVIEW.GREETING.EVENING';
  });

  /** Accesos rápidos visibles (reactivo a permisos del usuario). */
  readonly quickActions = computed(() => this.overview.getQuickActions());

  // Estado por sección (loading / ready / error) + datos.
  readonly activity = signal<ActivityItem[]>([]);
  readonly activityStatus = signal<SectionStatus>('loading');

  readonly news = signal<NewsItem[]>([]);
  readonly newsStatus = signal<SectionStatus>('loading');

  readonly events = signal<EventItem[]>([]);
  readonly eventsStatus = signal<SectionStatus>('loading');

  /** Esqueletos de carga (placeholders) reutilizables en la plantilla. */
  readonly skeletons = [0, 1, 2, 3];

  ngOnInit(): void {
    this.loadAll();
  }

  /** TabAware: refresca datos al reactivar la pestaña (puede estar «stale»). */
  onTabActivated(): void {
    this.loadAll();
  }

  /** Recarga manual (botón «actualizar»). */
  refresh(): void {
    this.loadAll();
  }

  private loadAll(): void {
    this.loadActivity();
    this.loadNews();
    this.loadEvents();
  }

  private loadActivity(): void {
    this.activityStatus.set('loading');
    this.overview.getRecentActivity().subscribe({
      next: (items) => {
        this.activity.set(items);
        this.activityStatus.set('ready');
      },
      error: () => this.activityStatus.set('error'),
    });
  }

  private loadNews(): void {
    this.newsStatus.set('loading');
    this.overview.getNews().subscribe({
      next: (items) => {
        this.news.set(items);
        this.newsStatus.set('ready');
      },
      error: () => this.newsStatus.set('error'),
    });
  }

  private loadEvents(): void {
    this.eventsStatus.set('loading');
    this.overview.getEvents().subscribe({
      next: (items) => {
        this.events.set(items);
        this.eventsStatus.set('ready');
      },
      error: () => this.eventsStatus.set('error'),
    });
  }

  // ── Acciones de navegación (abren/enfocan pestañas) ────────────────────────

  open(route: string | undefined): void {
    if (!route) return;
    this.tabState.openTab({ route });
  }

  openDashboard(): void {
    this.open('/dashboard');
  }

  openNewInvoice(): void {
    this.open('/invoices/new');
  }

  // ── Formato de fechas/tiempos ──────────────────────────────────────────────
  //
  // Delegado en `FormatService`: la pagina construia sus propios `Intl` con
  // `translate.currentLang`, que es el IDIOMA y no la region — de modo que un
  // lector en Buenos Aires y otro en Santo Domingo, ambos en espanol, veian el
  // mismo formato aunque no comparten separadores ni orden de fecha. El
  // servicio ademas usa la zona horaria del inquilino, no la del navegador.

  /** Tiempo relativo legible (p. ej. «hace 5 minutos»). */
  relativeTime(iso: string): string {
    return this.format.relativeTime(iso);
  }

  /** Fecha corta para eventos/noticias (p. ej. «15 jun»). */
  shortDate(iso: string): string {
    return this.format.date(iso, 'dayMonth');
  }
}
