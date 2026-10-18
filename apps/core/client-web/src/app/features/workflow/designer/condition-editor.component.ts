import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { composeKey } from '@virteex/shared/types';
import { LucideAngularModule, Plus, Trash2, ListPlus } from 'lucide-angular';
import { PREDICATE_OPS, PredicateOp, UNARY_OPS, WorkflowPredicate } from '../data/workflow.service';

/** A variable the author can compare against, with its type driving the operator and value inputs. */
export interface ConditionVariable {
  name: string;
  label: string;
  type: string;
}

interface Leaf {
  kind: 'leaf';
  id: number;
  var: string;
  op: PredicateOp;
  value: string;
  /** Typing a path by hand (a nested field such as `webhook.status`) instead of picking one. */
  custom?: boolean;
}

interface Group {
  kind: 'group';
  id: number;
  mode: 'all' | 'any';
  negate: boolean;
  items: Array<Leaf | Group>;
}

const MAX_DEPTH = 3;
const NUMERIC_OPS: PredicateOp[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'exists', 'not_exists'];
const TEXT_OPS: PredicateOp[] = ['eq', 'ne', 'contains', 'not_contains', 'starts_with', 'ends_with', 'in', 'nin', 'exists', 'not_exists'];
const BOOL_OPS: PredicateOp[] = ['truthy', 'falsy', 'exists', 'not_exists'];
const DATE_OPS: PredicateOp[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'exists', 'not_exists'];

let nextId = 1;

/**
 * Builds a condition as data: groups of comparisons combined with «all» or «any», nestable and
 * negatable, compiled to the same `WorkflowPredicate` the engine evaluates.
 *
 * The operator list and the value input follow the variable's type — a number offers «greater
 * than» and a number field, a date a date picker, a yes/no field no value at all — so a condition
 * the author can build is one the engine can evaluate. Lists (`in`) are typed comma-separated.
 */
@Component({
  selector: 'app-workflow-condition-editor',
  standalone: true,
  imports: [NgTemplateOutlet, TranslatePipe, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './condition-editor.component.scss',
  template: `
    <ng-template #groupTpl let-group let-depth="depth">
      <div class="ce-group" [class.ce-group--nested]="depth > 0" role="group">
        <div class="ce-group__head">
          <label class="ce-switch">
            <span class="sr-only">{{ 'workflow_engine.condition.combine' | translate }}</span>
            <select (change)="setMode(group, $any($event.target).value)" [disabled]="readonly()">
              <option value="all" [selected]="group.mode === 'all'">{{ 'workflow_engine.condition.all' | translate }}</option>
              <option value="any" [selected]="group.mode === 'any'">{{ 'workflow_engine.condition.any' | translate }}</option>
            </select>
          </label>
          <label class="ce-negate">
            <input type="checkbox" [checked]="group.negate" (change)="setNegate(group, $any($event.target).checked)" [disabled]="readonly()" />
            {{ 'workflow_engine.condition.negate' | translate }}
          </label>
          @if (depth > 0 && !readonly()) {
            <button type="button" class="ce-icon" (click)="remove(group)" [attr.aria-label]="'workflow_engine.condition.remove_group' | translate" [title]="'workflow_engine.condition.remove_group' | translate">
              <lucide-icon [img]="TrashIcon" [size]="14" />
            </button>
          }
        </div>

        @for (item of group.items; track item.id) {
          @if (item.kind === 'leaf') {
            <div class="ce-leaf" [class.ce-leaf--unknown]="!!item.var && !isKnown(item.var)">
              <div class="ce-leaf__row">
                @if (item.custom) {
                  <input
                    class="ce-leaf__var"
                    [attr.list]="listId"
                    [value]="item.var"
                    (input)="patch(item, { var: $any($event.target).value })"
                    [attr.aria-label]="'workflow_engine.field.variable' | translate"
                    [placeholder]="'workflow_engine.condition.custom_variable_placeholder' | translate"
                    [disabled]="readonly()"
                  />
                } @else {
                  <select class="ce-leaf__var" (change)="chooseVariable(item, $any($event.target).value)" [attr.aria-label]="'workflow_engine.field.variable' | translate" [disabled]="readonly()">
                    @if (!item.var) {
                      <option value="" selected disabled>{{ 'workflow_engine.condition.choose_variable' | translate }}</option>
                    }
                    @for (variable of variables(); track variable.name) {
                      <option [value]="variable.name" [selected]="variable.name === item.var">{{ variable.label }}</option>
                    }
                    @if (item.var && !isKnown(item.var)) {
                      <option [value]="item.var" selected>{{ 'workflow_engine.condition.unknown_variable' | translate: { name: item.var } }}</option>
                    }
                    <option value="__custom">{{ 'workflow_engine.condition.custom_variable' | translate }}</option>
                  </select>
                }
                @if (!readonly()) {
                  <button type="button" class="ce-icon" (click)="remove(item)" [attr.aria-label]="'workflow_engine.condition.remove' | translate" [title]="'workflow_engine.condition.remove' | translate">
                    <lucide-icon [img]="TrashIcon" [size]="14" />
                  </button>
                }
              </div>
              <div class="ce-leaf__row">
                <select class="ce-leaf__op" (change)="patch(item, { op: $any($event.target).value })" [attr.aria-label]="'workflow_engine.condition.operator' | translate" [disabled]="readonly()">
                  @for (op of opsFor(item); track op) {
                    <option [value]="op" [selected]="op === item.op">{{ opKey(op) | translate }}</option>
                  }
                </select>
                @if (!isUnary(item.op)) {
                  @switch (inputType(item)) {
                    @case ('boolean') {
                      <select class="ce-leaf__value" (change)="patch(item, { value: $any($event.target).value })" [disabled]="readonly()">
                        <option value="true" [selected]="item.value === 'true'">{{ 'workflow_engine.common.yes' | translate }}</option>
                        <option value="false" [selected]="item.value === 'false'">{{ 'workflow_engine.common.no' | translate }}</option>
                      </select>
                    }
                    @default {
                      <input
                        class="ce-leaf__value"
                        [type]="inputType(item)"
                        [value]="item.value"
                        (input)="patch(item, { value: $any($event.target).value })"
                        [attr.aria-label]="'workflow_engine.field.value' | translate"
                        [placeholder]="(isList(item.op) ? 'workflow_engine.condition.list_placeholder' : 'workflow_engine.field.value') | translate"
                        [disabled]="readonly()"
                      />
                    }
                  }
                }
              </div>
              @if (item.var && !isKnown(item.var)) {
                <p class="ce-leaf__warning" role="alert">{{ 'workflow_engine.condition.unknown_variable_hint' | translate: { name: item.var } }}</p>
              }
            </div>
          } @else {
            <ng-container *ngTemplateOutlet="groupTpl; context: { $implicit: item, depth: depth + 1 }" />
          }
        }

        @if (!readonly()) {
          <div class="ce-group__add">
            <button type="button" class="ce-add" (click)="addLeaf(group)">
              <lucide-icon [img]="PlusIcon" [size]="14" /> {{ 'workflow_engine.condition.add' | translate }}
            </button>
            @if (depth < maxDepth - 1) {
              <button type="button" class="ce-add" (click)="addGroup(group)">
                <lucide-icon [img]="GroupIcon" [size]="14" /> {{ 'workflow_engine.condition.add_group' | translate }}
              </button>
            }
          </div>
        }
      </div>
    </ng-template>

    <datalist [id]="listId">
      @for (variable of variables(); track variable.name) {
        <option [value]="variable.name">{{ variable.label }}</option>
      }
    </datalist>

    <ng-container *ngTemplateOutlet="groupTpl; context: { $implicit: root(), depth: 0 }" />
  `,
})
export class ConditionEditorComponent {
  readonly value = input<WorkflowPredicate | undefined>(undefined);
  readonly variables = input<ConditionVariable[]>([]);
  readonly readonly = input(false);
  readonly valueChange = output<WorkflowPredicate | undefined>();

  protected readonly PlusIcon = Plus;
  protected readonly TrashIcon = Trash2;
  protected readonly GroupIcon = ListPlus;
  protected readonly maxDepth = MAX_DEPTH;
  protected readonly listId = `wf-cond-vars-${nextId++}`;

  readonly root = signal<Group>(emptyGroup());
  private lastEmitted: string | null = null;
  private readonly typeOf = computed(() => new Map(this.variables().map((v) => [v.name, v.type])));

  constructor() {
    // Rebuild the editable tree only when the value changes from outside, not on our own echo.
    effect(() => {
      const value = this.value();
      const serialized = JSON.stringify(value ?? null);
      if (serialized === this.lastEmitted) return;
      this.root.set(toGroup(value));
    });
  }

  isKnown(name: string): boolean {
    const root = name.split('.')[0];
    return this.typeOf().has(name) || this.typeOf().has(root);
  }

  chooseVariable(leaf: Leaf, value: string): void {
    if (value === '__custom') {
      leaf.custom = true;
      this.root.set({ ...this.root() });
      return;
    }
    this.patch(leaf, { var: value });
  }

  opKey(op: PredicateOp): string {
    return composeKey('workflow_engine.op', op);
  }

  isUnary(op: PredicateOp): boolean {
    return UNARY_OPS.has(op);
  }

  isList(op: PredicateOp): boolean {
    return op === 'in' || op === 'nin';
  }

  opsFor(leaf: Leaf): readonly PredicateOp[] {
    switch (this.typeOf().get(leaf.var)) {
      case 'number':
        return NUMERIC_OPS;
      case 'boolean':
        return BOOL_OPS;
      case 'date':
        return DATE_OPS;
      case 'string':
      case 'text':
      case 'select':
      case 'user':
        return TEXT_OPS;
      default:
        return PREDICATE_OPS;
    }
  }

  inputType(leaf: Leaf): 'number' | 'date' | 'text' | 'boolean' {
    if (this.isList(leaf.op)) return 'text';
    const type = this.typeOf().get(leaf.var);
    if (type === 'number') return 'number';
    if (type === 'date') return 'date';
    if (type === 'boolean') return 'boolean';
    return 'text';
  }

  setMode(group: Group, mode: 'all' | 'any'): void {
    group.mode = mode;
    this.emit();
  }

  setNegate(group: Group, negate: boolean): void {
    group.negate = negate;
    this.emit();
  }

  patch(leaf: Leaf, patch: Partial<Leaf>): void {
    Object.assign(leaf, patch);
    if (patch.var !== undefined && !this.opsFor(leaf).includes(leaf.op)) leaf.op = this.opsFor(leaf)[0];
    this.root.set({ ...this.root() });
    this.emit();
  }

  addLeaf(group: Group): void {
    const first = this.variables()[0];
    group.items.push({ kind: 'leaf', id: nextId++, var: first?.name ?? '', op: first?.type === 'boolean' ? 'truthy' : 'eq', value: '' });
    this.root.set({ ...this.root() });
    this.emit();
  }

  addGroup(group: Group): void {
    group.items.push({ ...emptyGroup(), mode: group.mode === 'all' ? 'any' : 'all' });
    this.root.set({ ...this.root() });
    this.emit();
  }

  remove(target: Leaf | Group): void {
    const walk = (group: Group): boolean => {
      const index = group.items.indexOf(target);
      if (index >= 0) {
        group.items.splice(index, 1);
        return true;
      }
      return group.items.some((item) => item.kind === 'group' && walk(item));
    };
    walk(this.root());
    this.root.set({ ...this.root() });
    this.emit();
  }

  private emit(): void {
    const predicate = fromGroup(this.root(), this.typeOf());
    this.lastEmitted = JSON.stringify(predicate ?? null);
    this.valueChange.emit(predicate);
  }
}

function emptyGroup(): Group {
  return { kind: 'group', id: nextId++, mode: 'all', negate: false, items: [] };
}

function toGroup(predicate: WorkflowPredicate | undefined): Group {
  if (!predicate) return emptyGroup();
  const node = toItem(predicate, 0);
  return node.kind === 'group' ? node : { ...emptyGroup(), items: [node] };
}

function toItem(predicate: WorkflowPredicate, depth: number): Leaf | Group {
  if ('not' in predicate) {
    const inner = toItem(predicate.not, depth);
    if (inner.kind === 'group') return { ...inner, negate: !inner.negate };
    return { ...emptyGroup(), negate: true, items: [inner] };
  }
  if ('all' in predicate || 'any' in predicate) {
    const mode = 'all' in predicate ? 'all' : 'any';
    const items = ('all' in predicate ? predicate.all : predicate.any) ?? [];
    return { kind: 'group', id: nextId++, mode, negate: false, items: depth >= MAX_DEPTH ? [] : items.map((item) => toItem(item, depth + 1)) };
  }
  return {
    kind: 'leaf',
    id: nextId++,
    var: predicate.var,
    op: predicate.op,
    value: Array.isArray(predicate.value) ? predicate.value.join(', ') : predicate.value === undefined || predicate.value === null ? '' : String(predicate.value),
  };
}

function fromGroup(group: Group, types: Map<string, string>): WorkflowPredicate | undefined {
  const items = group.items
    .map((item) => (item.kind === 'leaf' ? fromLeaf(item, types) : fromGroup(item, types)))
    .filter((item): item is WorkflowPredicate => !!item);
  if (!items.length) return undefined;
  const combined: WorkflowPredicate = group.mode === 'all' ? { all: items } : { any: items };
  return group.negate ? { not: combined } : combined;
}

function fromLeaf(leaf: Leaf, types: Map<string, string>): WorkflowPredicate | undefined {
  const name = leaf.var.trim();
  if (!name) return undefined;
  if (UNARY_OPS.has(leaf.op)) return { var: name, op: leaf.op };
  const type = types.get(name);
  const coerce = (raw: string): unknown => {
    const text = raw.trim();
    if (type === 'number' || (!type && /^-?\d+(\.\d+)?$/.test(text))) {
      const n = Number(text.replace(',', '.'));
      return Number.isFinite(n) ? n : text;
    }
    if (type === 'boolean' || (!type && (text === 'true' || text === 'false'))) return text === 'true';
    return text;
  };
  if (leaf.op === 'in' || leaf.op === 'nin') {
    const list = leaf.value.split(',').map((v) => v.trim()).filter(Boolean).map(coerce);
    return { var: name, op: leaf.op, value: list };
  }
  return { var: name, op: leaf.op, value: coerce(leaf.value) };
}

export const __testing = { toGroup, fromGroup };
