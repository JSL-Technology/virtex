import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { Dimension, DimensionValue, DimensionsService, valueLabel, valueTree } from '../data/dimensions.service';

/**
 * The analytic tags of one line: a select per active dimension, its active values in tree order
 * (and the value the line already carries, retired or not). Used by the lines of recurring
 * entries and templates; the journal-entry form keeps its own inline row.
 */
@Component({
  selector: 'vx-dimension-tags',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dimensions().length) {
      <div class="dimension-tags" role="group" [attr.aria-label]="labelKey() | translate: labelParams()">
        @for (dimension of dimensions(); track dimension.id) {
          <label class="dimension-tags__field">
            <span>{{ dimension.name }}</span>
            <select [value]="tags()[dimension.name] ?? ''" [disabled]="disabled()"
                    (change)="set(dimension.name, $any($event.target).value)">
              <option value="">—</option>
              @for (option of options(dimension); track option.value.value) {
                <option [value]="option.value.value" [selected]="option.value.value === tags()[dimension.name]">
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
      .dimension-tags { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-3); }
      .dimension-tags__field { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--text-sm); color: var(--content-secondary); }
      .dimension-tags__field select { min-width: 10rem; }
    `,
  ],
})
export class VxDimensionTagsComponent implements OnInit {
  private readonly service = inject(DimensionsService);

  readonly tags = input<Record<string, string>>({});
  readonly disabled = input(false);
  readonly labelKey = input('dimensions.tags.label');
  readonly labelParams = input<Record<string, unknown>>({});
  readonly tagsChange = output<Record<string, string>>();

  readonly dimensions = signal<Dimension[]>([]);
  protected readonly label = valueLabel;

  ngOnInit(): void {
    this.service.forTagging().subscribe({
      next: (list) => this.dimensions.set(list.filter((dimension) => dimension.isActive)),
      error: () => this.dimensions.set([]),
    });
  }

  options(dimension: Dimension): Array<{ value: DimensionValue; depth: number }> {
    const current = this.tags()[dimension.name];
    const active = dimension.values.filter((value) => value.isActive || value.value === current);
    return valueTree(active);
  }

  set(dimension: string, value: string): void {
    const next = { ...this.tags() };
    if (value) next[dimension] = value;
    else delete next[dimension];
    this.tagsChange.emit(next);
  }

  indent(depth: number): string {
    return '  '.repeat(depth);
  }
}
