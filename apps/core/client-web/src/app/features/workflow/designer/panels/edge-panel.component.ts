import { VxPluralKeyPipe } from '@virteex/shared/ui-i18n';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AlertTriangle, ArrowRight, CircleAlert, LucideAngularModule, Spline, Trash2 } from 'lucide-angular';
import { issueMessage, nodeTypeKey, outcomeLabel } from '../../data/workflow-labels';
import { WorkflowGraphEdge, WorkflowIssue, WorkflowPredicate } from '../../data/workflow.service';
import { ConditionEditorComponent } from '../condition-editor.component';
import { DesignerCatalogs } from '../designer-catalogs';
import { DesignerStore, outcomesOf } from '../designer-store';

/**
 * Properties of the selected connection: where it goes, which answer of the previous step takes
 * it, and — out of a decision — the condition that sends the process down this branch or whether
 * it is the fallback taken when no condition holds.
 */
@Component({
  selector: 'app-workflow-edge-panel',
  standalone: true,
  imports: [TranslatePipe, VxPluralKeyPipe, LucideAngularModule, ConditionEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './inspector.scss',
  template: `
    @let e = edge();
    <header class="insp-head">
      <span class="insp-kind" aria-hidden="true"><lucide-icon [img]="EdgeIcon" [size]="16" /></span>
      <h3>{{ 'workflow_engine.designer.connection' | translate }}</h3>
      @if (!readonly()) {
        <button type="button" class="insp-icon" (click)="store.deleteItems({ edges: [e.id] })"
          [attr.aria-label]="'workflow_engine.designer.delete_connection' | translate" [title]="'workflow_engine.designer.delete_connection' | translate">
          <lucide-icon [img]="TrashIcon" [size]="14" />
        </button>
      }
    </header>

    @if (issues().length) {
      <section class="insp-section" [attr.aria-label]="'workflow_engine.designer.issues' | translate">
        <ul class="insp-list">
          @for (issue of issues(); track $index) {
            <li class="insp-issue" [class.insp-issue--error]="issue.severity === 'error'">
              <lucide-icon [img]="issue.severity === 'error' ? ErrorIcon : WarnIcon" [size]="14" />
              <span>{{ message(issue) }}</span>
            </li>
          }
        </ul>
      </section>
    }

    <section class="insp-section">
      <div class="insp-path">
        <button type="button" class="insp-link" (click)="store.select({ nodes: [e.from] })">{{ nameOf(e.from) }}</button>
        <lucide-icon [img]="ArrowIcon" [size]="14" aria-hidden="true" />
        <button type="button" class="insp-link" (click)="store.select({ nodes: [e.to] })">{{ nameOf(e.to) }}</button>
      </div>
      <div class="insp-field">
        <label for="edge-label">{{ 'workflow_engine.field.label' | translate }}</label>
        <input id="edge-label" type="text" maxlength="80" [value]="e.label ?? ''" [readOnly]="readonly()"
          [placeholder]="'workflow_engine.designer.label_placeholder' | translate"
          (input)="store.patchEdge(e.id, { label: $any($event.target).value || undefined }, 'label')" />
        @if (e.condition) {
          <p class="insp-hint">{{ 'workflow_engine.designer.condition_label_hint' | translate }}</p>
        }
      </div>
    </section>

    @if (offered().length) {
      <section class="insp-section">
        <h4 class="insp-section__title">{{ 'workflow_engine.designer.when_answer' | translate }}</h4>
        <div class="insp-field">
          <label for="edge-outcome">{{ 'workflow_engine.field.outcome' | translate }}</label>
          <select id="edge-outcome" [value]="e.default ? '__default' : (e.outcome ?? '')" [disabled]="readonly()" (change)="setOutcome($any($event.target).value)">
            <option value="">{{ 'workflow_engine.designer.choose_outcome' | translate }}</option>
            @for (outcome of offered(); track outcome.id) {
              <option [value]="outcome.id" [selected]="!e.default && outcome.id === e.outcome" [disabled]="outcome.taken && outcome.id !== e.outcome">
                {{ outcome.label }}{{ outcome.taken && outcome.id !== e.outcome ? ' · ' + ('workflow_engine.designer.already_routed' | translate) : '' }}
              </option>
            }
            <option value="__default" [selected]="!!e.default">{{ 'workflow_engine.designer.any_other_outcome' | translate }}</option>
          </select>
        </div>
      </section>
    }

    @if (fromCondition()) {
      <section class="insp-section">
        <h4 class="insp-section__title">{{ 'workflow_engine.designer.branch_rule' | translate }}</h4>
        <label class="insp-check">
          <input type="checkbox" [checked]="!!e.default" [disabled]="readonly()" (change)="setDefault($any($event.target).checked)" />
          {{ 'workflow_engine.designer.default_branch' | translate }}
        </label>
        <p class="insp-hint">{{ 'workflow_engine.designer.default_hint' | translate }}</p>
        @if (!e.default) {
          <app-workflow-condition-editor [value]="e.condition" [variables]="catalogs.availableVariables()" [readonly]="readonly()"
            (valueChange)="setCondition($event)" />
        }
      </section>
    }

    @if (e.waypoints?.length) {
      <section class="insp-section">
        <h4 class="insp-section__title">{{ 'workflow_engine.designer.route' | translate }}</h4>
        <p class="insp-hint">{{ 'workflow_engine.designer.waypoints' | vxPluralKey: e.waypoints!.length | translate: { count: e.waypoints!.length } }}</p>
        @if (!readonly()) {
          <button type="button" class="insp-secondary" (click)="store.setWaypoints(e.id, [])">{{ 'workflow_engine.designer.straighten' | translate }}</button>
        }
      </section>
    } @else if (!readonly()) {
      <p class="insp-hint">{{ 'workflow_engine.designer.waypoints_hint' | translate }}</p>
    }
  `,
  styles: [
    `
      .insp-path {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
        color: var(--content-tertiary);
      }
      .insp-issue {
        display: flex;
        gap: var(--space-2);
        align-items: flex-start;
        font-size: var(--text-sm);
        color: var(--warning-text);
      }
      .insp-issue--error {
        color: var(--error-text);
      }
    `,
  ],
})
export class EdgePanelComponent {
  protected readonly store = inject(DesignerStore);
  protected readonly catalogs = inject(DesignerCatalogs);
  private readonly translate = inject(TranslateService);

  readonly edge = input.required<WorkflowGraphEdge>();
  readonly readonly = input(false);
  readonly issues = input<WorkflowIssue[]>([]);

  protected readonly TrashIcon = Trash2;
  protected readonly ArrowIcon = ArrowRight;
  protected readonly EdgeIcon = Spline;
  protected readonly ErrorIcon = CircleAlert;
  protected readonly WarnIcon = AlertTriangle;

  readonly source = computed(() => this.store.nodeById().get(this.edge().from));
  readonly fromCondition = computed(() => this.source()?.type === 'condition');

  readonly offered = computed(() => {
    const source = this.source();
    const siblings = this.store.edges().filter((e) => e.from === this.edge().from);
    const taken = new Set(siblings.map((e) => e.outcome).filter(Boolean));
    return outcomesOf(source, this.catalogs.actions()).map((id) => ({
      id,
      label: outcomeLabel(this.translate, id, source?.config?.outcomeLabels),
      taken: taken.has(id),
    }));
  });

  message(issue: WorkflowIssue): string {
    return issueMessage(this.translate, issue, (id) => this.nameOf(id));
  }

  nameOf(id: string): string {
    const node = this.store.nodeById().get(id);
    return node?.name || (node ? this.translate.instant(nodeTypeKey(node.type)) : '—');
  }

  setOutcome(value: string): void {
    if (value === '__default') this.store.patchEdge(this.edge().id, { outcome: undefined, default: true });
    else this.store.patchEdge(this.edge().id, { outcome: value || undefined, default: undefined });
  }

  setDefault(isDefault: boolean): void {
    this.store.patchEdge(this.edge().id, isDefault ? { default: true, condition: undefined } : { default: undefined });
  }

  setCondition(condition: WorkflowPredicate | undefined): void {
    this.store.patchEdge(this.edge().id, { condition }, 'condition');
  }
}
