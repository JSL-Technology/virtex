import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FormatService } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { AlertTriangle, Copy, CircleAlert, LucideAngularModule, Plus, Trash2, ArrowRight } from 'lucide-angular';
import { VX_SELECT } from '../../../../shared/components/select';
import { NODE_ICONS, issueMessage, nodeTypeKey, outcomeLabel } from '../../data/workflow-labels';
import { WorkflowGraphNode, WorkflowIssue, WorkflowNodeConfig, WorkflowVariable } from '../../data/workflow.service';
import { DesignerCatalogs, PersonOption, RoleOption } from '../designer-catalogs';
import { DesignerStore, outcomesOf } from '../designer-store';
import { summarizePredicate } from '../predicate-summary';
import { ActionParamsComponent } from './action-params.component';
import { VariablesEditorComponent } from './variables-editor.component';

const OUTCOME = /^[A-Za-z0-9_-]{1,64}$/;
type DurationUnit = 'minutes' | 'hours' | 'days';
const UNIT_MINUTES: Record<DurationUnit, number> = { minutes: 1, hours: 60, days: 1440 };

/**
 * Properties of the selected step.
 *
 * What it shows follows the step's type: who does a task and what they may answer; which automatic
 * action runs and with what; how long a timer waits; how a decision branches. Every change goes
 * through the designer store, so it is undoable and the canvas redraws at once. Problems the server
 * reported for this step are listed at the top, in the reader's language.
 */
@Component({
  selector: 'app-workflow-node-panel',
  standalone: true,
  imports: [FormsModule, TranslateModule, LucideAngularModule, ...VX_SELECT, ...VX_FORM_A11Y, ActionParamsComponent, VariablesEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './inspector.scss',
  template: `
    @let n = node();
    @let cfg = n.config ?? {};
    <header class="insp-head">
      <span class="insp-kind" aria-hidden="true"><lucide-icon [img]="icon()" [size]="16" /></span>
      <h3 [title]="n.name || (typeKey() | translate)">{{ n.name || (typeKey() | translate) }}</h3>
      @if (!readonly() && n.type !== 'start') {
        <button type="button" class="insp-icon" (click)="duplicate()" [attr.aria-label]="'workflow_engine.designer.duplicate' | translate" [title]="'workflow_engine.designer.duplicate' | translate">
          <lucide-icon [img]="CopyIcon" [size]="14" />
        </button>
        <button type="button" class="insp-icon" (click)="remove()" [attr.aria-label]="'workflow_engine.designer.delete_step' | translate" [title]="'workflow_engine.designer.delete_step' | translate">
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
      <h4 class="insp-section__title">{{ 'workflow_engine.designer.general' | translate }}</h4>
      <div class="insp-field">
        <span class="insp-label" id="node-type-label">{{ 'workflow_engine.field.type' | translate }}</span>
        <p class="insp-static" aria-labelledby="node-type-label">{{ typeKey() | translate }}</p>
      </div>
      <div class="insp-field">
        <label for="node-name">{{ 'workflow_engine.field.name' | translate }}</label>
        <input id="node-name" type="text" maxlength="120" [value]="n.name ?? ''" [readOnly]="readonly()"
          [placeholder]="typeKey() | translate" (input)="store.patchNode(n.id, { name: $any($event.target).value || undefined }, 'name')" />
      </div>
      <div class="insp-field">
        <label for="node-description">{{ 'workflow_engine.field.description' | translate }}</label>
        <textarea id="node-description" rows="2" maxlength="1000" [value]="n.description ?? ''" [readOnly]="readonly()"
          (input)="store.patchNode(n.id, { description: $any($event.target).value || undefined }, 'description')"></textarea>
      </div>
      @if (groups().length) {
        <div class="insp-field">
          <label for="node-lane">{{ 'workflow_engine.designer.lane' | translate }}</label>
          <select id="node-lane" [value]="n.parentId ?? ''" [disabled]="readonly()" (change)="store.setParent([n.id], $any($event.target).value || undefined)">
            <option value="">{{ 'workflow_engine.designer.no_lane' | translate }}</option>
            @for (group of groups(); track group.id) {
              <option [value]="group.id" [selected]="group.id === n.parentId">{{ group.name || ('workflow_engine.designer.lane' | translate) }}</option>
            }
          </select>
        </div>
      }
    </section>

    @if (n.type === 'task' || n.type === 'approval') {
      <section class="insp-section">
        <h4 class="insp-section__title">{{ 'workflow_engine.designer.responsible' | translate }}</h4>
        <div class="insp-segmented" role="group" [attr.aria-label]="'workflow_engine.designer.assign_to' | translate">
          <button type="button" [attr.aria-pressed]="assignMode() === 'role'" [disabled]="readonly()" (click)="setAssignMode('role')">
            {{ 'workflow_engine.designer.assign_role' | translate }}
          </button>
          <button type="button" [attr.aria-pressed]="assignMode() === 'user'" [disabled]="readonly()" (click)="setAssignMode('user')">
            {{ 'workflow_engine.designer.assign_user' | translate }}
          </button>
        </div>
        @if (assignMode() === 'role') {
          <div class="insp-field">
            <label for="node-role">{{ 'workflow_engine.field.role' | translate }}</label>
            <vx-select inputId="node-role" [ngModel]="cfg.assigneeRoleId ?? null" (ngModelChange)="setRole($event)" [disabled]="readonly()"
              [options]="catalogs.roles()" [displayWith]="roleLabel" [describeWith]="roleDescription" [disabledWith]="cannotAct" [valueWith]="roleId" />
            <p class="insp-hint">{{ 'workflow_engine.designer.role_hint' | translate }}</p>
            <p class="insp-hint">{{ 'workflow_engine.designer.can_act_hint' | translate }}</p>
          </div>
        } @else {
          <div class="insp-field">
            <label for="node-user">{{ 'workflow_engine.field.user' | translate }}</label>
            <vx-select inputId="node-user" [ngModel]="cfg.assigneeUserId ?? null" (ngModelChange)="setUser($event)" [disabled]="readonly()"
              [search]="catalogs.searchPeople" [resolveWith]="catalogs.resolvePerson" [displayWith]="personName" [describeWith]="personDescription" [disabledWith]="cannotAct" [valueWith]="personId" />
            <p class="insp-hint">{{ 'workflow_engine.designer.can_act_hint' | translate }}</p>
          </div>
        }
        <div class="insp-row">
          <div class="insp-field">
            <label for="node-due">{{ 'workflow_engine.field.due' | translate }}</label>
            <input id="node-due" type="number" min="0" step="1" [value]="dueAmount()" [readOnly]="readonly()" (input)="setDue($any($event.target).value, dueUnit())" />
          </div>
          <div class="insp-field">
            <label for="node-due-unit">{{ 'workflow_engine.designer.unit' | translate }}</label>
            <select id="node-due-unit" [value]="dueUnit()" [disabled]="readonly()" (change)="setDue(dueAmount(), $any($event.target).value)">
              <option value="hours">{{ 'workflow_engine.unit.hours' | translate }}</option>
              <option value="days">{{ 'workflow_engine.unit.days' | translate }}</option>
            </select>
          </div>
        </div>
        @if (cfg.dueInHours) {
          <div class="insp-field">
            <label for="node-escalate">{{ 'workflow_engine.field.escalate_to' | translate }}</label>
            <vx-select inputId="node-escalate" [ngModel]="cfg.escalateToUserId ?? null" (ngModelChange)="patch({ escalateToUserId: $event ?? undefined })" [disabled]="readonly()"
              [search]="catalogs.searchPeople" [resolveWith]="catalogs.resolvePerson" [displayWith]="personName" [describeWith]="personEmail" [valueWith]="personId" />
            <p class="insp-hint">{{ 'workflow_engine.designer.escalate_hint' | translate }}</p>
          </div>
        }
        <div class="insp-field">
          <label for="node-instructions">{{ 'workflow_engine.field.instructions' | translate }}</label>
          <textarea id="node-instructions" rows="3" maxlength="2000" [value]="cfg.instructions ?? ''" [readOnly]="readonly()"
            (input)="patch({ instructions: $any($event.target).value || undefined }, 'instructions')"></textarea>
          <p class="insp-hint">{{ 'workflow_engine.designer.templated_hint' | translate }}</p>
        </div>
      </section>

      <section class="insp-section">
        <h4 class="insp-section__title">{{ 'workflow_engine.designer.outcomes' | translate }}</h4>
        <ul class="insp-list">
          @for (outcome of outcomes(); track outcome) {
            <li class="insp-card">
              <div class="insp-card__head">
                <strong [title]="outcome">{{ cfg.outcomeLabels?.[outcome] || defaultOutcomeLabel(outcome) }}</strong>
                @if (targetOf(outcome); as target) {
                  <button type="button" class="insp-link" (click)="store.select({ edges: [target.edgeId] })">
                    <lucide-icon [img]="ArrowIcon" [size]="12" /> {{ target.name }}
                  </button>
                } @else {
                  <span class="insp-chip insp-chip--warn">{{ 'workflow_engine.designer.unrouted' | translate }}</span>
                }
                @if (!readonly() && outcomes().length > 1) {
                  <button type="button" class="insp-icon" (click)="removeOutcome(outcome)"
                    [attr.aria-label]="'workflow_engine.designer.remove_outcome' | translate" [title]="'workflow_engine.designer.remove_outcome' | translate">
                    <lucide-icon [img]="TrashIcon" [size]="14" />
                  </button>
                }
              </div>
              <div class="insp-field">
                <label [attr.for]="'outcome-label-' + outcome">{{ 'workflow_engine.designer.button_text' | translate }}</label>
                <input [id]="'outcome-label-' + outcome" type="text" maxlength="60" [value]="cfg.outcomeLabels?.[outcome] ?? ''" [readOnly]="readonly()"
                  [placeholder]="defaultOutcomeLabel(outcome)" (input)="setOutcomeLabel(outcome, $any($event.target).value)" />
              </div>
              <label class="insp-check">
                <input type="checkbox" [checked]="(cfg.commentRequiredFor ?? []).includes(outcome)" [disabled]="readonly()"
                  (change)="toggleComment(outcome, $any($event.target).checked)" />
                {{ 'workflow_engine.designer.comment_required' | translate }}
              </label>
            </li>
          }
        </ul>
        @if (!readonly()) {
          <form class="insp-row" (submit)="$event.preventDefault(); addOutcome()">
            <div class="insp-field">
              <label for="node-new-outcome" class="sr-only">{{ 'workflow_engine.designer.new_outcome' | translate }}</label>
              <input id="node-new-outcome" type="text" maxlength="60" [value]="newOutcome()" (input)="newOutcome.set($any($event.target).value)"
                [placeholder]="'workflow_engine.designer.new_outcome' | translate" [attr.aria-invalid]="!!outcomeError() || null" />
            </div>
            <button type="submit" class="insp-add" [disabled]="!newOutcome().trim()">
              <lucide-icon [img]="PlusIcon" [size]="14" /> {{ 'workflow_engine.designer.add_outcome' | translate }}
            </button>
          </form>
          @if (outcomeError()) {
            <p class="insp-error" role="alert">{{ outcomeError()! | translate }}</p>
          }
        }
      </section>

      <section class="insp-section">
        <h4 class="insp-section__title">{{ 'workflow_engine.designer.task_form' | translate }}</h4>
        <p class="insp-hint">{{ 'workflow_engine.designer.task_form_hint' | translate }}</p>
        <app-workflow-variables-editor [value]="cfg.form ?? []" [readonly]="readonly()" [idPrefix]="'form-' + n.id"
          addKey="workflow_engine.designer.add_field" emptyKey="workflow_engine.designer.no_fields"
          (valueChange)="setForm($event.value, $event.coalesce)" />
      </section>
    }

    @if (n.type === 'action') {
      <section class="insp-section">
        <h4 class="insp-section__title">{{ 'workflow_engine.designer.automation' | translate }}</h4>
        <div class="insp-field">
          <label for="node-action">{{ 'workflow_engine.field.action' | translate }}</label>
          <select id="node-action" [value]="cfg.action ?? ''" [disabled]="readonly()" (change)="setAction($any($event.target).value)">
            <option value="">{{ 'workflow_engine.designer.choose_action' | translate }}</option>
            @for (action of catalogs.actions(); track action.key) {
              <option [value]="action.key" [selected]="action.key === cfg.action">{{ action.labelKey | translate }}</option>
            }
          </select>
          @if (selectedAction()?.descriptionKey; as descriptionKey) {
            <p class="insp-hint">{{ descriptionKey | translate }}</p>
          }
        </div>
        @if (selectedAction(); as action) {
          <app-workflow-action-params [params]="action.params" [value]="cfg.actionParams ?? {}" [readonly]="readonly()" [idPrefix]="'param-' + n.id"
            (valueChange)="patch({ actionParams: $event.value }, $event.coalesce)" />
          @if (action.outcomes.length) {
            <p class="insp-hint">{{ 'workflow_engine.designer.action_outcomes' | translate: { outcomes: actionOutcomes() } }}</p>
          }
        }
      </section>
    }

    @if (n.type === 'timer') {
      <section class="insp-section">
        <h4 class="insp-section__title">{{ 'workflow_engine.designer.wait' | translate }}</h4>
        <div class="insp-segmented" role="group" [attr.aria-label]="'workflow_engine.designer.wait' | translate">
          <button type="button" [attr.aria-pressed]="!cfg.timerUntilVar" [disabled]="readonly()" (click)="patch({ timerUntilVar: undefined, timerMinutes: cfg.timerMinutes ?? 60 })">
            {{ 'workflow_engine.designer.wait_duration' | translate }}
          </button>
          <button type="button" [attr.aria-pressed]="!!cfg.timerUntilVar" [disabled]="readonly() || !dateVariables().length" (click)="patch({ timerUntilVar: dateVariables()[0]?.name, timerMinutes: undefined })">
            {{ 'workflow_engine.designer.wait_until' | translate }}
          </button>
        </div>
        @if (!cfg.timerUntilVar) {
          <div class="insp-row">
            <div class="insp-field">
              <label for="node-timer">{{ 'workflow_engine.field.timer' | translate }}</label>
              <input id="node-timer" type="number" min="1" step="1" [value]="timerAmount()" [readOnly]="readonly()" (input)="setTimer($any($event.target).value, timerUnit())" />
            </div>
            <div class="insp-field">
              <label for="node-timer-unit">{{ 'workflow_engine.designer.unit' | translate }}</label>
              <select id="node-timer-unit" [value]="timerUnit()" [disabled]="readonly()" (change)="setTimer(timerAmount(), $any($event.target).value)">
                <option value="minutes">{{ 'workflow_engine.unit.minutes' | translate }}</option>
                <option value="hours">{{ 'workflow_engine.unit.hours' | translate }}</option>
                <option value="days">{{ 'workflow_engine.unit.days' | translate }}</option>
              </select>
            </div>
          </div>
        } @else {
          <div class="insp-field">
            <label for="node-timer-var">{{ 'workflow_engine.designer.date_variable' | translate }}</label>
            <select id="node-timer-var" [value]="cfg.timerUntilVar" [disabled]="readonly()" (change)="patch({ timerUntilVar: $any($event.target).value })">
              @for (variable of dateVariables(); track variable.name) {
                <option [value]="variable.name" [selected]="variable.name === cfg.timerUntilVar">{{ variable.label }}</option>
              }
            </select>
          </div>
        }
      </section>
    }

    @if (n.type === 'condition') {
      <section class="insp-section">
        <h4 class="insp-section__title">{{ 'workflow_engine.designer.branches' | translate }}</h4>
        <p class="insp-hint">{{ 'workflow_engine.designer.branches_hint' | translate }}</p>
      </section>
    }

    @if (n.type !== 'end') {
      <section class="insp-section">
        <h4 class="insp-section__title">{{ 'workflow_engine.designer.next_steps' | translate }}</h4>
        <ul class="insp-list">
          @for (edge of outgoing(); track edge.id) {
            <li class="insp-card">
              <div class="insp-card__head">
                <button type="button" class="insp-link" (click)="store.select({ edges: [edge.id] })">
                  <lucide-icon [img]="ArrowIcon" [size]="12" /> {{ edge.targetName }}
                </button>
                @if (edge.badge) {
                  <span class="insp-chip">{{ edge.badge }}</span>
                }
              </div>
              @if (edge.summary) {
                <span class="insp-hint">{{ edge.summary }}</span>
              }
            </li>
          } @empty {
            <li class="insp-empty">{{ 'workflow_engine.designer.no_next' | translate }}</li>
          }
        </ul>
      </section>
    }

    <p class="insp-mono">ID {{ n.id }}</p>
  `,
  styles: [
    `
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
      .insp-chip--warn {
        border-color: var(--warning-border);
        color: var(--warning-text);
        background: var(--warning-surface);
      }
    `,
  ],
})
export class NodePanelComponent {
  protected readonly store = inject(DesignerStore);
  protected readonly catalogs = inject(DesignerCatalogs);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  readonly node = input.required<WorkflowGraphNode>();
  readonly readonly = input(false);
  readonly issues = input<WorkflowIssue[]>([]);

  protected readonly newOutcome = signal('');
  protected readonly outcomeError = signal<string | null>(null);
  /** Remembered so switching person ↔ role doesn't flip back while the field is still empty. */
  private readonly preferredMode = signal<'role' | 'user' | null>(null);

  protected readonly CopyIcon = Copy;
  protected readonly TrashIcon = Trash2;
  protected readonly PlusIcon = Plus;
  protected readonly ArrowIcon = ArrowRight;
  protected readonly ErrorIcon = CircleAlert;
  protected readonly WarnIcon = AlertTriangle;

  protected readonly personName = (p: PersonOption) => p.name;
  protected readonly personEmail = (p: PersonOption) => p.email;
  protected readonly personId = (p: PersonOption) => p.id;
  protected readonly roleLabel = (r: RoleOption) => r.label;
  /** Who can answer, at the moment of choosing: a role without the grant would stall every run. */
  protected readonly roleDescription = (r: RoleOption) =>
    r.canAct === false
      ? this.translate.instant('workflow_engine.designer.cannot_act')
      : this.translate.instant(`workflow_engine.designer.role_members.${this.format.pluralCategory(r.members ?? 0) === 'one' ? 'one' : 'other'}`, { count: r.members ?? 0 });
  protected readonly personDescription = (p: PersonOption) =>
    p.canAct === false ? `${p.email} · ${this.translate.instant('workflow_engine.designer.cannot_act')}` : p.email;
  protected readonly cannotAct = (option: RoleOption | PersonOption) => option.canAct === false;
  protected readonly roleId = (r: RoleOption) => r.id;

  readonly icon = computed(() => NODE_ICONS[this.node().type]);
  readonly typeKey = computed(() => nodeTypeKey(this.node().type));
  readonly groups = computed(() => this.store.groups());
  readonly outcomes = computed(() => outcomesOf(this.node(), this.catalogs.actions()));
  readonly selectedAction = computed(() => this.catalogs.action(this.node().config?.action));
  readonly actionOutcomes = computed(() => (this.selectedAction()?.outcomes ?? []).map((o) => outcomeLabel(this.translate, o)).join(', '));
  readonly dateVariables = computed(() => this.catalogs.availableVariables().filter((v) => v.type === 'date'));

  readonly assignMode = computed<'role' | 'user'>(() => {
    const cfg = this.node().config ?? {};
    if (cfg.assigneeUserId) return 'user';
    if (cfg.assigneeRoleId) return 'role';
    return this.preferredMode() ?? 'role';
  });

  readonly dueUnit = computed<'hours' | 'days'>(() => {
    const hours = this.node().config?.dueInHours;
    return hours && hours % 24 === 0 ? 'days' : 'hours';
  });
  readonly dueAmount = computed(() => {
    const hours = this.node().config?.dueInHours;
    if (!hours) return '';
    return String(this.dueUnit() === 'days' ? hours / 24 : hours);
  });

  readonly timerUnit = computed<DurationUnit>(() => {
    const minutes = this.node().config?.timerMinutes ?? 0;
    if (minutes && minutes % 1440 === 0) return 'days';
    if (minutes && minutes % 60 === 0) return 'hours';
    return 'minutes';
  });
  readonly timerAmount = computed(() => {
    const minutes = this.node().config?.timerMinutes;
    return minutes ? String(minutes / UNIT_MINUTES[this.timerUnit()]) : '';
  });

  readonly outgoing = computed(() => {
    const id = this.node().id;
    const names = this.store.nodeById();
    const labels = this.node().config?.outcomeLabels;
    const varLabel = new Map(this.catalogs.availableVariables().map((v) => [v.name, v.label]));
    return this.store
      .edges()
      .filter((edge) => edge.from === id)
      .map((edge) => {
        const target = names.get(edge.to);
        return {
          id: edge.id,
          targetName: target?.name || (target ? this.translate.instant(nodeTypeKey(target.type)) : '—'),
          badge: edge.outcome
            ? outcomeLabel(this.translate, edge.outcome, labels)
            : edge.default
              ? this.translate.instant('workflow_engine.designer.default_branch')
              : edge.label ?? '',
          summary: summarizePredicate(this.translate, edge.condition, (v) => varLabel.get(v) ?? v),
        };
      });
  });

  message(issue: WorkflowIssue): string {
    return issueMessage(this.translate, issue, () => this.node().name?.trim() || this.translate.instant(nodeTypeKey(this.node().type)));
  }

  defaultOutcomeLabel(outcome: string): string {
    return outcomeLabel(this.translate, outcome);
  }

  targetOf(outcome: string): { edgeId: string; name: string } | null {
    const edge = this.store.edges().find((e) => e.from === this.node().id && e.outcome === outcome);
    if (!edge) return null;
    const target = this.store.nodeById().get(edge.to);
    return { edgeId: edge.id, name: target?.name || (target ? this.translate.instant(nodeTypeKey(target.type)) : '—') };
  }

  patch(patch: Partial<WorkflowNodeConfig>, coalesce?: string): void {
    this.store.patchNodeConfig(this.node().id, patch, coalesce);
  }

  setAssignMode(mode: 'role' | 'user'): void {
    this.preferredMode.set(mode);
    // Switching clears the other side, so a task is never assigned to a role and a person at once.
    if (mode === 'role' && this.node().config?.assigneeUserId) this.patch({ assigneeUserId: undefined });
    if (mode === 'user' && this.node().config?.assigneeRoleId) this.patch({ assigneeRoleId: undefined });
  }

  setRole(id: string | null): void {
    this.patch({ assigneeRoleId: id ?? undefined, assigneeUserId: undefined });
  }

  setUser(id: string | null): void {
    this.patch({ assigneeUserId: id ?? undefined, assigneeRoleId: undefined });
  }

  setDue(raw: string, unit: 'hours' | 'days'): void {
    const amount = Number(raw);
    const hours = raw === '' || !Number.isFinite(amount) || amount <= 0 ? undefined : Math.round(unit === 'days' ? amount * 24 : amount);
    this.patch({ dueInHours: hours, ...(hours ? {} : { escalateToUserId: undefined }) }, 'due');
  }

  setTimer(raw: string, unit: DurationUnit): void {
    const amount = Number(raw);
    const minutes = raw === '' || !Number.isFinite(amount) || amount <= 0 ? undefined : Math.round(amount * UNIT_MINUTES[unit]);
    this.patch({ timerMinutes: minutes }, 'timer');
  }

  setAction(key: string): void {
    // Parameters belong to the action: changing it starts from its defaults, not the old values.
    const action = this.catalogs.action(key);
    const defaults = Object.fromEntries(
      (action?.params ?? []).filter((param) => param.defaultValue !== undefined).map((param) => [param.name, param.defaultValue]),
    );
    this.patch({ action: key || undefined, actionParams: Object.keys(defaults).length ? defaults : undefined });
  }

  setForm(form: WorkflowVariable[], coalesce?: string): void {
    this.patch({ form }, coalesce ? `form:${coalesce}` : undefined);
  }

  setOutcomeLabel(outcome: string, label: string): void {
    const labels = { ...(this.node().config?.outcomeLabels ?? {}) };
    if (label.trim()) labels[outcome] = label;
    else delete labels[outcome];
    this.patch({ outcomeLabels: Object.keys(labels).length ? labels : undefined }, `outcome-label:${outcome}`);
  }

  toggleComment(outcome: string, required: boolean): void {
    const current = new Set(this.node().config?.commentRequiredFor ?? []);
    if (required) current.add(outcome);
    else current.delete(outcome);
    this.patch({ commentRequiredFor: [...current] });
  }

  /**
   * The author types how the button should read («Pedir más información»); the outcome id is
   * derived from it («pedir_mas_informacion») and the typed text kept as its label.
   */
  addOutcome(): void {
    const label = this.newOutcome().trim();
    if (!label) return;
    const id = slug(label);
    if (!OUTCOME.test(id)) return this.outcomeError.set('workflow_engine.designer.outcome_invalid');
    if (this.outcomes().includes(id)) return this.outcomeError.set('workflow_engine.designer.outcome_duplicate');
    if (this.outcomes().length >= 10) return this.outcomeError.set('workflow_engine.designer.outcome_limit');
    const config = this.node().config ?? {};
    const labels = { ...(config.outcomeLabels ?? {}) };
    if (label !== id) labels[id] = label;
    this.patch({ outcomes: [...this.outcomes(), id], outcomeLabels: Object.keys(labels).length ? labels : undefined });
    this.newOutcome.set('');
    this.outcomeError.set(null);
  }

  /** Removing an outcome also unroutes the connection that carried it, in the same undo step. */
  removeOutcome(outcome: string): void {
    const id = this.node().id;
    this.store.commit((d) => ({
      ...d,
      nodes: d.nodes.map((node) => {
        if (node.id !== id) return node;
        const config = { ...(node.config ?? {}) };
        config.outcomes = this.outcomes().filter((o) => o !== outcome);
        if (config.outcomeLabels) {
          const { [outcome]: _removed, ...rest } = config.outcomeLabels;
          config.outcomeLabels = Object.keys(rest).length ? rest : undefined;
        }
        config.commentRequiredFor = config.commentRequiredFor?.filter((o) => o !== outcome);
        return { ...node, config };
      }),
      edges: d.edges.map((edge) => (edge.from === id && edge.outcome === outcome ? { ...edge, outcome: undefined } : edge)),
    }));
  }

  duplicate(): void {
    this.store.select({ nodes: [this.node().id] });
    this.store.duplicateSelection();
  }

  remove(): void {
    this.store.deleteItems({ nodes: [this.node().id] });
  }
}

function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}
