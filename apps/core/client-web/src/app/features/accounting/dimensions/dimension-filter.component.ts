import { ChangeDetectionStrategy, Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { Dimension, DimensionsService, valueLabel, valueTree } from '../data/dimensions.service';

/**
 * Narrow a financial statement to one value of one analytic dimension: the income statement of a
 * cost centre, the balance of a project.
 *
 * The statements accepted a `costCenterId` and a `projectId` that matched nothing — lines are
 * tagged by dimension name and value code — and no screen offered them. Hidden when the company
 * has no dimensions, or the reader cannot see them: the statement is complete without it.
 */
@Component({
  selector: 'vx-dimension-filter',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dimensions().length) {
      <div class="dimension-filter" role="group" [attr.aria-label]="'dimensions.filter.label' | translate">
        <label>
          <span>{{ 'dimensions.filter.dimension' | translate }}</span>
          <select [value]="dimension()" (change)="chooseDimension($any($event.target).value)">
            <option value="">{{ 'dimensions.filter.all' | translate }}</option>
            @for (option of dimensions(); track option.id) {
              <option [value]="option.name" [selected]="option.name === dimension()">{{ option.name }}</option>
            }
          </select>
        </label>
        @if (selected(); as current) {
          <label>
            <span>{{ 'dimensions.filter.value' | translate }}</span>
            <select [value]="value()" (change)="chooseValue($any($event.target).value)">
              <option value="">{{ 'dimensions.filter.choose_value' | translate }}</option>
              @for (option of values(); track option.value.value) {
                <option [value]="option.value.value" [selected]="option.value.value === value()">
                  {{ indent(option.depth) }}{{ label(option.value) }}
                </option>
              }
            </select>
          </label>
        }
      </div>
    }
  `,
  styles: [
    `
      .dimension-filter { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: flex-end; }
      .dimension-filter label { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--text-sm); color: var(--content-secondary); }
      .dimension-filter select { min-width: 10rem; }
    `,
  ],
})
export class VxDimensionFilterComponent implements OnInit {
  private readonly service = inject(DimensionsService);

  /** `{}` for no filter, or `{ name: code }`. */
  readonly filterChange = output<Record<string, string>>();

  readonly dimensions = signal<Dimension[]>([]);
  readonly dimension = signal('');
  readonly value = signal('');
  readonly selected = computed(() => this.dimensions().find((dimension) => dimension.name === this.dimension()) ?? null);
  /** Every value, retired ones included: the history a report reads still carries them. */
  readonly values = computed(() => valueTree(this.selected()?.values ?? []));
  protected readonly label = valueLabel;

  ngOnInit(): void {
    this.service.forTagging().subscribe({
      next: (list) => this.dimensions.set(list),
      error: () => this.dimensions.set([]),
    });
  }

  chooseDimension(name: string): void {
    this.dimension.set(name);
    this.value.set('');
    // Choosing a dimension without a value filters nothing yet; clearing it removes the filter.
    if (!name) this.filterChange.emit({});
  }

  chooseValue(code: string): void {
    this.value.set(code);
    this.filterChange.emit(code && this.dimension() ? { [this.dimension()]: code } : {});
  }

  indent(depth: number): string {
    return '  '.repeat(depth);
  }
}
