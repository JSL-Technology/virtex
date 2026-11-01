import { Directive, ElementRef, inject } from '@angular/core';
import { ExternalLink, FolderOpen, Link2, PanelRight, PanelTop, SquareArrowOutUpRight } from 'lucide-angular';
import { ContextMenuService } from '../components/context-menu/context-menu.service';
import { RowMenuDirective } from '../components/context-menu/row-menu.directive';
import { MenuContext, MenuSection } from '../components/context-menu/context-menu.types';
import { NavigationActionsService, OpenMode } from '../../core/navigation/navigation-actions.service';

const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="button"], [role="menuitem"], [contenteditable]';

/**
 * A table row that opens like its link: `<tr appRowLink>` around a row whose first cell holds
 * `<a class="table-link" [routerLink]>` (QA B-02: in payroll only the «Período» text opened the
 * run, and the rest of the row — the amounts someone is actually looking at — did nothing).
 *
 * The click is handed to that link rather than re-implemented, so the route, relative paths and
 * modifier keys behave exactly as the link does. The link stays the keyboard path: the row is not
 * a second tab stop for the same destination. Clicks on the row's own controls, and a drag that
 * selects text to copy, are left alone.
 *
 * ## The row's menu
 *
 * Right-click (or Shift+F10 / the Menu key on the row's link) offers what the side menu offers for
 * a page: open, in a new tab, in the background, to the side, in a browser window, and copy its
 * link (QA R3-B08: rows had no context menu, the side menu did). Every list gets it from this one
 * directive, through the same navigation service, so they behave alike. A row whose page declares
 * its own menu (`appRowMenu`, with that list's actions) keeps that one.
 */
@Directive({
  selector: 'tr[appRowLink]',
  standalone: true,
  host: {
    class: 'vx-row-link',
    '(click)': 'onClick($event)',
    '(contextmenu)': 'onMenu($event)',
    '(keydown.shift.F10)': 'onMenu($event)',
    '(keydown.ContextMenu)': 'onMenu($event)',
  },
})
export class RowLinkDirective {
  private readonly row = inject<ElementRef<HTMLTableRowElement>>(ElementRef);
  private readonly ownMenu = inject(RowMenuDirective, { self: true, optional: true });
  private readonly menu = inject(ContextMenuService, { optional: true });
  private readonly navigation = inject(NavigationActionsService, { optional: true });

  onClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    if (!target || target.closest(INTERACTIVE)) return;
    if (typeof window !== 'undefined' && window.getSelection()?.toString()) return;
    const link = this.link();
    if (!link) return;
    link.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: event.button,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      }),
    );
  }

  onMenu(event: MouseEvent | KeyboardEvent): void {
    if (this.ownMenu || !this.menu || !this.navigation) return;
    // A control inside the row keeps the browser's own menu (a text field's copy and paste).
    const target = event.target as Element | null;
    if (target?.closest('input, textarea, select, [contenteditable]')) return;
    const link = this.link();
    const path = link?.getAttribute('href');
    if (!link || !path) return;
    const navigation = this.navigation;
    const open = (mode: OpenMode) => () => navigation.open(path, mode);
    const sections: MenuSection[] = [
      {
        id: 'open',
        items: [
          { id: 'open', label: 'shell.nav.open', icon: FolderOpen, run: () => link.click() },
          { id: 'open-tab', label: 'shell.nav.open_new_tab', icon: PanelTop, run: open('permanent') },
          { id: 'open-background', label: 'shell.nav.open_in_background', icon: SquareArrowOutUpRight, run: open('background') },
          { id: 'open-side', label: 'shell.nav.open_to_side', icon: PanelRight, run: open('side') },
          { id: 'open-window', label: 'shell.nav.open_new_window', icon: ExternalLink, run: open('window') },
        ],
      },
      { id: 'share', items: [{ id: 'copy-link', label: 'shell.nav.copy_link', icon: Link2, run: () => navigation.copyLink(path) }] },
    ];
    const context: MenuContext = { kind: 'row', selection: [], event };
    this.menu.open(event, sections, context);
  }

  private link(): HTMLAnchorElement | null {
    return this.row.nativeElement.querySelector<HTMLAnchorElement>('a.table-link, a[href]');
  }
}
