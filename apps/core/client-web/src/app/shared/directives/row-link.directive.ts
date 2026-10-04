import { Directive, ElementRef, inject } from '@angular/core';

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
 */
@Directive({
  selector: 'tr[appRowLink]',
  standalone: true,
  host: {
    class: 'vx-row-link',
    '(click)': 'onClick($event)',
  },
})
export class RowLinkDirective {
  private readonly row = inject<ElementRef<HTMLTableRowElement>>(ElementRef);

  onClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    if (!target || target.closest(INTERACTIVE)) return;
    if (typeof window !== 'undefined' && window.getSelection()?.toString()) return;
    const link = this.row.nativeElement.querySelector<HTMLAnchorElement>('a.table-link, a[href]');
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
}
