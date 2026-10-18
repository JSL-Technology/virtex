import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { BadgeCheck, CircleDashed, FileInput, LucideAngularModule, ReceiptText, ShieldCheck, UserPlus } from 'lucide-angular';
import { VxDialogComponent } from '../../../shared/components/dialog';
import { NotificationService } from '../../../core/services/notification';
import { eventLabel } from '../data/workflow-labels';
import { WORKFLOW_TEMPLATES, WorkflowTemplate, applyTemplate } from '../data/workflow-templates';
import { WorkflowDefinition, WorkflowGraph, WorkflowService, WorkflowTrigger } from '../data/workflow.service';

const ICONS: Record<WorkflowTemplate['icon'], unknown> = {
  blank: CircleDashed,
  approval: ShieldCheck,
  invoice: ReceiptText,
  customer: UserPlus,
  bill: BadgeCheck,
};

const IMPORT_LIMIT_BYTES = 2 * 1024 * 1024;

/**
 * Create a process: a name, an optional description, and where to start from — a blank canvas,
 * one of the ready-made templates, or a file exported from another company or environment.
 * The name is checked for uniqueness by the server; the error lands on the field.
 */
@Component({
  selector: 'app-create-workflow-dialog',
  standalone: true,
  imports: [TranslatePipe, LucideAngularModule, VxDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <vx-dialog titleKey="workflow_engine.create.title" size="lg" [busy]="busy()" (dismissed)="dismissed.emit()">
      <form id="wf-create-form" class="wfc" (submit)="$event.preventDefault(); create()" novalidate>
        <div class="wfc__field">
          <label for="wf-create-name">{{ 'workflow_engine.field.name' | translate }} <span aria-hidden="true">*</span></label>
          <input id="wf-create-name" type="text" maxlength="160" required aria-required="true" autocomplete="off" [value]="name()"
            (input)="name.set($any($event.target).value); nameError.set(null); markNameTouched()"
            [attr.aria-invalid]="!!nameError() || null" [attr.aria-describedby]="nameError() ? 'wf-create-name-err' : null" />
          @if (nameError(); as error) {
            <p class="wfc__error" id="wf-create-name-err" role="alert">{{ error }}</p>
          }
        </div>
        <div class="wfc__field">
          <label for="wf-create-description">{{ 'workflow_engine.field.description' | translate }}</label>
          <textarea id="wf-create-description" rows="2" maxlength="2000" [value]="description()" (input)="description.set($any($event.target).value)"></textarea>
        </div>

        <fieldset class="wfc__templates">
          <legend>{{ 'workflow_engine.create.start_from' | translate }}</legend>
          <div class="wfc__grid" role="radiogroup" [attr.aria-label]="'workflow_engine.create.start_from' | translate">
            @for (template of templates; track template.id) {
              <button type="button" role="radio" class="wfc__card" [attr.aria-checked]="selected() === template.id && !imported()" (click)="choose(template)">
                <span class="wfc__icon" aria-hidden="true"><lucide-icon [img]="icon(template)" [size]="18" /></span>
                <span class="wfc__card-title">{{ template.nameKey | translate }}</span>
                <span class="wfc__card-text">{{ template.descriptionKey | translate }}</span>
                @if (template.trigger.mode === 'event') {
                  <span class="wfc__card-meta">{{ 'workflow_engine.create.starts_on' | translate: { event: event(template) } }}</span>
                }
              </button>
            }
            <button type="button" role="radio" class="wfc__card" [attr.aria-checked]="!!imported()" (click)="fileInput.click()">
              <span class="wfc__icon" aria-hidden="true"><lucide-icon [img]="ImportIcon" [size]="18" /></span>
              <span class="wfc__card-title">{{ 'workflow_engine.create.import' | translate }}</span>
              <span class="wfc__card-text">
                {{ imported() ? ('workflow_engine.create.imported' | translate: { file: importedName(), nodes: imported()!.graph.nodes.length }) : ('workflow_engine.create.import_hint' | translate) }}
              </span>
            </button>
            <input #fileInput type="file" accept="application/json,.json" hidden (change)="readFile($event)" />
          </div>
        </fieldset>
      </form>
      <div dialogActions>
        <button type="button" class="secondary-button" [disabled]="busy()" (click)="dismissed.emit()">{{ 'workflow_engine.cancel' | translate }}</button>
        <button type="submit" form="wf-create-form" class="primary-button" [disabled]="busy() || !name().trim()">
          {{ (busy() ? 'workflow_engine.create.creating' : 'workflow_engine.create.confirm') | translate }}
        </button>
      </div>
    </vx-dialog>
  `,
  styles: [
    `
      .wfc {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }
      .wfc__field {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
      }
      .wfc__field label {
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        color: var(--content-secondary);
      }
      .wfc__field input,
      .wfc__field textarea {
        min-height: var(--control-height-md);
        padding: var(--space-2) var(--control-padding-x);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--surface-base);
        color: var(--content-primary);
        font: inherit;
        font-size: var(--text-sm);
      }
      .wfc__field input[aria-invalid='true'] {
        border-color: var(--error-solid);
      }
      .wfc__error {
        margin: 0;
        font-size: var(--text-xs);
        color: var(--error-text);
      }
      .wfc__templates {
        margin: 0;
        padding: 0;
        border: 0;
      }
      .wfc__templates legend {
        padding: 0;
        margin-bottom: var(--space-2);
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
      }
      .wfc__grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: var(--space-2);
      }
      .wfc__card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-1);
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        background: var(--surface-base);
        color: var(--content-primary);
        text-align: start;
        cursor: pointer;
      }
      .wfc__card:hover {
        border-color: var(--border-strong);
      }
      .wfc__card:focus-visible {
        outline: var(--focus-ring-width) solid var(--focus-ring-color);
        outline-offset: 2px;
      }
      .wfc__card[aria-checked='true'] {
        border-color: var(--accent-solid);
        box-shadow: 0 0 0 1px var(--accent-solid);
        background: var(--accent-surface);
      }
      .wfc__icon {
        display: inline-flex;
        padding: var(--space-1);
        border-radius: var(--radius-md);
        background: var(--surface-sunken);
        color: var(--accent-text);
      }
      .wfc__card-title {
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
      }
      .wfc__card-text,
      .wfc__card-meta {
        font-size: var(--text-xs);
        color: var(--content-tertiary);
      }
      .wfc__card-meta {
        color: var(--accent-text);
      }
    `,
  ],
})
export class CreateWorkflowDialogComponent {
  private readonly service = inject(WorkflowService);
  private readonly translate = inject(TranslateService);
  private readonly notifications = inject(NotificationService);

  readonly created = output<WorkflowDefinition>();
  readonly dismissed = output<void>();

  protected readonly templates = WORKFLOW_TEMPLATES;
  protected readonly ImportIcon = FileInput;

  readonly name = signal('');
  readonly description = signal('');
  readonly selected = signal<string>('blank');
  readonly imported = signal<{ graph: WorkflowGraph; trigger?: WorkflowTrigger; description?: string } | null>(null);
  readonly importedName = signal('');
  readonly busy = signal(false);
  readonly nameError = signal<string | null>(null);
  private nameTouched = false;

  readonly template = computed(() => WORKFLOW_TEMPLATES.find((t) => t.id === this.selected()) ?? WORKFLOW_TEMPLATES[0]);

  icon(template: WorkflowTemplate): unknown {
    return ICONS[template.icon];
  }

  event(template: WorkflowTemplate): string {
    return eventLabel(this.translate, template.trigger.event);
  }

  choose(template: WorkflowTemplate): void {
    this.selected.set(template.id);
    this.imported.set(null);
    // Suggest the template's name until the author types their own.
    if (!this.nameTouched || !this.name().trim()) {
      this.name.set(template.id === 'blank' ? '' : this.translate.instant(template.nameKey));
      this.description.set(template.id === 'blank' ? '' : this.translate.instant(template.descriptionKey));
    }
  }

  async readFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > IMPORT_LIMIT_BYTES) {
      this.notifications.showError('workflow_engine.import.too_large');
      return;
    }
    try {
      const value = JSON.parse(await file.text()) as Record<string, unknown>;
      const graph = (value['kind'] === 'virtex.workflow' ? value['graph'] : value) as WorkflowGraph | undefined;
      if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('shape');
      const trigger = value['trigger'] as WorkflowTrigger | undefined;
      this.imported.set({ graph, trigger: trigger?.mode ? trigger : undefined, description: typeof value['description'] === 'string' ? value['description'] : undefined });
      this.importedName.set(file.name);
      if (!this.name().trim() && typeof value['name'] === 'string') this.name.set(value['name']);
      if (!this.description().trim() && typeof value['description'] === 'string') this.description.set(value['description']);
    } catch {
      this.notifications.showError('workflow_engine.import.invalid');
    }
  }

  create(): void {
    const name = this.name().trim();
    if (!name) {
      this.nameError.set(this.translate.instant('workflow_engine.designer.name_required'));
      return;
    }
    if (this.busy()) return;
    this.busy.set(true);
    const imported = this.imported();
    const fromTemplate = imported ? null : applyTemplate(this.template(), (key) => this.translate.instant(key));
    this.service
      .createDefinition({
        name,
        description: this.description().trim() || null,
        graph: imported?.graph ?? fromTemplate?.graph,
        trigger: imported?.trigger ?? fromTemplate?.trigger,
      })
      .subscribe({
        next: (definition) => {
          this.busy.set(false);
          this.created.emit(definition);
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.nameError.set(this.notifications.httpErrorMessage(err, 'workflow_engine.save_failed'));
        },
      });
  }

  /** Called by the template's input listener; remembered so template picks stop overwriting it. */
  markNameTouched(): void {
    this.nameTouched = true;
  }
}
