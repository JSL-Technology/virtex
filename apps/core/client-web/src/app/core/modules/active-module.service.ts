import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { MenuGroup, ModuleManifest } from './module-manifest';
import { MODULES, buildMenu, ownerOf, resolveRoute, railModules } from './module-registry';
import { GROUP_LABEL } from './menu-labels';
import { moduleIcon } from './module-icons';
import { AuthService } from '../services/auth';

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
  private readonly url = signal(this.router.url);

  /** The module that owns the current URL, or the workspace module as the resting place. */
  readonly active = computed<ModuleManifest | null>(() => {
    const match = resolveRoute(this.url());
    // A satellite resolves to its owner: `/masters/warehouses` is an Inventory screen that happens
    // to live under another prefix, and the panel beside it must be Inventory's.
    if (match) return ownerOf(match.entry.module);
    return MODULES.find((m) => m.id === 'workspace') ?? null;
  });

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
          .map((entry) => ({
            path: entry.path,
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

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((event) => this.url.set(event.urlAfterRedirects));
  }

  isActive(module: ModuleManifest): boolean {
    return this.active()?.id === module.id;
  }

  /** Where clicking a module goes: the first entry of its first group that this seat may open. */
  entryPointOf(module: ModuleManifest): string | null {
    return this.visibleMenu(module)[0]?.entries[0]?.path ?? null;
  }
}
