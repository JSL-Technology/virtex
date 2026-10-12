import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Rows3, Trash2 } from 'lucide-angular';
import { WorkflowGraphGroup } from '../../data/workflow.service';
import { DesignerStore } from '../designer-store';

export const LANE_COLORS = ['viz-1', 'viz-2', 'viz-3', 'viz-4', 'viz-5', 'viz-6', 'viz-7', 'viz-8'] as const;

/**
 * Properties of the selected lane — a band that groups the steps one department or role owns.
 * Lanes are visual only: deleting one keeps its steps, which simply leave it.
 */
@Component({
  selector: 'app-workflow-group-panel',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './inspector.scss',
  template: `
    @let g = group();
    <header class="insp-head">
      <span class="insp-kind" aria-hidden="true"><lucide-icon [img]="LaneIcon" [size]="16" /></span>
      <h3>{{ g.name || ('workflow_engine.designer.lane' | translate) }}</h3>
      @if (!readonly()) {
        <button type="button" class="insp-icon" (click)="store.deleteItems({ groups: [g.id] })"
          [attr.aria-label]="'workflow_engine.designer.delete_lane' | translate" [title]="'workflow_engine.designer.delete_lane' | translate">
          <lucide-icon [img]="TrashIcon" [size]="14" />
        </button>
      }
    </header>
    <section class="insp-section">
      <div class="insp-field">
        <label for="group-name">{{ 'workflow_engine.field.name' | translate }}</label>
        <input id="group-name" type="text" maxlength="80" [value]="g.name ?? ''" [readOnly]="readonly()"
          (input)="store.patchGroup(g.id, { name: $any($event.target).value || undefined }, 'name')" />
      </div>
      <div class="insp-field">
        <span class="insp-label" id="group-color">{{ 'workflow_engine.designer.color' | translate }}</span>
        <div class="insp-swatches" role="group" aria-labelledby="group-color">
          @for (color of colors; track color; let i = $index) {
            <button type="button" [class]="'swatch-' + color" [attr.aria-pressed]="(g.color ?? 'viz-1') === color" [disabled]="readonly()"
              [attr.aria-label]="('workflow_engine.designer.color' | translate) + ' ' + (i + 1)" (click)="store.patchGroup(g.id, { color })"></button>
          }
        </div>
      </div>
      <p class="insp-hint">{{ 'workflow_engine.designer.lane_steps' | translate: { count: members() } }}</p>
      <p class="insp-hint">{{ 'workflow_engine.designer.lane_hint' | translate }}</p>
    </section>
  `,
})
export class GroupPanelComponent {
  protected readonly store = inject(DesignerStore);

  readonly group = input.required<WorkflowGraphGroup>();
  readonly readonly = input(false);

  protected readonly colors = LANE_COLORS;
  protected readonly LaneIcon = Rows3;
  protected readonly TrashIcon = Trash2;

  readonly members = computed(() => this.store.nodes().filter((n) => n.parentId === this.group().id).length);
}
