import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { VxDialogComponent } from '../../../shared/components/dialog';
import { NotificationService } from '../../../core/services/notification';
import { WorkflowDefinition, WorkflowInstance, WorkflowService } from '../data/workflow.service';
import { WorkflowFieldsComponent, fieldProblems } from './workflow-fields.component';

/**
 * Start a run of a published process by hand.
 *
 * Asks for what the process declared it needs — its variables, typed — and, optionally, what the
 * run is about («Pedido 0042»), so the run is recognisable in the inbox and the run list. The
 * button stays single-flight: a double click starts one run, not two.
 */
@Component({
  selector: 'app-workflow-start-run-dialog',
  standalone: true,
  imports: [TranslatePipe, VxDialogComponent, WorkflowFieldsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <vx-dialog titleKey="workflow_engine.start.title" size="md" [busy]="busy()" (dismissed)="dismissed.emit()">
      <form id="wf-start-form" class="wfs" (submit)="$event.preventDefault(); start()" novalidate>
        <p class="wfs__lead">{{ 'workflow_engine.start.lead' | translate: { name: definition().name, version: definition().version } }}</p>

        <div class="wfs__field">
          <label for="wf-start-subject">{{ 'workflow_engine.start.subject' | translate }}</label>
          <input id="wf-start-subject" type="text" maxlength="200" [value]="subject()" (input)="subject.set($any($event.target).value)"
            [placeholder]="'workflow_engine.start.subject_placeholder' | translate" />
          <p class="wfs__hint">{{ 'workflow_engine.start.subject_hint' | translate }}</p>
        </div>

        @if (fields().length) {
          <fieldset class="wfs__fieldset">
            <legend>{{ 'workflow_engine.start.data' | translate }}</legend>
            <app-workflow-fields [fields]="fields()" [value]="values()" [submitted]="submitted()" idPrefix="wf-start" (valueChange)="values.set($event)" />
          </fieldset>
        } @else {
          <p class="wfs__hint">{{ 'workflow_engine.start.no_data' | translate }}</p>
        }
      </form>
      <div dialogActions>
        <button type="button" class="secondary-button" [disabled]="busy()" (click)="dismissed.emit()">{{ 'workflow_engine.cancel' | translate }}</button>
        <button type="submit" form="wf-start-form" class="primary-button" [disabled]="busy()">
          {{ (busy() ? 'workflow_engine.start.starting' : 'workflow_engine.start.confirm') | translate }}
        </button>
      </div>
    </vx-dialog>
  `,
  styles: [
    `
      .wfs {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }
      .wfs__lead {
        margin: 0;
        color: var(--content-secondary);
        font-size: var(--text-sm);
      }
      .wfs__field {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
      }
      .wfs__field label {
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        color: var(--content-secondary);
      }
      .wfs__field input {
        min-height: var(--control-height-md);
        padding: var(--space-2) var(--control-padding-x);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--surface-base);
        color: var(--content-primary);
        font: inherit;
        font-size: var(--text-sm);
      }
      .wfs__hint {
        margin: 0;
        font-size: var(--text-xs);
        color: var(--content-tertiary);
      }
      .wfs__fieldset {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        margin: 0;
        padding: var(--space-3);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-md);
      }
      .wfs__fieldset legend {
        padding: 0 var(--space-1);
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
      }
    `,
  ],
})
export class StartRunDialogComponent {
  private readonly service = inject(WorkflowService);
  private readonly notifications = inject(NotificationService);

  readonly definition = input.required<WorkflowDefinition>();
  readonly started = output<WorkflowInstance>();
  readonly dismissed = output<void>();

  readonly subject = signal('');
  readonly values = signal<Record<string, unknown>>({});
  readonly submitted = signal(false);
  readonly busy = signal(false);

  readonly fields = computed(() => this.definition().graph?.variables ?? []);

  start(): void {
    if (this.busy()) return;
    this.submitted.set(true);
    if (Object.keys(fieldProblems(this.fields(), this.values())).length) return;
    this.busy.set(true);
    const label = this.subject().trim();
    this.service
      .startInstance(this.definition().id, {
        context: this.values(),
        subject: label ? { type: 'manual', label } : undefined,
      })
      .subscribe({
        next: (instance) => {
          this.busy.set(false);
          this.notifications.showSuccess('workflow_engine.started');
          this.started.emit(instance);
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.notifications.showHttpError(err, 'workflow_engine.start_failed');
        },
      });
  }
}
