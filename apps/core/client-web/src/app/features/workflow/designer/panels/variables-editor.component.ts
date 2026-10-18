import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { composeKey } from '@virteex/shared/types';
import { LucideAngularModule, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-angular';
import { VARIABLE_TYPES, WorkflowVariable, WorkflowVariableType } from '../../data/workflow.service';

/** Same rule the server validates with: an identifier, optionally dotted. */
export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,4}$/;

/**
 * Edits a list of typed fields — a process's declared variables or a task's form.
 *
 * Each row is a technical name (what conditions and templates reference), a label (what people
 * read), a type, whether it is required and, for a list, its options. Problems are shown on the row
 * as they are typed — an invalid or repeated name — so the author fixes them before the server
 * rejects the save.
 */
@Component({
  selector: 'app-workflow-variables-editor',
  standalone: true,
  imports: [TranslatePipe, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './inspector.scss',
  template: `
    <ul class="insp-list">
      @for (variable of value(); track $index; let i = $index; let first = $first; let last = $last) {
        <li class="insp-card">
          <div class="insp-card__head">
            <span class="insp-mono">{{ variable.name || '—' }}</span>
            @if (!readonly()) {
              <button type="button" class="insp-icon" [disabled]="first" (click)="move(i, -1)"
                [attr.aria-label]="'workflow_engine.variables.move_up' | translate" [title]="'workflow_engine.variables.move_up' | translate">
                <lucide-icon [img]="UpIcon" [size]="14" />
              </button>
              <button type="button" class="insp-icon" [disabled]="last" (click)="move(i, 1)"
                [attr.aria-label]="'workflow_engine.variables.move_down' | translate" [title]="'workflow_engine.variables.move_down' | translate">
                <lucide-icon [img]="DownIcon" [size]="14" />
              </button>
              <button type="button" class="insp-icon" (click)="remove(i)"
                [attr.aria-label]="'workflow_engine.variables.remove' | translate" [title]="'workflow_engine.variables.remove' | translate">
                <lucide-icon [img]="TrashIcon" [size]="14" />
              </button>
            }
          </div>
          <div class="insp-row">
            <div class="insp-field">
              <label [attr.for]="idFor(i, 'label')">{{ 'workflow_engine.variables.label' | translate }}</label>
              <input [id]="idFor(i, 'label')" type="text" maxlength="120" [value]="variable.label ?? ''" [readOnly]="readonly()"
                (input)="setLabel(i, $any($event.target).value)" />
            </div>
            <div class="insp-field">
              <label [attr.for]="idFor(i, 'name')">{{ 'workflow_engine.variables.name' | translate }}</label>
              <input [id]="idFor(i, 'name')" type="text" maxlength="64" spellcheck="false" autocomplete="off" [value]="variable.name" [readOnly]="readonly()"
                [attr.aria-invalid]="!!problems()[i] || null" [attr.aria-describedby]="problems()[i] ? idFor(i, 'err') : null"
                (input)="patch(i, { name: $any($event.target).value.trim() }, 'name')" />
            </div>
          </div>
          @if (problems()[i]; as problem) {
            <p class="insp-error" [id]="idFor(i, 'err')" role="alert">{{ problem | translate }}</p>
          }
          <div class="insp-row">
            <div class="insp-field">
              <label [attr.for]="idFor(i, 'type')">{{ 'workflow_engine.variables.type' | translate }}</label>
              <select [id]="idFor(i, 'type')" [value]="variable.type" [disabled]="readonly()" (change)="setType(i, $any($event.target).value)">
                @for (type of types; track type) {
                  <option [value]="type" [selected]="type === variable.type">{{ typeKey(type) | translate }}</option>
                }
              </select>
            </div>
            <div class="insp-field">
              <span class="insp-label" aria-hidden="true">&nbsp;</span>
              <label class="insp-check">
                <input type="checkbox" [checked]="!!variable.required" [disabled]="readonly()" (change)="patch(i, { required: $any($event.target).checked || undefined })" />
                {{ 'workflow_engine.variables.required' | translate }}
              </label>
            </div>
          </div>
          @if (variable.type === 'number') {
            <div class="insp-row">
              <div class="insp-field">
                <label [attr.for]="idFor(i, 'min')">{{ 'workflow_engine.variables.min' | translate }}</label>
                <input [id]="idFor(i, 'min')" type="number" [value]="variable.min ?? ''" [readOnly]="readonly()"
                  (change)="patch(i, { min: toNumber($any($event.target).value) })" />
              </div>
              <div class="insp-field">
                <label [attr.for]="idFor(i, 'max')">{{ 'workflow_engine.variables.max' | translate }}</label>
                <input [id]="idFor(i, 'max')" type="number" [value]="variable.max ?? ''" [readOnly]="readonly()"
                  (change)="patch(i, { max: toNumber($any($event.target).value) })" />
              </div>
            </div>
          }
          @if (variable.type === 'select') {
            <div class="insp-field">
              <label [attr.for]="idFor(i, 'options')">{{ 'workflow_engine.variables.options' | translate }}</label>
              <input [id]="idFor(i, 'options')" type="text" [value]="(variable.options ?? []).join(', ')" [readOnly]="readonly()"
                (change)="setOptions(i, $any($event.target).value)" />
              <p class="insp-hint">{{ 'workflow_engine.variables.options_hint' | translate }}</p>
            </div>
          }
        </li>
      } @empty {
        <li class="insp-empty">{{ emptyKey() | translate }}</li>
      }
    </ul>
    @if (!readonly()) {
      <button type="button" class="insp-add" (click)="add()">
        <lucide-icon [img]="PlusIcon" [size]="14" />
        {{ addKey() | translate }}
      </button>
    }
  `,
})
export class VariablesEditorComponent {
  readonly value = input<WorkflowVariable[]>([]);
  readonly readonly = input(false);
  /** Distinguishes field ids when two editors are on screen. */
  readonly idPrefix = input('var');
  readonly addKey = input('workflow_engine.variables.add');
  readonly emptyKey = input('workflow_engine.variables.empty');
  readonly valueChange = output<{ value: WorkflowVariable[]; coalesce?: string }>();

  protected readonly types = VARIABLE_TYPES;
  protected readonly PlusIcon = Plus;
  protected readonly TrashIcon = Trash2;
  protected readonly UpIcon = ChevronUp;
  protected readonly DownIcon = ChevronDown;

  /** A problem key per row, or null. */
  readonly problems = computed(() => {
    const seen = new Map<string, number>();
    return this.value().map((variable, index) => {
      if (!variable.name) return 'workflow_engine.variables.error_required';
      if (!VARIABLE_NAME.test(variable.name)) return 'workflow_engine.variables.error_name';
      const previous = seen.get(variable.name);
      seen.set(variable.name, index);
      if (previous !== undefined) return 'workflow_engine.variables.error_duplicate';
      if (variable.type === 'select' && !variable.options?.length) return 'workflow_engine.variables.error_options';
      if (variable.min !== undefined && variable.max !== undefined && variable.min > variable.max) return 'workflow_engine.variables.error_range';
      return null;
    });
  });

  typeKey(type: WorkflowVariableType): string {
    return composeKey('workflow_engine.variable_type', type);
  }

  idFor(index: number, field: string): string {
    return `${this.idPrefix()}-${index}-${field}`;
  }

  add(): void {
    const names = new Set(this.value().map((v) => v.name));
    let n = this.value().length + 1;
    while (names.has(`dato${n}`)) n++;
    this.emit([...this.value(), { name: `dato${n}`, label: '', type: 'string' }]);
  }

  /**
   * Typing the label derives the technical name («Monto aprobado» → `monto_aprobado`) for as long
   * as the author has not written one of their own; after that their name is left alone.
   */
  setLabel(index: number, label: string): void {
    const current = this.value()[index];
    const derivedBefore = /^dato\d+$/.test(current.name) || current.name === technicalName(current.label ?? '');
    const patch: Partial<WorkflowVariable> = { label };
    if (derivedBefore) {
      const others = new Set(this.value().filter((_, i) => i !== index).map((v) => v.name));
      let candidate = technicalName(label) || current.name;
      for (let n = 2; others.has(candidate); n += 1) candidate = `${technicalName(label)}_${n}`;
      patch.name = candidate;
    }
    this.patch(index, patch, 'label');
  }

  remove(index: number): void {
    this.emit(this.value().filter((_, i) => i !== index));
  }

  move(index: number, delta: number): void {
    const list = [...this.value()];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    this.emit(list);
  }

  patch(index: number, patch: Partial<WorkflowVariable>, coalesce?: string): void {
    this.emit(
      this.value().map((variable, i) => (i === index ? stripEmpty({ ...variable, ...patch }) : variable)),
      coalesce ? `${index}:${coalesce}` : undefined,
    );
  }

  setType(index: number, type: WorkflowVariableType): void {
    this.patch(index, {
      type,
      options: type === 'select' ? this.value()[index].options ?? [] : undefined,
      min: type === 'number' ? this.value()[index].min : undefined,
      max: type === 'number' ? this.value()[index].max : undefined,
    });
  }

  toNumber(raw: string): number | undefined {
    if (raw === '' || raw === null || raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  setOptions(index: number, raw: string): void {
    const options = [...new Set(raw.split(',').map((o) => o.trim()).filter(Boolean))];
    this.patch(index, { options });
  }

  private emit(value: WorkflowVariable[], coalesce?: string): void {
    this.valueChange.emit({ value, coalesce });
  }
}

/** A label as a variable name: letters, digits and «_», starting with a letter. */
export function technicalName(label: string): string {
  const slug = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return /^[a-z_]/.test(slug) ? slug : slug ? `v_${slug}` : '';
}

function stripEmpty(variable: WorkflowVariable): WorkflowVariable {
  const out = { ...variable };
  if (!out.label) delete out.label;
  if (!out.required) delete out.required;
  if (out.type !== 'select') delete out.options;
  if (out.min === undefined || out.type !== 'number') delete out.min;
  if (out.max === undefined || out.type !== 'number') delete out.max;
  return out;
}
