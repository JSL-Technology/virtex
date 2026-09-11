import { Injectable, inject, Type } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { TabDefinition, TabType } from './tab.model';
import { GenericModulePage } from './components/generic-module.page';
import { AuthService } from '../services/auth';
import { resolveRoute, RegisteredRoute } from '../modules/module-registry';
import { WindowKind } from '../modules/module-manifest';

export interface ResolvedTab {
  definition: TabDefinition;
  params: Record<string, string>;
  /** True when no declared route owns the URL. */
  isFallback: boolean;
}

/**
 * Resolves a URL to the window that shows it.
 *
 * ## What changed, and why it mattered
 *
 * This service used to hold its own catalogue of tab definitions — 15 patterns — while the router
 * declared roughly ninety routes and the sidebar offered 50 links. Nothing kept the three in step,
 * so 40 of those links resolved to nothing and opened an "under construction" card on top of pages
 * that were built and wired to working endpoints. `TAB_ARCHITECTURE.md` §5.2 had already proposed
 * the fix — each feature declaring its windows beside its routes — and the code never adopted it.
 *
 * So the catalogue is gone. This service now *resolves* the module manifests, which are also what
 * generates the Angular route table. One declaration, two readers: a window that no URL can open
 * is no longer expressible, and neither is a URL with no window.
 *
 * The generic "under construction" page survives for exactly one case: a URL that matches no
 * declared route. That is a 404, and saying so is the honest answer — unlike before, when it was
 * the answer given to most of the product.
 */
@Injectable({ providedIn: 'root' })
export class TabRegistryService {
  private auth = inject(AuthService);
  private translate = inject(TranslateService);

  /** Best definition for the URL, or a generic placeholder when nothing declares it. */
  resolve(route: string): ResolvedTab {
    const match = resolveRoute(route);

    if (match) {
      return {
        definition: this.toDefinition(match.entry),
        params: match.params,
        isFallback: false,
      };
    }

    return {
      definition: this.buildGenericDefinition(this.normalize(route)),
      params: {},
      isFallback: true,
    };
  }

  /** Compat: only the definition (falls back to the generic placeholder). */
  getDefinitionByRoute(route: string): TabDefinition {
    return this.resolve(route).definition;
  }

  /** May the user open this window? UX only; the backend stays the authority. */
  canOpen(definition: TabDefinition): boolean {
    if (!definition.permissions?.length) return true;
    return this.auth.hasPermissions(definition.permissions);
  }

  getRouteParams(pattern: string, route: string): Record<string, string> {
    const patternParts = this.segments(pattern);
    const routeParts = this.segments(this.normalize(route));
    const params: Record<string, string> = {};
    patternParts.forEach((part, i) => {
      if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(routeParts[i] ?? '');
    });
    return params;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /**
   * A manifest route, expressed as the tab model Dockview already consumes.
   *
   * The mapping is mechanical on purpose: the window's kind, permission, title and identity all
   * come from the single declaration, so there is nothing here for a second list to contradict.
   */
  private toDefinition(entry: RegisteredRoute): TabDefinition {
    const { route, module, path } = entry;

    const isCloseable = route.isCloseable ?? true;

    return {
      pattern: path,
      // A window the user cannot close IS the pinned one — the workspace home. Deriving it from
      // `isCloseable` keeps a single fact in a single place instead of asking a manifest to state
      // both "cannot be closed" and "is of type PINNED" and stay consistent about it.
      tabType: isCloseable ? TAB_TYPE_BY_KIND[route.kind] : TabType.PINNED,
      title: route.titleKey ?? module.titleKey,
      icon: route.icon ?? module.icon,
      isCloseable,
      // `authenticated` means "any signed-in user"; it is not a grantable permission, so it must
      // not be handed to hasPermissions() — which would deny it for everyone.
      permissions: route.permission === 'authenticated' ? [] : [route.permission],
      entityKeyFn: route.entityKeyFn ?? (() => `module:${path}`),
      titleFn: route.titleFn,
      load: route.load as () => Promise<Type<unknown>>,
    };
  }

  private buildGenericDefinition(routePath: string): TabDefinition {
    return {
      pattern: routePath,
      tabType: TabType.MODULE_LIST,
      title: this.prettify(routePath),
      icon: 'LayoutGrid',
      isCloseable: true,
      entityKeyFn: () => `module:${routePath}`,
      load: () => Promise.resolve(GenericModulePage as unknown as Type<unknown>),
    };
  }

  private segments(path: string): string[] {
    return path.split('/').filter((p) => p.length > 0);
  }

  private normalize(route: string): string {
    const path = route.split('?')[0].split('#')[0];
    return '/' + this.segments(path).join('/');
  }

  private prettify(routePath: string): string {
    const last = this.segments(routePath).pop();
    if (!last) return this.translate.instant('TABS.GENERIC_MODULE');
    return last.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

/**
 * How each gesture presents itself as a tab.
 *
 * `Record<WindowKind, TabType>` and not a partial map: adding `CANVAS` to the gestures stopped the
 * build here until somebody decided what a canvas looks like as a tab. That is the whole point of
 * the type — the alternative is a new kind that silently falls through to a default.
 */
const TAB_TYPE_BY_KIND: Record<WindowKind, TabType> = {
  [WindowKind.LIST]: TabType.MODULE_LIST,
  [WindowKind.DOCUMENT]: TabType.RECORD,
  [WindowKind.DRAFT]: TabType.WIZARD,
  [WindowKind.INBOX]: TabType.UTILITY,
  [WindowKind.OVERVIEW]: TabType.REPORT,
  //  Una hoja de cálculo o un terminal de venta se abandonan y se retoman como un asistente: hay
  //  trabajo a medias dentro, así que la pestaña tiene que decirlo igual que lo dice un borrador.
  [WindowKind.CANVAS]: TabType.WIZARD,
};
