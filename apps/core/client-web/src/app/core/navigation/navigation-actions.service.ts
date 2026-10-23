import { Injectable, Injector, afterNextRender, inject } from '@angular/core';
import { Clipboard } from '@angular/cdk/clipboard';
import { TabStateService } from '../tabs/tab-state.service';
import { TabCommandsService } from '../tabs/tab-command.service';
import {
  ActiveOrganizationService,
  pathWithoutOrganization,
} from '../tenancy/active-organization.service';
import { NotificationService } from '../services/notification';

/**
 * How a destination is opened.
 *
 *  - `preview`    — the reusable preview tab (a single click in the menu).
 *  - `permanent`  — a tab of its own that stays open (double click, «Open in new tab»).
 *  - `background` — a tab of its own, without leaving the window on screen.
 *  - `side`       — a tab of its own, split to the right of the current one.
 *  - `window`     — a new browser window, outside this workspace.
 */
export type OpenMode = 'preview' | 'permanent' | 'background' | 'side' | 'window';

/**
 * Everything the navigation chrome can do with a destination, in one place.
 *
 * ## Why a service and not handlers in the panel
 *
 * The same five ways of opening a page are offered by the module panel, the favourites, and the tab
 * strip's «Copy link» — and the rules behind them are not obvious: a link must carry the company,
 * a background tab must not steal focus, a split needs the tab to exist before Dockview can move
 * it. Written once, every surface behaves the same; written per surface, they would drift the first
 * time one of the rules changed.
 *
 * It speaks in workspace routes (`/invoices/88`, no company). A path that still carries the company
 * prefix — what the panel renders — is accepted and normalised, so callers never have to know.
 */
@Injectable({ providedIn: 'root' })
export class NavigationActionsService {
  private readonly tabs = inject(TabStateService);
  private readonly commands = inject(TabCommandsService);
  private readonly tenancy = inject(ActiveOrganizationService);
  private readonly clipboard = inject(Clipboard);
  private readonly notify = inject(NotificationService);
  private readonly injector = inject(Injector);

  open(path: string, mode: OpenMode = 'preview'): void {
    const { route, queryParams } = this.split(path);
    switch (mode) {
      case 'preview':
        this.tabs.openTab({ route, queryParams });
        return;
      case 'permanent':
        // Already open as the preview (the click that preceded a double click opened it): the
        // store pins it in place instead of opening a second copy.
        this.tabs.openTab({ route, queryParams, preview: false });
        return;
      case 'background':
        this.tabs.openTab({ route, queryParams, preview: false, activate: false });
        this.notify.showInfo('shell.nav.opened_in_background');
        return;
      case 'side':
        this.tabs.openTab({ route, queryParams, preview: false });
        // Dockview creates the panel when the tab list renders; only then can it be moved.
        afterNextRender(() => this.commands.run('layout.split_right'), { injector: this.injector });
        return;
      case 'window':
        window.open(this.absoluteUrl(path), '_blank', 'noopener,noreferrer');
        return;
    }
  }

  /**
   * Copy a link to the page that anyone in the company can open.
   *
   * The link carries the company (`/e/acme/invoices/88`), because a page belongs to one: the same
   * address without it would open in whichever company the recipient used last. Whoever opens it
   * signs in first if they have to and lands on this page afterwards (see `ReturnUrlService`); one
   * without access to the company or the page is told so instead of being shown another.
   */
  copyLink(path: string): void {
    const copied = this.clipboard.copy(this.absoluteUrl(path));
    if (copied) this.notify.showSuccess('shell.nav.link_copied');
    else this.notify.showError('shell.nav.link_copy_failed');
  }

  /** The full address of a page in this company, as a browser or another person would use it. */
  absoluteUrl(path: string): string {
    const { route, queryParams } = this.split(path);
    const query = queryParams && Object.keys(queryParams).length ? `?${new URLSearchParams(queryParams)}` : '';
    return `${location.origin}${this.tenancy.urlFor(route)}${query}`;
  }

  private split(path: string): { route: string; queryParams?: Record<string, string> } {
    const [route, query] = pathWithoutOrganization(path).split('?');
    if (!query) return { route };
    return { route, queryParams: Object.fromEntries(new URLSearchParams(query)) };
  }
}
