import { MenuItem, MenuSection } from './context-menu.types';
import { NavigationActionsService } from '../../../core/navigation/navigation-actions.service';
import { rowLinkOf, rowNavigationSections } from './row-navigation';

/**
 * A context menu for ANY table row, from what the row already offers (QA R3-B08: rows had none).
 *
 * The row's own buttons and links — edit, delete, activate, approve, «Registrar cobro» — are what
 * the screen lets this user do to this item in its current state: the template renders a button
 * only when its permission and status allow it, disabled when it cannot run now. So they are the
 * row's actions, with their exact words, and running one is clicking it: the same handler, the same
 * confirmation, the same checks. Nothing is declared twice, and a screen added tomorrow has its menu.
 *
 * A list whose items have more to offer than their row shows (a document's void, collect,
 * approve…) declares them with `appRowMenu`; this is what every other row gets.
 */
export function rowActionSections(row: HTMLElement, navigation: NavigationActionsService | null): MenuSection[] {
  const link = rowLinkOf(row);
  const nav = link && navigation ? rowNavigationSections(link, navigation) : null;
  const actions = rowControls(row, link);
  return [
    ...(nav ? [nav.open] : []),
    ...(actions.length ? [{ id: 'row-actions', items: actions }] : []),
    ...(nav ? [nav.share] : []),
  ];
}

/**
 * The screen's own commands (its header buttons: «Nuevo», «Exportar», «Importar»…), offered on a
 * right-click on the table's chrome or empty space.
 */
export function screenActionSections(table: HTMLElement): MenuSection[] {
  const shell = table.closest('vx-list-shell');
  const bar = shell?.querySelector<HTMLElement>('.ls__actions');
  const items = bar ? controlsIn(bar, null, 'screen') : [];
  return items.length ? [{ id: 'screen-actions', items }] : [];
}

function rowControls(row: HTMLElement, link: HTMLAnchorElement | null): MenuItem[] {
  return controlsIn(row, link, 'row');
}

function controlsIn(root: HTMLElement, exclude: HTMLAnchorElement | null, prefix: string): MenuItem[] {
  const seen = new Set<string>();
  const items: MenuItem[] = [];
  root.querySelectorAll<HTMLElement>('button, a[href]').forEach((control, index) => {
    if (control === exclude || !isShown(control)) return;
    if (control.matches('[aria-haspopup], [role="menuitem"]')) return; // its own menu (⋮): already this one
    if (control.closest('.vx-sort, thead')) return;
    const label = labelOf(control);
    if (!label || seen.has(label)) return;
    seen.add(label);
    const danger = control.matches('.danger-button, .danger-link, .icon-button--danger, [data-danger]');
    const disabled = (control as HTMLButtonElement).disabled || control.getAttribute('aria-disabled') === 'true';
    items.push({
      id: `${prefix}-${index}`,
      label: '',
      text: label,
      danger,
      disabled: () => disabled,
      run: () => control.click(),
    });
  });
  return items;
}

function isShown(element: HTMLElement): boolean {
  if (element.hidden || element.closest('[hidden]')) return false;
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(element) : null;
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  return true;
}

/** What the control says: its accessible name, which the screen already translated. */
function labelOf(control: HTMLElement): string {
  const named = control.getAttribute('aria-label') || control.getAttribute('title');
  const text = (named || control.innerText || control.textContent || '').replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}
