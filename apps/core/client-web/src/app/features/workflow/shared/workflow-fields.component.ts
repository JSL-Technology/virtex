import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { Observable, map, of } from 'rxjs';
import { VX_SELECT } from '../../../shared/components/select';
import { WorkflowService, WorkflowVariable } from '../data/workflow.service';

interface Person {
  id: string;
  name: string;
  email: string;
}

/** Problems a set of values has against its fields: `{ field: messageKey }`. */
export function fieldProblems(fields: readonly WorkflowVariable[], values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.name];
    const empty = value === undefined || value === null || value === '';
    if (field.required && empty && field.type !== 'boolean') out[field.name] = 'workflow_engine.form.required';
    else if (!empty && field.type === 'number' && !Number.isFinite(Number(value))) out[field.name] = 'workflow_engine.form.number';
    else if (!empty && field.type === 'select' && field.options?.length && !field.options.includes(String(value))) out[field.name] = 'workflow_engine.form.option';
  }
  return out;
}

/**
 * A form drawn from a list of typed fields — the variables a process asks for when it starts, or
 * the fields a task asks its assignee to fill in. Each type gets its own control (a number field,
 * a date picker, a yes/no box, a list, a person picker), so what is typed is what the engine
 * expects, and required fields say so before the server has to.
 */
@Component({
  selector: 'app-workflow-fields',
  standalone: true,
  imports: [FormsModule, TranslateModule, ...VX_SELECT, ...VX_FORM_A11Y],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (field of fields(); track field.name) {
      <div class="wff" [class.wff--check]="field.type === 'boolean'">
        @if (field.type === 'boolean') {
          <label class="wff__check">
            <input type="checkbox" [checked]="!!value()[field.name]" [disabled]="readonly()" (change)="set(field, $any($event.target).checked)" />
            {{ labelOf(field) }}
          </label>
        } @else {
          <label class="wff__label" [attr.for]="idFor(field)">
            {{ labelOf(field) }}
            @if (field.required) {
              <span class="wff__required" aria-hidden="true">*</span>
            }
          </label>
          @switch (field.type) {
            @case ('text') {
              <textarea [id]="idFor(field)" rows="3" maxlength="4000" [value]="text(field)" [readOnly]="readonly()"
                [attr.aria-required]="field.required || null" [attr.aria-invalid]="showProblem(field) || null" [attr.aria-describedby]="showProblem(field) ? idFor(field) + '-err' : null"
                (input)="set(field, $any($event.target).value)"></textarea>
            }
            @case ('number') {
              <input [id]="idFor(field)" type="number" inputmode="decimal" [value]="text(field)" [readOnly]="readonly()"
                [attr.aria-required]="field.required || null" [attr.aria-invalid]="showProblem(field) || null" [attr.aria-describedby]="showProblem(field) ? idFor(field) + '-err' : null"
                (input)="setNumber(field, $any($event.target).value)" />
            }
            @case ('date') {
              <input [id]="idFor(field)" type="date" [value]="text(field)" [readOnly]="readonly()"
                [attr.aria-required]="field.required || null" [attr.aria-invalid]="showProblem(field) || null" [attr.aria-describedby]="showProblem(field) ? idFor(field) + '-err' : null"
                (input)="set(field, $any($event.target).value)" />
            }
            @case ('select') {
              <select [id]="idFor(field)" [value]="text(field)" [disabled]="readonly()" [attr.aria-required]="field.required || null"
                [attr.aria-invalid]="showProblem(field) || null" (change)="set(field, $any($event.target).value)">
                <option value="">—</option>
                @for (option of field.options ?? []; track option) {
                  <option [value]="option">{{ option }}</option>
                }
              </select>
            }
            @case ('user') {
              <vx-select [inputId]="idFor(field)" [ngModel]="value()[field.name] ?? null" (ngModelChange)="set(field, $event)" [disabled]="readonly()"
                [search]="searchPeople" [resolveWith]="resolvePerson" [displayWith]="personName" [describeWith]="personEmail" [valueWith]="personId"
                [required]="!!field.required" />
            }
            @default {
              <input [id]="idFor(field)" type="text" maxlength="500" [value]="text(field)" [readOnly]="readonly()"
                [attr.aria-required]="field.required || null" [attr.aria-invalid]="showProblem(field) || null" [attr.aria-describedby]="showProblem(field) ? idFor(field) + '-err' : null"
                (input)="set(field, $any($event.target).value)" />
            }
          }
        }
        @if (field.description) {
          <p class="wff__hint">{{ field.description }}</p>
        }
        @if (showProblem(field)) {
          <p class="wff__error" [id]="idFor(field) + '-err'" role="alert">{{ problems()[field.name] | translate }}</p>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
      .wff {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
      }
      .wff__label {
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        color: var(--content-secondary);
      }
      .wff__required {
        color: var(--error-text);
        margin-inline-start: 2px;
      }
      .wff input:not([type='checkbox']),
      .wff select,
      .wff textarea {
        width: 100%;
        min-height: var(--control-height-md);
        padding: var(--space-2) var(--control-padding-x);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--surface-base);
        color: var(--content-primary);
        font: inherit;
        font-size: var(--text-sm);
        box-sizing: border-box;
      }
      .wff input[aria-invalid='true'],
      .wff textarea[aria-invalid='true'],
      .wff select[aria-invalid='true'] {
        border-color: var(--error-solid);
      }
      .wff__check {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-sm);
        color: var(--content-primary);
      }
      .wff__hint {
        margin: 0;
        font-size: var(--text-xs);
        color: var(--content-tertiary);
      }
      .wff__error {
        margin: 0;
        font-size: var(--text-xs);
        color: var(--error-text);
      }
    `,
  ],
})
export class WorkflowFieldsComponent {
  private readonly service = inject(WorkflowService);

  readonly fields = input<WorkflowVariable[]>([]);
  readonly value = input<Record<string, unknown>>({});
  readonly readonly = input(false);
  /** Errors show once the reader tried to submit, not while they are still typing the first field. */
  readonly submitted = input(false);
  readonly idPrefix = input('wf-field');
  readonly valueChange = output<Record<string, unknown>>();

  readonly problems = computed(() => fieldProblems(this.fields(), this.value()));

  private readonly known = new Map<string, Person>();

  protected readonly personName = (p: Person) => p.name;
  protected readonly personEmail = (p: Person) => p.email;
  protected readonly personId = (p: Person) => p.id;

  protected readonly searchPeople = (query: string): Observable<Person[]> =>
    this.service.people(query).pipe(
      map((people) => {
        for (const person of people) this.known.set(person.id, person);
        return people;
      }),
    );

  protected readonly resolvePerson = (id: string): Observable<Person | null> => {
    const known = this.known.get(id);
    if (known) return of(known);
    return this.service.people(undefined, [id]).pipe(map((people) => people[0] ?? null));
  };

  labelOf(field: WorkflowVariable): string {
    return field.label?.trim() || field.name;
  }

  idFor(field: WorkflowVariable): string {
    return `${this.idPrefix()}-${field.name.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  }

  text(field: WorkflowVariable): string {
    const value = this.value()[field.name];
    return value === undefined || value === null ? '' : String(value);
  }

  showProblem(field: WorkflowVariable): boolean {
    return this.submitted() && !!this.problems()[field.name];
  }

  set(field: WorkflowVariable, raw: unknown): void {
    const next = { ...this.value() };
    if (raw === undefined || raw === null || raw === '') delete next[field.name];
    else next[field.name] = raw;
    this.valueChange.emit(next);
  }

  setNumber(field: WorkflowVariable, raw: string): void {
    this.set(field, raw === '' ? undefined : Number(raw));
  }
}
