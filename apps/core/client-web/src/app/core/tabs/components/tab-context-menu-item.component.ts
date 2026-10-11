import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LucideAngularModule, Check } from 'lucide-angular';
import { VxKbdComponent } from '../../../shared/components/kbd';
import { KeyChord } from '../../keyboard/keyboard-shortcuts';

/**
 * Everything one row of the tab context menu needs. Passed through Dockview's `componentProps`;
 * the label arrives already translated because this component has no catalogue of its own.
 */
export interface TabContextMenuItemProps {
  /** Already-translated row label. */
  label: string;
  /** What the row does. Called before the menu closes. */
  run: () => void;
  /** A dimmed, non-interactive row — e.g. "Close" on a tab that may not be closed. */
  disabled?: boolean;
  /** A leading check, for a row that toggles a setting (e.g. "Open in preview"). */
  checked?: boolean;
  /** The keyboard shortcut to show on the right, for rows that have one. */
  chord?: KeyChord;
}

/**
 * One row of the tab context menu, rendered by Dockview through dockview-angular's
 * `getTabContextMenuItems` → `{ component }` contract.
 *
 * ## Why a component instead of Dockview's plain text items
 *
 * Dockview's built-in item is a `div` whose `textContent` is the label — no room for a right-
 * aligned shortcut, a check column, or theming beyond a class. Returning a framework `component`
 * hands rendering to Angular, and the adapter injects Dockview's `close` so the row can dismiss the
 * menu after acting. That is what lets the menu show `⌘W` beside "Close" and style itself to match
 * the rest of the product.
 *
 * `close` and `componentProps` are assigned as plain instance fields by the adapter
 * (`instance[key] = value`, then `markForCheck`), which is why they are public and optional rather
 * than signal inputs.
 */
@Component({
  selector: 'app-tab-context-menu-item',
  standalone: true,
  imports: [LucideAngularModule, VxKbdComponent],
  template: `
    <button
      type="button"
      class="dv-ctx-item"
      [class.dv-ctx-item--disabled]="componentProps?.disabled"
      [disabled]="componentProps?.disabled"
      role="menuitem"
      (click)="onClick()"
    >
      <span class="dv-ctx-item__check">
        @if (componentProps?.checked) {
          <lucide-icon [img]="CheckIcon" size="14" aria-hidden="true" />
        }
      </span>
      <span class="dv-ctx-item__label">{{ componentProps?.label }}</span>
      @if (componentProps?.chord; as chord) {
        <vx-kbd class="dv-ctx-item__kbd" [chord]="chord" />
      }
    </button>
  `,
  styleUrls: ['./tab-context-menu-item.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabContextMenuItemComponent {
  /** Injected by dockview-angular to dismiss the menu after the action runs. */
  close?: () => void;
  /** Injected by dockview-angular from the item config's `componentProps`. */
  componentProps?: TabContextMenuItemProps;

  protected readonly CheckIcon = Check;

  protected onClick(): void {
    if (this.componentProps?.disabled) return;
    this.componentProps?.run();
    this.close?.();
  }
}
