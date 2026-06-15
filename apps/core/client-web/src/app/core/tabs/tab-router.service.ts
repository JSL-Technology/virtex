import { Injectable, effect, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { TabStateService } from './tab-state.service';

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
        this.tabState.openTab({ route: path, queryParams: query });
      });

    // Tabs → Router
    effect(() => {
      const active = this.tabState.activeTab();
      if (!active) return;

      const target = this.buildUrl(active.route, active.queryParams);
      const current = this.stripFragment(this.router.url);
      if (target === current) return;

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

  // ── helpers ────────────────────────────────────────────────────────────

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

    return true;
  }

  private parseUrl(url: string): { path: string; query: Record<string, string> } {
    const [path, queryString] = url.split('#')[0].split('?');
    const query: Record<string, string> = {};
    if (queryString) {
      for (const [k, v] of new URLSearchParams(queryString)) query[k] = v;
    }
    return { path, query };
  }

  private buildUrl(route: string, query?: Record<string, string>): string {
    const base = this.stripFragment(route);
    if (!query || Object.keys(query).length === 0) return base;
    const qs = new URLSearchParams(query).toString();
    return `${base}?${qs}`;
  }

  private stripFragment(url: string): string {
    return url.split('#')[0];
  }
}
