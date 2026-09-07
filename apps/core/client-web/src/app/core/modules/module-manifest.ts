import { Type } from '@angular/core';

/**
 * A module declares itself once.
 *
 * ## The problem this replaces
 *
 * A feature used to be declared in five hand-maintained places: its routes in `app.routes.ts`, its
 * windows in `tab-definitions.ts`, its menu entries in `sidebar-menu.ts`, its permission in each
 * route's `data.permissions`, and — for settings — a sixth copy in the modal's `SECTION_MAP`.
 * Nothing connected them, so they drifted, and the drift was not cosmetic: the window catalogue
 * knew 15 patterns while the menu offered 50 links, so 40 of those links opened an "under
 * construction" card over pages that were built and wired to working endpoints.
 *
 * `TAB_ARCHITECTURE.md` §5.2 already proposed the fix — each feature declaring its windows next to
 * its routes — and the code never adopted it. That is the lesson this file is built on: a rule
 * that has to be remembered is a rule that decays. So the manifest is not a convention. It is the
 * only place a route can be written, and everything else is derived from it:
 *
 *  - the Angular route table          (`buildRoutes`)
 *  - the window registry              (`resolveWindow`)
 *  - the module panel and its menu    (`buildMenu`)
 *  - the permission each window needs (`ModuleRoute.permission`, required by the type)
 *
 * A menu entry with no page stops being expressible, because the menu is generated from the
 * routes. A route with no permission stops compiling, because the field is not optional.
 */

/**
 * The five gestures.
 *
 * Every interaction in the ERP is one of these, and each has one canonical treatment in the shared
 * layer. The point is not taxonomy for its own sake: it is that a user who learns how a list
 * behaves in Sales has learned how it behaves in Purchasing, and a developer arriving in a year
 * cannot invent a sixth way to show a list because there is nowhere to put it.
 */
export enum WindowKind {
  /** Find a set of records: saved views, configurable columns, virtualised rows. */
  LIST = 'LIST',
  /** Read one record: header, body, side panel with comments and history. */
  DOCUMENT = 'DOCUMENT',
  /** Change a draft: inline editing, validation under the field. */
  DRAFT = 'DRAFT',
  /** A module's inbox: what needs attention here, ordered by what blocks. */
  INBOX = 'INBOX',
  /** Cross-module aggregate, dashboard or report. */
  OVERVIEW = 'OVERVIEW',
}

/** Where a route appears in the module panel. The order of the groups is fixed across modules. */
export type MenuGroup = 'inbox' | 'documents' | 'masters' | 'analysis';

export interface ModuleRoute {
  /**
   * Path relative to the module's `basePath`, without a leading slash.
   * `':id'` segments are matched as parameters and handed to the window as inputs.
   */
  path: string;

  kind: WindowKind;

  /**
   * The permission required to open this window.
   *
   * Not optional, and that is the entire point. Ninety-eight backend handlers reached production
   * without one — not because anyone judged them open, but because an optional field is a field
   * that gets skipped. The backend remains the authority; this mirrors it so the UI does not offer
   * a door the server will slam.
   */
  permission: string;

  /** Lazily loaded component. The same loader serves the router and the window host. */
  load: () => Promise<Type<unknown>>;

  /** Translation key for the static title. */
  titleKey?: string;

  /** Title computed from route params and loaded data, e.g. `Factura #00128`. */
  titleFn?: (params: Record<string, string>, data?: unknown) => string;

  /** Lucide icon name. Falls back to the module's icon. */
  icon?: string;

  /**
   * Identity of the thing this window shows, so opening the same record twice focuses the window
   * that already has it instead of stacking duplicates.
   */
  entityKeyFn?: (params: Record<string, string>, query?: Record<string, string>) => string;

  /** Present when this route is a destination in the module panel. Absent for detail/edit routes. */
  menu?: { group: MenuGroup; labelKey: string };

  /** Static data handed to the component, e.g. `{ side: 'payables' }`. */
  data?: Record<string, unknown>;

  /** A window the user cannot close, such as the workspace home. */
  isCloseable?: boolean;
}

export interface ModuleManifest {
  /** Stable identifier. Used for the permission namespace and for workspace persistence. */
  id: string;

  titleKey: string;

  /** Lucide icon name shown in the module rail. */
  icon: string;

  /**
   * URL prefix owned by this module, without a leading slash. Empty for the cross-module shell
   * routes (home, notifications, search) that belong to no single domain.
   */
  basePath: string;

  /**
   * Order in the module rail. Explicit rather than alphabetical: the rail follows the shape of the
   * business — what you sell, what you buy, what you hold, what you owe — not the dictionary.
   */
  order: number;

  routes: ModuleRoute[];

  /** Hidden from the rail while the module has no page worth opening. Its routes still resolve. */
  hidden?: boolean;

  /**
   * Id of the module whose panel these routes belong to.
   *
   * A module owns a URL prefix, but ownership of a *screen* does not follow the URL. Warehouses and
   * units of measure live under `/masters/*` for historical reasons and belong to Inventory; banks
   * and payment terms live there too and belong to Treasury. Splitting them into a second manifest
   * was how they got an accurate `basePath` — and then `hidden` took them out of the rail without
   * putting them anywhere else, so six screens were reachable from no menu at all.
   *
   * A satellite therefore names its owner instead of hiding: it stays out of the rail, its entries
   * appear in the owner's panel, and a URL of its own resolves to the owner so the panel on screen
   * is the one the address belongs to. `hidden` now means only what it says — a module with nothing
   * worth opening yet.
   */
  panelOf?: string;
}

/** Full path of a route, as the router and the address bar see it. */
export function fullPath(module: ModuleManifest, route: ModuleRoute): string {
  const segments = [module.basePath, route.path].filter((s) => s.length > 0);
  return '/' + segments.join('/');
}
