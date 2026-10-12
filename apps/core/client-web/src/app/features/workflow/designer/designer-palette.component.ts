import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FFlowModule } from '@foblex/flow';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ChevronDown, LucideAngularModule, Rows3, Search, X } from 'lucide-angular';
import { NODE_ICONS, nodeTypeKey } from '../data/workflow-labels';
import { WorkflowGraphNode, WorkflowNodeType } from '../data/workflow.service';
import { DesignerCatalogs } from './designer-catalogs';

export type PaletteCategory = 'people' | 'logic' | 'automation' | 'flow' | 'structure';

/** What is dragged from the palette onto the canvas (Foblex `fData`). */
export interface PaletteItem {
  id: string;
  category: PaletteCategory;
  kind: 'node' | 'lane';
  type?: WorkflowNodeType;
  preset?: Partial<WorkflowGraphNode>;
  label: string;
  description: string;
  icon: unknown;
}

const CATEGORY_ORDER: PaletteCategory[] = ['people', 'logic', 'automation', 'flow', 'structure'];

/**
 * The palette: every kind of step, grouped and searchable, dragged onto the canvas as Foblex
 * external items — or added with Enter/click at the centre of the view, so it works with a
 * keyboard and on touch screens too. Each automatic action the server offers is its own item,
 * preconfigured, so «Send notification» is one drag rather than «Action» plus a dropdown.
 */
@Component({
  selector: 'app-workflow-designer-palette',
  standalone: true,
  imports: [FFlowModule, TranslateModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './designer-palette.component.scss',
  template: `
    <div class="pal__search">
      <lucide-icon [img]="SearchIcon" [size]="14" aria-hidden="true" />
      <label for="palette-search" class="sr-only">{{ 'workflow_engine.palette.search' | translate }}</label>
      <input id="palette-search" type="search" autocomplete="off" [value]="query()" (input)="query.set($any($event.target).value)"
        [placeholder]="'workflow_engine.palette.search' | translate" />
      @if (query()) {
        <button type="button" class="pal__clear" (click)="query.set('')" [attr.aria-label]="'workflow_engine.palette.clear' | translate">
          <lucide-icon [img]="ClearIcon" [size]="12" />
        </button>
      }
    </div>

    <div class="pal__groups">
      @for (group of groups(); track group.category) {
        <section class="pal__group">
          <button type="button" class="pal__group-head" [attr.aria-expanded]="!collapsed().has(group.category)" (click)="toggle(group.category)">
            <span>{{ categoryKey(group.category) | translate }}</span>
            <lucide-icon [img]="ChevronIcon" [size]="14" [class.pal__chevron--closed]="collapsed().has(group.category)" />
          </button>
          @if (!collapsed().has(group.category) || query()) {
            <ul class="pal__items" role="list">
              @for (item of group.items; track item.id) {
                <li>
                  <button
                    type="button"
                    class="pal-item"
                    fExternalItem
                    [fData]="item"
                    [fDisabled]="readonly()"
                    [fExternalItemId]="item.id"
                    [disabled]="readonly()"
                    [attr.data-type]="item.type ?? 'lane'"
                    [title]="item.description"
                    (click)="add.emit(item)"
                  >
                    <span class="pal-item__icon" aria-hidden="true"><lucide-icon [img]="item.icon" [size]="16" /></span>
                    <span class="pal-item__text">
                      <span class="pal-item__label">{{ item.label }}</span>
                      <span class="pal-item__description">{{ item.description }}</span>
                    </span>
                  </button>
                </li>
              }
            </ul>
          }
        </section>
      } @empty {
        <p class="pal__empty">{{ 'workflow_engine.palette.no_results' | translate }}</p>
      }
    </div>
    @if (!readonly()) {
      <p class="pal__hint">{{ 'workflow_engine.palette.hint' | translate }}</p>
    }
  `,
})
export class DesignerPaletteComponent {
  private readonly translate = inject(TranslateService);
  private readonly catalogs = inject(DesignerCatalogs);

  readonly readonly = input(false);
  readonly add = output<PaletteItem>();

  readonly query = signal('');
  readonly collapsed = signal<Set<PaletteCategory>>(new Set());

  protected readonly SearchIcon = Search;
  protected readonly ClearIcon = X;
  protected readonly ChevronIcon = ChevronDown;

  readonly items = computed<PaletteItem[]>(() => {
    const t = (key: string) => this.translate.instant(key);
    const node = (type: WorkflowNodeType, category: PaletteCategory): PaletteItem => ({
      id: `node:${type}`,
      category,
      kind: 'node',
      type,
      label: t(nodeTypeKey(type)),
      description: t(`workflow_engine.palette.describe.${type}`),
      icon: NODE_ICONS[type],
    });
    const actions = this.catalogs.actions().map<PaletteItem>((action) => ({
      id: `action:${action.key}`,
      category: 'automation',
      kind: 'node',
      type: 'action',
      preset: { name: t(action.labelKey), config: { action: action.key } },
      label: t(action.labelKey),
      description: action.descriptionKey ? t(action.descriptionKey) : '',
      icon: NODE_ICONS.action,
    }));
    return [
      node('task', 'people'),
      node('approval', 'people'),
      node('condition', 'logic'),
      node('timer', 'logic'),
      ...(actions.length ? actions : [node('action', 'automation')]),
      node('end', 'flow'),
      {
        id: 'lane',
        category: 'structure',
        kind: 'lane',
        label: t('workflow_engine.designer.lane'),
        description: t('workflow_engine.palette.describe.lane'),
        icon: Rows3,
      },
    ];
  });

  readonly groups = computed(() => {
    const q = normalize(this.query());
    const visible = q ? this.items().filter((item) => normalize(`${item.label} ${item.description}`).includes(q)) : this.items();
    return CATEGORY_ORDER.map((category) => ({ category, items: visible.filter((item) => item.category === category) })).filter((g) => g.items.length);
  });

  categoryKey(category: PaletteCategory): string {
    return `workflow_engine.palette.category.${category}`;
  }

  toggle(category: PaletteCategory): void {
    this.collapsed.update((set) => {
      const next = new Set(set);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
