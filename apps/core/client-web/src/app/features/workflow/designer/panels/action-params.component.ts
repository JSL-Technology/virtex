import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VX_SELECT } from '../../../../shared/components/select';
import { WorkflowActionParam } from '../../data/workflow.service';
import { DesignerCatalogs, PersonOption } from '../designer-catalogs';

/**
 * The parameter form of an automatic step, drawn from the action's own schema.
 *
 * The server declares each action's parameters — name, type, whether required, options, whether it
 * accepts `{{variable}}` placeholders — and validates them at publish; this form renders that same
 * schema, so a new action registered on the server gets its form here without client changes.
 */
@Component({
  selector: 'app-workflow-action-params',
  standalone: true,
  imports: [FormsModule, TranslateModule, ...VX_SELECT, ...VX_FORM_A11Y],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './inspector.scss',
  template: `
    @for (param of params(); track param.name) {
      <div class="insp-field">
        @if (param.type === 'boolean') {
          <label class="insp-check">
            <input type="checkbox" [checked]="!!value()[param.name]" [disabled]="readonly()" (change)="set(param, $any($event.target).checked)" />
            {{ param.labelKey | translate }}
          </label>
        } @else {
          <label [attr.for]="idFor(param)">
            {{ param.labelKey | translate }}
            @if (param.required) {
              <span aria-hidden="true">*</span>
            }
          </label>
          @switch (param.type) {
            @case ('text') {
              <textarea [id]="idFor(param)" rows="3" [attr.maxlength]="param.maxLength ?? null" [value]="text(param)" [readOnly]="readonly()"
                [attr.aria-required]="param.required || null" [attr.aria-invalid]="missing(param) || null"
                (input)="set(param, $any($event.target).value, true)"></textarea>
            }
            @case ('json') {
              <textarea [id]="idFor(param)" rows="4" class="insp-mono" spellcheck="false" [value]="text(param)" [readOnly]="readonly()"
                [attr.aria-invalid]="!!jsonError(param) || null" (input)="set(param, $any($event.target).value, true)"></textarea>
              @if (jsonError(param)) {
                <p class="insp-error" role="alert">{{ 'workflow_engine.designer.json_invalid' | translate }}</p>
              }
            }
            @case ('number') {
              <input [id]="idFor(param)" type="number" [value]="text(param)" [readOnly]="readonly()" [attr.aria-required]="param.required || null"
                (input)="setNumber(param, $any($event.target).value)" />
            }
            @case ('select') {
              <select [id]="idFor(param)" [value]="text(param)" [disabled]="readonly()" (change)="set(param, $any($event.target).value || undefined)">
                <option value="">—</option>
                @for (option of param.options ?? []; track option) {
                  <option [value]="option">{{ option }}</option>
                }
              </select>
            }
            @case ('user') {
              <vx-select [inputId]="idFor(param)" [ngModel]="value()[param.name] ?? null" (ngModelChange)="set(param, $event ?? undefined)"
                [disabled]="readonly()" [search]="catalogs.searchPeople" [resolveWith]="catalogs.resolvePerson"
                [displayWith]="personName" [describeWith]="personEmail" [valueWith]="personId" [required]="!!param.required" />
            }
            @default {
              <input [id]="idFor(param)" [type]="param.type === 'url' ? 'url' : 'text'" [attr.maxlength]="param.maxLength ?? null" [value]="text(param)"
                [readOnly]="readonly()" [attr.aria-required]="param.required || null" [attr.aria-invalid]="missing(param) || null"
                [attr.inputmode]="param.type === 'url' ? 'url' : null" spellcheck="false" (input)="set(param, $any($event.target).value, true)"
                [attr.list]="param.name === 'workflowKey' ? idFor(param) + '-list' : null" />
              @if (param.name === 'workflowKey') {
                <datalist [id]="idFor(param) + '-list'">
                  @for (process of catalogs.processes(); track process.key) {
                    <option [value]="process.key">{{ process.name }}</option>
                  }
                </datalist>
              }
            }
          }
        }
        @if (param.hintKey) {
          <p class="insp-hint">{{ param.hintKey | translate }}</p>
        }
        @if (param.templated) {
          <p class="insp-hint">{{ 'workflow_engine.designer.templated_hint' | translate }}</p>
        }
      </div>
    } @empty {
      <p class="insp-empty">{{ 'workflow_engine.designer.no_params' | translate }}</p>
    }
  `,
})
export class ActionParamsComponent {
  protected readonly catalogs = inject(DesignerCatalogs);

  readonly params = input<WorkflowActionParam[]>([]);
  readonly value = input<Record<string, unknown>>({});
  readonly readonly = input(false);
  readonly idPrefix = input('param');
  readonly valueChange = output<{ value: Record<string, unknown>; coalesce?: string }>();

  protected readonly personName = (p: PersonOption) => p.name;
  protected readonly personEmail = (p: PersonOption) => p.email;
  protected readonly personId = (p: PersonOption) => p.id;

  private readonly jsonErrors = computed(() => {
    const errors = new Set<string>();
    for (const param of this.params()) {
      const raw = this.value()[param.name];
      if (param.type !== 'json' || typeof raw !== 'string' || !raw.trim()) continue;
      // A templated body is checked once placeholders are filled; quote-stripped tokens parse.
      try {
        JSON.parse(raw.replace(/\{\{\s*[\w.]+\s*\}\}/g, '0'));
      } catch {
        errors.add(param.name);
      }
    }
    return errors;
  });

  idFor(param: WorkflowActionParam): string {
    return `${this.idPrefix()}-${param.name}`;
  }

  text(param: WorkflowActionParam): string {
    const raw = this.value()[param.name];
    if (raw === undefined || raw === null) return '';
    return typeof raw === 'object' ? JSON.stringify(raw, null, 2) : String(raw);
  }

  missing(param: WorkflowActionParam): boolean {
    if (!param.required) return false;
    const raw = this.value()[param.name];
    return raw === undefined || raw === null || raw === '';
  }

  jsonError(param: WorkflowActionParam): boolean {
    return this.jsonErrors().has(param.name);
  }

  set(param: WorkflowActionParam, raw: unknown, coalesce = false): void {
    const next = { ...this.value() };
    if (raw === undefined || raw === '' || raw === false) delete next[param.name];
    else next[param.name] = raw;
    this.valueChange.emit({ value: next, coalesce: coalesce ? param.name : undefined });
  }

  setNumber(param: WorkflowActionParam, raw: string): void {
    const parsed = raw === '' ? undefined : Number(raw);
    this.set(param, parsed === undefined || Number.isNaN(parsed) ? undefined : parsed, true);
  }
}
