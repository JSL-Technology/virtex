import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Play } from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { NotificationService } from '../../../core/services/notification';
import { WorkflowInstance, WorkflowService } from '../data/workflow.service';

/**
 * The runs list: every instance of the tenant's workflows, newest first.
 *
 * Opened from a definition's «runs» action it is scoped to that process (the `definitionId` arrives
 * as a query parameter); opened from the menu it shows them all. Each row opens the runtime view,
 * where the instance's path through its graph is drawn.
 */
@Component({
  selector: 'app-workflow-instances-page',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './workflow-instances.page.scss',
  template: `
    <div class="wfi">
      <header class="wfi__header">
        <lucide-icon [img]="RunIcon" [size]="18" />
        <h1>{{ 'workflow_engine.nav.instances' | translate }}</h1>
      </header>

      @if (loading()) {
        <div class="wfi__state">{{ 'workflow_engine.loading' | translate }}</div>
      } @else if (error()) {
        <div class="wfi__state wfi__state--error">{{ error() }}</div>
      } @else if (instances().length === 0) {
        <div class="wfi__state">{{ 'workflow_engine.instances_empty' | translate }}</div>
      } @else {
        <table class="wfi__table">
          <thead>
            <tr>
              <th>{{ 'workflow_engine.instance.subject' | translate }}</th>
              <th>{{ 'workflow_engine.list.status' | translate }}</th>
              <th>{{ 'workflow_engine.instance.started' | translate }}</th>
              <th>{{ 'workflow_engine.instance.completed' | translate }}</th>
            </tr>
          </thead>
          <tbody>
            @for (instance of instances(); track instance.id) {
              <tr (click)="open(instance)">
                <td class="wfi__subject">
                  {{ instance.subject?.label || ('workflow_engine.instance.untitled' | translate) }}
                </td>
                <td>
                  <span class="wfi__badge" [attr.data-status]="instance.status">
                    {{ 'workflow_engine.instance_status.' + instance.status.toLowerCase() | translate }}
                  </span>
                </td>
                <td>{{ instance.createdAt | vxDate }}</td>
                <td>{{ instance.completedAt ? (instance.completedAt | vxDate) : '—' }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>
  `,
})
export class WorkflowInstancesPage {
  private readonly service = inject(WorkflowService);
  private readonly tenancy = inject(ActiveOrganizationService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  protected readonly RunIcon = Play;

  /** Optional filter, bound from the `?definitionId=` query parameter. */
  readonly definitionId = input<string>('');

  readonly instances = signal<WorkflowInstance[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly filter = computed(() => (this.definitionId() ? { definitionId: this.definitionId() } : {}));

  constructor() {
    effect(() => {
      // Re-read when the query filter changes.
      const filter = this.filter();
      this.load(filter);
    });
  }

  private load(filter: { definitionId?: string }): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.listInstances(filter).subscribe({
      next: (instances) => {
        this.instances.set(instances);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(err, 'workflow_engine.load_failed'));
        this.loading.set(false);
      },
    });
  }

  open(instance: WorkflowInstance): void {
    void this.router.navigateByUrl(this.tenancy.urlFor(`workflow-instances/${instance.id}`));
  }
}
