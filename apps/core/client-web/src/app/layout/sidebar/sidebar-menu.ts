import { buildMenu, railModules } from '../../core/modules/module-registry';
import { moduleIcon } from '../../core/modules/module-icons';

// ────────────────────────────────────────────────────────────────
// Interface definitions
// ────────────────────────────────────────────────────────────────
export interface SidebarSubItem {
  path: string;
  translationKey: string;
}

export interface SidebarItem {
  path?: string;
  translationKey: string;
  icon: unknown; // LucideIconData
  isExpanded?: boolean;
  subItems?: SidebarSubItem[];
  /** Permission the entry requires. Mirrors the route it points at. */
  permission?: string;
}

export interface SidebarGroup {
  groupTranslationKey: string;
  items: SidebarItem[];
}

// ────────────────────────────────────────────────────────────────
// Menu, derived
// ────────────────────────────────────────────────────────────────

/**
 * The navigation menu is generated from the module manifests.
 *
 * ## Why it is no longer written by hand
 *
 * It was a list of paths maintained separately from the router and from the window catalogue, and
 * the three drifted the way three hand-maintained copies of one fact always drift. The previous
 * round of this had 224 entries of which 173 pointed at routes that did not exist. Those were
 * removed, leaving 50 — and 40 of the survivors still opened an "under construction" card, because
 * the window catalogue knew 15 patterns and nobody had connected the two lists.
 *
 * A sweep fixes today's list and says nothing about tomorrow's. So the list is gone: a menu entry
 * IS a route that declared `menu` in its manifest. An entry pointing nowhere is not a bug that a
 * test has to catch; it is a sentence that can no longer be written.
 *
 * Each module contributes one group, in business order — what you sell, what you buy, what you
 * hold, what you owe — and inside it the entries keep the fixed order of their groups (inbox,
 * documents, masters, analysis). That the shape repeats across modules is the point: the second
 * module costs nothing to learn.
 */
export const SIDEBAR_MENU: SidebarGroup[] = railModules().map((module) => ({
  groupTranslationKey: module.titleKey,
  items: buildMenu(module).flatMap((section) =>
    section.entries.map((entry) => ({
      path: entry.path,
      translationKey: entry.labelKey,
      icon: moduleIcon(entry.icon),
      permission: entry.permission,
    })),
  ),
}));
