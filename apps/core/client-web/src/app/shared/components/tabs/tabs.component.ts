import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  model,
  viewChildren,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { VxBadgeComponent, VxTone } from '../badge';

/** One tab. `id` is what the caller stores; everything else is presentation. */
export interface VxTab {
  id: string;
  labelKey: string;
  disabled?: boolean;
  /** A count or a state beside the label: "Líneas 12", "Adjuntos 3". */
  badge?: string | number | null;
  badgeTone?: VxTone;
}

let nextId = 0;

/**
 * A strip of tabs inside a page.
 *
 * ## What this replaces
 *
 * Three hand-made strips — `features/invoices/new/new.page.html:52`,
 * `features/invoices/detail/detail.page.html` and
 * `features/accounting/account-form/account-form.page.html` — built from bare `<button>` elements
 * with an `.active` class. Between them they had **zero** `role="tablist"`, zero
 * `aria-selected`, and no arrow-key navigation: to a screen reader they were three unlabelled
 * buttons, and to a keyboard they were three separate tab stops.
 *
 * ## Roving tabindex, which is the whole point
 *
 * In the ARIA tabs pattern a tab strip is ONE stop in the page's tab order; the arrow keys move
 * between tabs inside it. Without that, a form with four tabs costs four presses of Tab before
 * reaching the first field — the reason it is worth a component rather than a class.
 *
 * ## The panels stay with the caller
 *
 * Projecting them would mean owning their lifecycle, and these panels are sections of a reactive
 * form that must stay mounted whether or not they are on screen — unmounting a tab would drop its
 * controls out of the form and silently discard what was typed in them. So the caller keeps its
 * `[class.hidden]`, and links each panel with `panelId()` / `tabId()`:
 *
 *     <vx-tabs #tabs [tabs]="TABS" [(active)]="activeTab" />
 *     <div role="tabpanel" [id]="tabs.panelId('content')"
 *          [attr.aria-labelledby]="tabs.tabId('content')"
 *          [hidden]="activeTab() !== 'content'"> … </div>
 */
@Component({
  selector: 'vx-tabs',
  standalone: true,
  imports: [TranslateModule, VxBadgeComponent],
  templateUrl: './tabs.component.html',
  styleUrls: ['./tabs.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'vx-tabs' },
})
export class VxTabsComponent {
  readonly tabs = input.required<readonly VxTab[]>();
  /** Two-way: the caller owns which tab is open, because it usually owns the routing too. */
  readonly active = model.required<string>();
  /** Names the strip for a screen reader, e.g. "Secciones de la factura". */
  readonly ariaLabel = input<string | null>(null);

  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>('tab');
  private readonly uid = `vx-tabs-${nextId++}`;

  /** The id of a tab button. For the panel's `aria-labelledby`. */
  tabId(id: string): string {
    return `${this.uid}-tab-${id}`;
  }

  /** The id the caller must put on the matching panel. For the tab's `aria-controls`. */
  panelId(id: string): string {
    return `${this.uid}-panel-${id}`;
  }

  protected readonly enabled = computed(() => this.tabs().filter((tab) => !tab.disabled));

  protected select(tab: VxTab): void {
    if (tab.disabled) return;
    this.active.set(tab.id);
  }

  /**
   * Arrow keys move; Home and End jump to the ends.
   *
   * Selection follows focus, which is the right choice here: every panel is already mounted, so
   * moving to a tab costs nothing and the reader gets the content they are pointing at instead of
   * having to confirm with Enter.
   */
  protected onKeydown(event: KeyboardEvent): void {
    const order = this.enabled();
    if (order.length === 0) return;

    const current = Math.max(
      0,
      order.findIndex((tab) => tab.id === this.active()),
    );
    let next = current;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (current + 1) % order.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (current - 1 + order.length) % order.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = order.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const target = order[next];
    this.active.set(target.id);
    //  El foco tiene que SEGUIR a la selección: si se queda en la pestaña anterior, la siguiente
    //  flecha se mueve desde donde el lector ya no está.
    this.buttons()
      .find((button) => button.nativeElement.id === this.tabId(target.id))
      ?.nativeElement.focus();
  }
}
