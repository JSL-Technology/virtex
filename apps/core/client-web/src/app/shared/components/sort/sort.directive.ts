import { ChangeDetectionStrategy, Component, Directive, computed, inject, input } from '@angular/core';
import { ArrowDown, ArrowUp, ArrowUpDown, LucideAngularModule } from 'lucide-angular';
import { TableSort } from './table-sort';

/** The table whose headers sort: `<table [vxSort]="sort">`. */
@Directive({ selector: '[vxSort]', standalone: true })
export class VxSortDirective {
  readonly vxSort = input.required<TableSort<any, any>>();
}

/**
 * A header that sorts its column: `<th vxSortHeader="total">Total</th>`.
 *
 * The control inside is a `<button>`, so it is reached with Tab and announced as something that
 * can be pressed; the `<th>` carries `aria-sort`, so the reader hears the current order.
 */
@Component({
  selector: 'th[vxSortHeader]',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'vx-sort-header', '[attr.aria-sort]': 'ariaSort()' },
  template: `<button type="button" class="vx-sort" [class.vx-sort--active]="ariaSort() !== 'none'" (click)="toggle()">
    <span class="vx-sort__label"><ng-content /></span>
    <lucide-icon class="vx-sort__icon" [img]="icon()" size="13" aria-hidden="true" />
  </button>`,
  styles: `
    .vx-sort {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      max-width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      font: inherit;
      color: inherit;
      text-align: inherit;
      text-transform: inherit;
      letter-spacing: inherit;
      cursor: pointer;
    }
    :host(.text-right) .vx-sort,
    :host(.num) .vx-sort,
    :host(.amount) .vx-sort { flex-direction: row-reverse; }
    .vx-sort:hover,
    .vx-sort--active { color: var(--content-primary); }
    .vx-sort:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring-color); outline-offset: var(--focus-ring-offset); border-radius: var(--radius-sm); }
    .vx-sort__icon { flex: none; opacity: 0.45; }
    .vx-sort:hover .vx-sort__icon,
    .vx-sort--active .vx-sort__icon { opacity: 1; }
  `,
})
export class VxSortHeaderComponent {
  private readonly table = inject(VxSortDirective);
  readonly vxSortHeader = input.required<string>();

  protected readonly ariaSort = computed(() => this.table.vxSort().ariaSort(this.vxSortHeader()));
  protected readonly icon = computed(() => {
    const state = this.ariaSort();
    return state === 'ascending' ? ArrowUp : state === 'descending' ? ArrowDown : ArrowUpDown;
  });

  protected toggle(): void {
    this.table.vxSort().toggle(this.vxSortHeader());
  }
}

export const VX_SORT = [VxSortDirective, VxSortHeaderComponent] as const;
