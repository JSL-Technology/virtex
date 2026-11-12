import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { ListSelectionService } from '../context-menu/list-selection.service';

/**
 * The selection column of a table whose page provides `ListSelectionService` (the same one the row
 * menu uses for actions on several rows):
 *
 * ```html
 * <th vxSelectAll></th>
 * …
 * <td [vxSelect]="row.id" [vxSelectLabel]="row.name"></td>
 * ```
 *
 * The page used to write the two checkboxes itself: an `aria-label` that was the bare record name
 * («Resma de papel» — select it? open it?), a header box with no «some selected» state, a click
 * that also opened the row behind it, and no Shift+click for a range. Here, once.
 */
@Component({
  // An attribute on the cell: the header stays a native `<th>` for the table's semantics.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'th[vxSelectAll]',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'select-column' },
  template: `<input
    type="checkbox"
    class="vx-table__check"
    [checked]="all()"
    [indeterminate]="some()"
    [disabled]="selection.size() === 0"
    [attr.aria-label]="'actions.select_all' | translate"
    (change)="selection.toggleAll()"
  />`,
})
export class VxTableSelectAllComponent {
  protected readonly selection = inject(ListSelectionService);
  protected readonly all = computed(() => this.selection.allSelected());
  /** Some rows and not all: the box says so (mixed), rather than looking empty. */
  protected readonly some = computed(() => this.selection.count() > 0 && !this.selection.allSelected());
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'td[vxSelect]',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'select-column' },
  template: `<input
    #box
    type="checkbox"
    class="vx-table__check"
    [checked]="checked()"
    [attr.aria-label]="vxSelectLabel() ? ('actions.select_named' | translate: { name: vxSelectLabel() }) : ('actions.select_row' | translate)"
    (click)="onClick($event, box)"
  />`,
})
export class VxTableSelectComponent {
  private readonly selection = inject(ListSelectionService);
  /** The row's id, as the page gave it to `ListSelectionService.setItems`. */
  readonly id = input.required<string>({ alias: 'vxSelect' });
  /** What the row is called, for the box's name: «Seleccionar Resma de papel». */
  readonly vxSelectLabel = input<string | null | undefined>(null);
  protected readonly checked = computed(() => this.selection.isSelected(this.id()));

  protected onClick(event: MouseEvent, box: HTMLInputElement): void {
    // The box is not a way into the record: the click stays here (`appRowLink` would open it).
    event.stopPropagation();
    if (event.shiftKey) this.selection.selectRange(this.id());
    else this.selection.toggle(this.id());
    // A range can leave this box selected after the browser flipped it; the box shows the truth.
    box.checked = this.selection.isSelected(this.id());
  }
}
