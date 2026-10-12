import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Play } from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { NotificationService } from '../../../core/services/notification';
import { ListShellComponent } from '../../../shared/components/gestures';
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
  imports: [TranslateModule, LucideAngularModule, ListShellComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './workflow-instances.page.scss',
  template: `
    <vx-list-shell
      titleKey="workflow_engine.nav.instances"
      [count]="instances().length"
      [loading]="loading()"
      [error]="error()"
      [empty]="instances().length === 0"
      (reload)="reload()"
    >
      <div listEmpty class="empty-copy wfi__empty">
        <lucide-icon [img]="RunIcon" size="28" aria-hidden="true"></lucide-icon>
        <p class="ls__state-title">{{ 'workflow_engine.instances_empty' | translate }}</p>
      </div>

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
    </vx-list-shell>
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

  /**
   * The shell's «retry», and its reload when the list comes back into view after its data changed elsewhere: it
   * re-reads with the current filter, so a list opened from one workflow stays scoped to it.
   */
  reload(): void {
    this.load(this.filter());
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
