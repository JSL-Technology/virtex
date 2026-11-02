import { ExternalLink, FolderOpen, Link2, PanelRight, PanelTop, SquareArrowOutUpRight } from 'lucide-angular';
import { NavigationActionsService, OpenMode } from '../../../core/navigation/navigation-actions.service';
import { MenuSection } from './context-menu.types';

/**
 * What every row with a destination offers, in the same words as the side menu: open it (here, in
 * a new tab, in the background, to the side, in a browser window) and copy its link. A list adds
 * what can be done TO the item between the two (QA R3-B08).
 */
export function rowNavigationSections(
  link: HTMLAnchorElement,
  navigation: NavigationActionsService,
): { open: MenuSection; share: MenuSection } | null {
  const path = link.getAttribute('href');
  if (!path) return null;
  const open = (mode: OpenMode) => () => navigation.open(path, mode);
  return {
    open: {
      id: 'open',
      // «Abrir» first; the four other ways under one entry, so the item's own actions stay near
      // the top of the menu instead of below five ways of opening it.
      items: [
        { id: 'open', label: 'shell.nav.open', icon: FolderOpen, run: () => link.click() },
        {
          id: 'open-in',
          label: 'shell.nav.open_in',
          icon: PanelTop,
          submenu: [
            { id: 'open-tab', label: 'shell.nav.open_new_tab', icon: PanelTop, run: open('permanent') },
            { id: 'open-background', label: 'shell.nav.open_in_background', icon: SquareArrowOutUpRight, run: open('background') },
            { id: 'open-side', label: 'shell.nav.open_to_side', icon: PanelRight, run: open('side') },
            { id: 'open-window', label: 'shell.nav.open_new_window', icon: ExternalLink, run: open('window') },
          ],
        },
      ],
    },
    share: { id: 'share', items: [{ id: 'copy-link', label: 'shell.nav.copy_link', icon: Link2, run: () => navigation.copyLink(path) }] },
  };
}

/** The row's own link: the one `appRowLink` follows. */
export function rowLinkOf(row: HTMLElement): HTMLAnchorElement | null {
  return row.querySelector<HTMLAnchorElement>('a.table-link, a[href]');
}
