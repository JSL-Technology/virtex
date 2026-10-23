import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CdkContextMenuTrigger, CdkMenu, CdkMenuItem } from '@angular/cdk/menu';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import {
  LucideAngularModule,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  Columns2,
  CornerDownLeft,
  ExternalLink,
  Layers,
  Link,
  Pin,
  Star,
} from 'lucide-angular';

import {
  ActiveModuleService,
  Destination,
  PanelEntry,
  normalizeRoute,
} from '../../core/modules/active-module.service';
import { FavoritesService } from '../../core/navigation/favorites.service';
import { NavigationActionsService, OpenMode } from '../../core/navigation/navigation-actions.service';

/** What the entry menu needs to know about the entry it was opened on. */
interface EntryMenuContext {
  readonly path: string;
  /** Set when the menu was opened on a row of the Favourites section, which can be reordered. */
  readonly favoriteIndex: number | null;
}

/** Where the Favourites section remembers being folded. Per browser: it is a viewing preference. */
const FAVORITES_COLLAPSED_KEY = 'virtex.nav.favorites.collapsed';

/**
 * The module panel: what there is to do inside the module you are in.
 *
 * ## Why it no longer lists the whole product
 *
 * It used to render every module's entries flattened into one scrolling column — around fifty
 * links under ten headings — so finding anything meant holding the entire ERP in your head. The
 * rail now answers "which part of the business", and this panel answers "what inside it", which is
 * a short question. Nothing was removed: every destination is still two clicks away.
 *
 * ## Why the four groups are fixed and always in the same order
 *
 * Bandeja · Documentos · Maestros · Análisis appear in that order in every module, and a module
 * with nothing in a group omits the heading rather than reordering the rest. That fixed shape is
 * what makes the second module cost nothing to learn: whatever the module, what needs your
 * attention is at the top and the reference data is where it was next door.
 *
 * ## Choosing a module opens nothing
 *
 * The rail only changes which module this panel shows (`ActiveModuleService.browse`). While the
 * panel shows a module other than the window's, it says so and offers the way back — the user may
 * be three modules away from the window they are working in, and the rail's quieter mark alone is
 * easy to miss.
 *
 * ## The gestures on an entry
 *
 * The ones people already know from an editor's file tree, so none needs explaining:
 *
 *  - click — open it in the reusable preview tab;
 *  - double click — open it and keep it open;
 *  - Ctrl/⌘-click or middle click — a new browser tab, because the entry is a real link;
 *  - right click, the context-menu key or Shift+F10 — every other way of opening it, favourites
 *    and the link (`@angular/cdk/menu` provides the keyboard model: arrows, Home/End, typeahead,
 *    Escape returns focus to the entry);
 *  - the star — add or remove it from Favourites in one click.
 *
 * The component holds no navigation logic of its own: what to show is `ActiveModuleService`, how to
 * open is `NavigationActionsService`, favourites are `FavoritesService` — each shared with the other
 * surfaces that need it (the top bar, the tab strip), so two renderings cannot disagree.
 */
@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterModule, TranslateModule, LucideAngularModule, CdkContextMenuTrigger, CdkMenu, CdkMenuItem],
  templateUrl: './sidebar.html',
  styleUrls: ['./sidebar.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sidebar {
  private readonly modules = inject(ActiveModuleService);
  protected readonly favorites = inject(FavoritesService);
  private readonly navigation = inject(NavigationActionsService);

  protected readonly icons = {
    ArrowDown, ArrowLeft, ArrowUp, ChevronDown, Columns2, CornerDownLeft, ExternalLink, Layers, Link, Pin, Star,
  };

  /** The module whose panel is on screen. Derived from the URL, never stored. */
  protected readonly module = this.modules.active;

  /** The module of the window on screen, named by the way back while another one is browsed. */
  protected readonly currentModule = this.modules.current;
  protected readonly isBrowsing = this.modules.isBrowsing;

  /** Its four groups, in fixed order, holding only what this seat may open. */
  protected readonly sections = this.modules.panel;

  /** Longest declared entry path that prefixes the URL — exactly one entry is lit. */
  protected readonly activeEntry = this.modules.activeEntry;

  protected readonly favoriteItems = this.favorites.items;

  /** The routes starred, for the star on each entry (a Set: looked up once per rendered entry). */
  protected readonly favoriteRoutes = computed(
    () => new Set(this.favoriteItems().map((item) => item.route)),
  );

  protected readonly favoritesCollapsed = signal(readCollapsed());

  /**
   * The favourite that owns the page on screen — longest-prefix, like the panel's own active entry.
   * Asked of the URL and not of `activeEntry`, which only knows the entries of the module the panel
   * shows: a favourite from another module would never light up.
   */
  protected readonly activeFavorite = computed<string | null>(() => {
    const current = this.modules.currentRoute();
    return (
      this.favoriteItems()
        .map((item) => item.route)
        .filter((route) => current === route || current.startsWith(route + '/'))
        .sort((a, b) => b.length - a.length)[0] ?? null
    );
  });

  protected routeOf(entry: PanelEntry): string {
    return normalizeRoute(entry.path);
  }

  protected isFavorite(entry: PanelEntry): boolean {
    return this.favoriteRoutes().has(this.routeOf(entry));
  }

  /** The module a favourite lives in, shown beside it when it is not the module on screen. */
  protected favoriteModuleHint(item: Destination): string | null {
    return item.module.id === this.module()?.id ? null : item.module.titleKey;
  }

  // ── gestos ──────────────────────────────────────────────────────────────

  /** Double click: keep it open. The click that preceded it already opened it as the preview. */
  protected keepOpen(path: string, event: MouseEvent): void {
    event.preventDefault();
    this.navigation.open(path, 'permanent');
  }

  protected toggleFavorite(path: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.favorites.toggle(path);
  }

  protected backToCurrent(): void {
    this.modules.stopBrowsing();
  }

  /** Escape while browsing another module goes back to the window's own — the way back, by key. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.isBrowsing() && !event.defaultPrevented) {
      this.modules.stopBrowsing();
    }
  }

  protected toggleFavoritesSection(): void {
    const next = !this.favoritesCollapsed();
    this.favoritesCollapsed.set(next);
    try {
      localStorage.setItem(FAVORITES_COLLAPSED_KEY, String(next));
    } catch {
      /* a viewing preference: losing it costs nothing */
    }
  }

  // ── menú contextual ─────────────────────────────────────────────────────

  /** The entry the open menu belongs to, so focus can go back to it. */
  private menuOrigin: HTMLElement | null = null;

  protected menuOpenedFrom(origin: HTMLElement): void {
    this.menuOrigin = origin;
  }

  /**
   * Give focus back to the entry the menu was opened on.
   *
   * The CDK's context menu, unlike its dropdown menu, does not restore focus when it closes: with
   * Escape, or after choosing an action from the keyboard, focus fell to `<body>` and the next Tab
   * started again from the top of the page — the keyboard user lost their place in the menu. It is
   * restored only when focus was left nowhere: a click that closed the menu by landing somewhere
   * else keeps the focus it gave that place.
   */
  protected menuClosed(): void {
    const origin = this.menuOrigin;
    this.menuOrigin = null;
    // After the CDK has finished detaching the overlay, which is when focus is actually lost.
    setTimeout(() => {
      const active = document.activeElement;
      if (origin?.isConnected && (!active || active === document.body)) {
        origin.focus({ preventScroll: true });
      }
    });
  }

  protected menuContext(path: string, favoriteIndex: number | null = null): EntryMenuContext {
    return { path, favoriteIndex };
  }

  protected open(context: EntryMenuContext, mode: OpenMode): void {
    this.navigation.open(context.path, mode);
  }

  protected copyLink(context: EntryMenuContext): void {
    this.navigation.copyLink(context.path);
  }

  protected isFavoritePath(path: string): boolean {
    return this.favorites.isFavorite(path);
  }

  protected moveFavorite(context: EntryMenuContext, delta: -1 | 1): void {
    this.favorites.move(context.path, delta);
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(FAVORITES_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}
