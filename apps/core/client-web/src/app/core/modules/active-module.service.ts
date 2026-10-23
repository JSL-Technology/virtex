import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { MenuGroup, ModuleManifest } from './module-manifest';
import { MODULES, buildMenu, ownerOf, resolveRoute, railModules } from './module-registry';
import { GROUP_LABEL } from './menu-labels';
import { moduleIcon } from './module-icons';
import { AuthService } from '../services/auth';
import {
  ActiveOrganizationService,
  pathWithoutOrganization,
} from '../tenancy/active-organization.service';

/** One destination in a module's panel, ready to render. */
export interface PanelEntry {
  readonly path: string;
  readonly labelKey: string;
  readonly icon: unknown;
}

/** One of the four fixed groups, with the entries this seat may actually open. */
export interface PanelSection {
  readonly group: MenuGroup;
  readonly labelKey: string;
  readonly entries: PanelEntry[];
}

/** A menu destination anywhere in the product, with the module whose panel lists it. */
export interface Destination extends PanelEntry {
  /** The page as the workspace names it: no company prefix (`/accounting/journals`). */
  readonly route: string;
  readonly module: ModuleManifest;
}

/** A module as the navigation chrome needs it: can this seat enter it, and through which door. */
export interface ReachableModule {
  readonly module: ModuleManifest;
  readonly allowed: boolean;
  /** First entry the user may actually open. Null when none of them are permitted. */
  readonly target: string | null;
}

/**
 * Which module the workspace is currently in.
 *
 * ## Why it is derived from the URL and not stored
 *
 * A "current module" kept as its own state is a second copy of something the URL already says, and
 * the two drift the moment anything navigates without going through the setter — a deep link, the
 * back button, a tab being focused. Reading it from the address is the same discipline that made
 * the window a resolved route: one fact, one place.
 *
 * The module is found by resolving the URL against the manifests, so a route that exists always
 * knows which module owns it, and a URL that no module declares selects nothing rather than
 * guessing.
 */
@Injectable({ providedIn: 'root' })
export class ActiveModuleService {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly tenancy = inject(ActiveOrganizationService);
  private readonly url = signal(this.router.url);

  /**
   * La URL sin el prefijo de empresa, que es la forma en la que habla el manifiesto.
   *
   * El manifiesto declara `/accounting/journal-entries`; el navegador está en
   * `/e/nortex/accounting/journal-entries`. Resolver la URL cruda contra el manifiesto no casaría
   * con nada y todo módulo parecería ser «Mi trabajo». Quitar el prefijo aquí mantiene el
   * manifiesto libre de la empresa, que no es parte de la identidad de la página.
   */
  private readonly modulePath = computed(() => pathWithoutOrganization(this.url()));

  /**
   * The module the user was last in. Kept so a page that two panels both offer does not move them.
   *
   * Ventas › «Antigüedad de saldos» opens `/reports/aging/receivables`, a URL Contabilidad's report
   * panel also lists. Resolving the owner from the URL alone switched the rail to Contabilidad the
   * moment the page opened, so the user clicked a Sales entry and found themselves in another
   * module with a different menu (QA C-05). The URL still decides — this only breaks the tie when
   * the module you are already in lists the page too.
   */
  private readonly previous = signal<ModuleManifest | null>(null);

  /**
   * The module the user picked in the rail to look around in, while the window on screen still
   * belongs to another one. Null when the panel simply follows the window.
   *
   * ## Why switching modules no longer opens anything
   *
   * The rail used to navigate to the module's first screen, so every module the user glanced at
   * left a tab behind — and the screen it opened was the module's first entry, rarely the one they
   * wanted. Choosing a module is a question about what is inside it; the answer is its panel, and
   * the user decides from there what to open, or moves on to another module without having opened
   * anything (the Activity Bar of an editor works the same way).
   *
   * It is the one piece of module state that is stored rather than derived, and it is kept on a
   * short leash so it cannot drift from the URL: ANY navigation clears it — opening an entry,
   * focusing another tab, the back button — so the panel goes back to describing what is on screen
   * the moment the user acts.
   */
  private readonly browsed = signal<ModuleManifest | null>(null);

  /** The module that owns the window on screen (the URL), or the workspace module as resting place. */
  readonly current = computed<ModuleManifest | null>(() => {
    const path = this.modulePath().split('?')[0].split('#')[0];
    const previous = this.previous();
    if (previous && menuOffers(previous, path)) return previous;
    const match = resolveRoute(path);
    // A satellite resolves to its owner: `/masters/warehouses` is an Inventory screen that happens
    // to live under another prefix, and the panel beside it must be Inventory's.
    if (match) return ownerOf(match.entry.module);
    return MODULES.find((m) => m.id === 'workspace') ?? null;
  });

  /** The module whose panel is on screen: the one being browsed, else the window's own. */
  readonly active = computed<ModuleManifest | null>(() => this.browsed() ?? this.current());

  /** Is the panel showing a module other than the window's? (The panel then offers a way back.) */
  readonly isBrowsing = computed(() => {
    const browsed = this.browsed();
    return browsed !== null && browsed.id !== this.current()?.id;
  });

  /**
   * Show a module's panel without opening anything. Picking the window's own module is the way
   * back, so it simply stops browsing.
   */
  browse(module: ModuleManifest): void {
    this.browsed.set(module.id === this.current()?.id ? null : module);
  }

  /** Back to the panel of the window on screen. */
  stopBrowsing(): void {
    this.browsed.set(null);
  }

  /**
   * The panel for the active module: its four groups, in their fixed order, filtered to this seat.
   *
   * The filtering lives here and not in the components because two shells render it — the vertical
   * panel and the horizontal mega-menu — and a permission rule applied in two places is a rule that
   * will eventually be applied in one and a half. The backend remains the authority; this only
   * stops the UI offering a door the server would slam, which is the single thing that makes a user
   * distrust navigation altogether.
   */
  readonly panel = computed<PanelSection[]>(() => {
    const module = this.active();
    return module ? this.visibleMenu(module) : [];
  });

  /** The same panel, for any module — what the top bar's mega-menu shows before you enter it. */
  visibleMenu(module: ModuleManifest): PanelSection[] {
    return buildMenu(module)
      .map((section) => ({
        group: section.group,
        labelKey: GROUP_LABEL[section.group],
        entries: section.entries
          .filter(
            (entry) =>
              entry.permission === 'authenticated' || this.auth.hasPermissions([entry.permission]),
          )
          //  El prefijo de empresa se añade AQUÍ y en ningún otro sitio. Las plantillas reciben
          //  la URL terminada, así que ninguna puede olvidarse de la empresa —y la que se
          //  olvidara mandaría a alguien a los libros de otra sin que nada fallara—.
          .map((entry) => ({
            path: this.tenancy.urlFor(entry.path),
            labelKey: entry.labelKey,
            icon: moduleIcon(entry.icon),
          })),
      }))
      .filter((section) => section.entries.length > 0);
  }

  /**
   * The panel entry that owns the current URL: the longest declared entry path that prefixes it.
   *
   * `routerLinkActive` cannot answer this. Exact matching leaves nothing lit while a document is
   * open — you are plainly inside Facturas when reading invoice 128 — and prefix matching lights
   * two entries at once wherever one menu path contains another, which today is `/accounts-payable`
   * and `/accounts-payable/payments`. Longest-prefix gives exactly one answer in both cases, and it
   * is the same rule the route index already uses to decide which window a URL opens.
   */
  readonly activeEntry = computed<string | null>(() => {
    const path = this.url().split('?')[0].split('#')[0];
    return this.panel()
      .flatMap((section) => section.entries.map((entry) => entry.path))
      .filter((candidate) => path === candidate || path.startsWith(candidate + '/'))
      .sort((a, b) => b.length - a.length)[0] ?? null;
  });

  /** The page on screen as the workspace names it (`/invoices/88`): no company, no query. */
  readonly currentRoute = computed(() => normalizeRoute(this.url()));

  /** Modules shown in the rail. */
  readonly rail = computed(() => railModules());

  /**
   * The rail's modules with the two facts the chrome needs, computed once for every consumer.
   *
   * The rail and the horizontal top-bar variant both need it, and computing it twice is how two
   * navigations start disagreeing about which modules exist. A module is enterable when the user
   * may open at least one of its screens — asked of the entries, because there is no module-level
   * permission: permissions are declared per route, and a module you can only partly see is still
   * a module you can enter. Recomputed only when the permissions change.
   */
  readonly reachable = computed<ReachableModule[]>(() =>
    this.rail().map((module) => {
      const target = this.entryPointOf(module);
      return { module, allowed: target !== null, target };
    }),
  );

  /**
   * Every menu destination this seat may open, by workspace route.
   *
   * Favourites and the tab strip ask "is this a place in the menu, and may I open it?" about a
   * bare route; answering from the same filtered panels the menu renders is what guarantees a
   * favourite never offers a page the menu would not — after a role change, say. A page two
   * modules list belongs to the first module that lists it, in rail order.
   */
  readonly destinations = computed<ReadonlyMap<string, Destination>>(() => {
    const index = new Map<string, Destination>();
    for (const { module } of this.reachable()) {
      for (const section of this.visibleMenu(module)) {
        for (const entry of section.entries) {
          const route = normalizeRoute(entry.path);
          if (!index.has(route)) index.set(route, { ...entry, route, module });
        }
      }
    }
    return index;
  });

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((event) => {
        // `active`, not `current`: a page offered by both the module being browsed and another
        // one opens in the module the user chose it from (see `previous`).
        this.previous.set(this.active());
        this.browsed.set(null);
        this.url.set(event.urlAfterRedirects);
      });
  }

  isActive(module: ModuleManifest): boolean {
    return this.active()?.id === module.id;
  }

  /** Where clicking a module goes: the first entry of its first group that this seat may open. */
  entryPointOf(module: ModuleManifest): string | null {
    return this.visibleMenu(module)[0]?.entries[0]?.path ?? null;
  }
}

/** Does the module's own panel list this exact page (or a page beneath one of its entries)? */
function menuOffers(module: ModuleManifest, path: string): boolean {
  return buildMenu(module).some((section) =>
    section.entries.some((entry) => {
      const target = entry.path.startsWith('/') ? entry.path : `/${entry.path}`;
      return path === target;
    }),
  );
}

/** A route as the workspace names it: no company, no query or fragment, a single leading slash. */
export function normalizeRoute(path: string): string {
  const bare = pathWithoutOrganization(path).split('?')[0].split('#')[0];
  const trimmed = bare.replace(/\/+$/, '');
  return trimmed.startsWith('/') ? trimmed || '/' : `/${trimmed}`;
}
