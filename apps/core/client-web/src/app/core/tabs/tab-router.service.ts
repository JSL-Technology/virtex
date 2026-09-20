import { Injectable, effect, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { TabStateService } from './tab-state.service';
import {
  ActiveOrganizationService,
  ORGANIZATION_SEGMENT,
  pathWithoutOrganization,
} from '../tenancy/active-organization.service';

/**
 * Puente bidireccional Router ↔ Workspace (TAB_ARCHITECTURE §1, §2).
 *  - Navegar por URL (link/F5) abre o enfoca la pestaña correspondiente.
 *  - Activar una pestaña actualiza la URL a su ruta.
 *
 * Solo se sincronizan rutas del shell autenticado. Las rutas públicas
 * (`/:lang/auth/*`, `/payment/*`), los fragmentos de settings y la raíz se
 * ignoran para no crear pestañas espurias.
 */
@Injectable({ providedIn: 'root' })
export class TabRouterService {
  private router = inject(Router);
  private tabState = inject(TabStateService);
  private tenancy = inject(ActiveOrganizationService);

  /** Evita el bucle Router→Tab→Router. */
  private suppressOpen = false;

  constructor() {
    // Router → Tabs
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((event) => {
        const url = event.urlAfterRedirects;
        if (this.suppressOpen) {
          this.suppressOpen = false;
          return;
        }
        if (!this.isWorkspaceUrl(url)) return;

        const { path, query } = this.parseUrl(url);
        this.tabState.openTab({ route: path, queryParams: query, preview: this.readIntent() });
      });

    // Tabs → Router
    effect(() => {
      const active = this.tabState.activeTab();
      if (!active) return;

      const target = this.buildUrl(active.route, active.queryParams);
      const current = this.stripFragment(this.router.url);
      if (this.sameDestination(target, current)) return;

      /**
       * Fuera del área de trabajo, el sistema de pestañas no manda.
       *
       * Este efecto sincroniza la URL con la ventana activa, y lo hacía desde CUALQUIER URL: al
       * denegarse una ruta, `permissionsGuard` llevaba a `/unauthorized?url=…` —correctamente— y
       * este efecto veía que la pestaña activa seguía siendo «Inicio», así que navegaba acto
       * seguido a `/overview`. La página que existe para explicar el rechazo no llegaba a verse
       * nunca, y quien abría un enlace que no le corresponde aterrizaba en el escritorio sin una
       * palabra. Lo mismo le habría pasado a cualquier página de nivel superior.
       */
      if (!this.isWorkspaceUrl(current)) return;

      this.suppressOpen = true;
      this.router
        .navigateByUrl(target)
        .catch(() => { /* navegación cancelada por guard */ })
        .finally(() => {
          // Si la navegación no produjo NavigationEnd, libera la bandera.
          this.suppressOpen = false;
        });
    });
  }

  navigateToTab(route: string): void {
    this.tabState.openTab({ route });
  }

  /**
   * La ruta de workspace con la que arrancó esta carga de página, o null si no la hay
   * (raíz, login, pago).
   *
   * La restauración del espacio de trabajo la necesita: reemplaza la lista de pestañas por la
   * guardada, y eso borra la pestaña que este puente acababa de abrir para la URL del navegador.
   * El resultado era que cualquier recarga —F5, un marcador, un enlace compartido— aterrizaba en
   * la pestaña que estuviera activa al guardar, no en la página que pedía la barra de direcciones.
   */
  bootRoute(): { path: string; query: Record<string, string> } | null {
    const url = this.router.url;
    return this.isWorkspaceUrl(url) ? this.parseUrl(url) : null;
  }

  /**
   * Comparación entre la URL del router y la ruta de una pestaña.
   *
   * La pestaña guarda `/invoices` y el router está en `/e/nortex/invoices`: comparadas en crudo
   * nunca coinciden, y el efecto Pestañas→Router navegaría en bucle a la URL en la que ya está.
   */
  private sameDestination(target: string, current: string): boolean {
    return pathWithoutOrganization(target) === pathWithoutOrganization(current);
  }

  // ── helpers ────────────────────────────────────────────────────────────

  /**
   * Traduce la intención de apertura guardada en `history.state` a la bandera `preview` de
   * `openTab`:
   *  - `'preview'`   → vista previa reutilizable (hojear).
   *  - `'permanent'` → pestaña fija.
   *  - ausente/otro  → `undefined`, y decide el WorkspaceStore según la preferencia y el tipo.
   *
   * Es un punto de extensión vivo: cualquier navegación puede fijar el comportamiento con
   * `router.navigate([...], { state: { tabIntent: 'permanent' } })`. Se lee de `history.state` y no
   * de `getCurrentNavigation`, que ya es `null` cuando llega `NavigationEnd`.
   */
  private readIntent(): boolean | undefined {
    const intent =
      typeof history !== 'undefined'
        ? (history.state as { tabIntent?: unknown } | null)?.tabIntent
        : undefined;
    if (intent === 'preview') return true;
    if (intent === 'permanent') return false;
    return undefined;
  }

  private isWorkspaceUrl(url: string): boolean {
    const path = url.split('?')[0];
    const fragment = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';

    // El modal de settings no genera pestaña.
    if (fragment.startsWith('settings')) return false;

    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return false; // raíz / redirector

    const first = segments[0];
    // Rutas públicas / fuera del workspace.
    if (['auth', 'payment', 'unauthorized'].includes(first)) return false;
    if (/^[a-z]{2}$/i.test(first)) return false; // prefijo de idioma
    //  `/e/{empresa}` sí es workspace, pero `/e` a secas —una redirección a medias— no tiene
    //  página que abrir.
    if (first === ORGANIZATION_SEGMENT && segments.length < 3) return false;

    return true;
  }

  /**
   * La ruta de la pestaña, sin la empresa.
   *
   * Una pestaña es «la lista de facturas», no «la lista de facturas de Nortex»: la empresa la pone
   * la VENTANA. Guardarla dentro de la pestaña haría que restaurar un espacio de trabajo
   * arrastrara la empresa en la que se guardó, y abrir dos ventanas en dos empresas acabaría con
   * las pestañas de una apuntando a los libros de la otra.
   */
  private parseUrl(url: string): { path: string; query: Record<string, string> } {
    const [path, queryString] = pathWithoutOrganization(url.split('#')[0]).split('?');
    const query: Record<string, string> = {};
    if (queryString) {
      for (const [k, v] of new URLSearchParams(queryString)) query[k] = v;
    }
    return { path, query };
  }

  /** Al revés: la empresa de esta ventana se vuelve a poner al navegar. */
  private buildUrl(route: string, query?: Record<string, string>): string {
    const base = this.tenancy.urlFor(this.stripFragment(route));
    if (!query || Object.keys(query).length === 0) return base;
    const qs = new URLSearchParams(query).toString();
    return `${base}?${qs}`;
  }

  private stripFragment(url: string): string {
    return url.split('#')[0];
  }
}
