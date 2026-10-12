import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { LucideAngularModule, X } from 'lucide-angular';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { VX_UI } from '../../../shared/components';
import { ListShellComponent } from '../../../shared/components/gestures';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';
import { instanceStatusKey, instanceStatusTone } from '../data/workflow-labels';
import {
  ListInstancesFilter,
  WorkflowDefinitionSummary,
  WorkflowInstance,
  WorkflowInstanceStatus,
  WorkflowService,
} from '../data/workflow.service';

const STATUSES: WorkflowInstanceStatus[] = ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'];
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Every run of every process, filterable the way an operator investigates: by state, by process,
 * by who started it, by date, and by text (the run's subject). Paged on the server, so a company
 * with years of runs opens it as fast as one with ten.
 *
 * Opened from a process's «runs» link it arrives filtered to that process (`?key=`) and, from the
 * running count, to its running instances (`?status=RUNNING`); the filters are visible and
 * removable, never a hidden scope.
 */
@Component({
  selector: 'app-workflow-instances-page',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule, RouterLink, RowLinkDirective, ...FORMAT_PIPES, ...VX_UI, ListShellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './workflow-instances.page.scss',
  template: `
    <vx-list-shell
      titleKey="workflow_engine.nav.instances"
      subtitleKey="workflow_engine.instances.subtitle"
      [count]="total()"
      [loading]="loading()"
      [error]="error()"
      [empty]="items().length === 0"
      [searchable]="true"
      searchPlaceholderKey="workflow_engine.instances.search"
      [search]="query()"
      (searchChange)="onSearch($event)"
      (reload)="load()"
    >
      <div listFilters class="wfr__filters">
        <div class="wfr__chips" role="group" [attr.aria-label]="'workflow_engine.instances.filter_status' | translate">
          <button type="button" class="chip" [class.chip--active]="!status()" [attr.aria-pressed]="!status()" (click)="setStatus('')">
            {{ 'workflow_engine.instances.all' | translate }}
          </button>
          @for (option of statuses; track option) {
            <button type="button" class="chip" [class.chip--active]="status() === option" [attr.aria-pressed]="status() === option" (click)="setStatus(option)">
              {{ statusKey(option) | translate }}
            </button>
          }
        </div>
        <label class="wfr__control">
          <span>{{ 'workflow_engine.instances.process' | translate }}</span>
          <select [value]="processKey()" (change)="setProcess($any($event.target).value)">
            <option value="">{{ 'workflow_engine.instances.all_processes' | translate }}</option>
            @for (process of processes(); track process.key) {
              <option [value]="process.key" [selected]="process.key === processKey()">{{ process.name }}</option>
            }
          </select>
        </label>
        <label class="wfr__control">
          <span>{{ 'workflow_engine.instances.started_by' | translate }}</span>
          <select [value]="scope()" (change)="setScope($any($event.target).value)">
            <option value="all">{{ 'workflow_engine.instances.anyone' | translate }}</option>
            <option value="mine">{{ 'workflow_engine.instances.me' | translate }}</option>
          </select>
        </label>
        <label class="wfr__control">
          <span>{{ 'workflow_engine.instances.from' | translate }}</span>
          <input type="date" [value]="from()" [max]="to() || null" (change)="setRange($any($event.target).value, to())" />
        </label>
        <label class="wfr__control">
          <span>{{ 'workflow_engine.instances.to' | translate }}</span>
          <input type="date" [value]="to()" [min]="from() || null" (change)="setRange(from(), $any($event.target).value)" />
        </label>
        @if (hasFilters()) {
          <button type="button" class="wfr__clear" (click)="clearFilters()">
            <lucide-icon [img]="ClearIcon" [size]="14" aria-hidden="true" /> {{ 'workflow_engine.list.clear_filters' | translate }}
          </button>
        }
      </div>

      <div listEmpty class="wfr__empty">
        <p class="ls__state-title">{{ (hasFilters() ? 'workflow_engine.instances.no_match' : 'workflow_engine.instances_empty') | translate }}</p>
        @if (hasFilters()) {
          <button type="button" class="secondary-button" (click)="clearFilters()">{{ 'workflow_engine.list.clear_filters' | translate }}</button>
        } @else {
          <p class="ls__state-help">{{ 'workflow_engine.instances.empty_help' | translate }}</p>
        }
      </div>

      <div class="table-container card">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">{{ 'workflow_engine.instances.process' | translate }}</th>
              <th scope="col">{{ 'workflow_engine.instance.subject' | translate }}</th>
              <th scope="col">{{ 'workflow_engine.list.status' | translate }}</th>
              <th scope="col">{{ 'workflow_engine.instances.where' | translate }}</th>
              <th scope="col">{{ 'workflow_engine.instances.started_by' | translate }}</th>
              <th scope="col">{{ 'workflow_engine.instance.started' | translate }}</th>
              <th scope="col" class="text-right">{{ 'workflow_engine.instances.duration' | translate }}</th>
            </tr>
          </thead>
          <tbody>
            @for (run of items(); track run.id) {
              <tr appRowLink>
                <td>
                  <a class="table-link" [routerLink]="link('workflow-instances/' + run.id)">{{ run.definitionName ?? '—' }}</a>
                  <span class="wfr__sub">{{ 'workflow_engine.version' | translate: { version: run.definitionVersion } }}</span>
                </td>
                <td class="wfr__subject">
                  @if (run.subject?.route) {
                    <a class="table-link" [routerLink]="link(run.subject!.route!)">{{ run.subject?.label || ('workflow_engine.instance.untitled' | translate) }}</a>
                  } @else {
                    {{ run.subject?.label || ('workflow_engine.instance.untitled' | translate) }}
                  }
                </td>
                <td><vx-badge [tone]="tone(run.status)">{{ statusKey(run.status) | translate }}</vx-badge></td>
                <td class="wfr__where">
                  @switch (run.status) {
                    @case ('RUNNING') {
                      {{ (run.currentSteps ?? []).join(', ') || '—' }}
                      @if (run.openTaskCount) {
                        <span class="wfr__sub">{{ 'workflow_engine.instances.open_tasks' | translate: { count: run.openTaskCount } }}</span>
                      }
                    }
                    @case ('COMPLETED') { {{ run.result || ('workflow_engine.instance_status.completed' | translate) }} }
                    @case ('FAILED') { <span class="wfr__error" [title]="run.error ?? ''">{{ run.error || '—' }}</span> }
                    @case ('CANCELLED') { <span [title]="run.cancelReason ?? ''">{{ run.cancelReason || '—' }}</span> }
                  }
                </td>
                <td>{{ run.startedByName || ('workflow_engine.instances.automatic' | translate) }}</td>
                <td>{{ run.createdAt | vxDate: 'datetime' }}</td>
                <td class="text-right wfr__duration">{{ duration(run) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <vx-pager listFooter [page]="page()" [pageSize]="pageSize()" [total]="total()" (pageChange)="setPage($event)" (pageSizeChange)="setPageSize($event)" />
    </vx-list-shell>
  `,
})
export class WorkflowInstancesPage {
  private readonly service = inject(WorkflowService);
  private readonly tenancy = inject(ActiveOrganizationService);
  private readonly notifications = inject(NotificationService);
  private readonly translate = inject(TranslateService);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  /** Optional filters from the query string (`?key=…&status=…&definitionId=…`). */
  readonly key = input<string>('');
  readonly definitionId = input<string>('');
  readonly initialStatus = input<string>('', { alias: 'status' });

  protected readonly statuses = STATUSES;
  protected readonly ClearIcon = X;

  readonly items = signal<WorkflowInstance[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly processes = signal<Array<{ key: string; name: string }>>([]);

  readonly query = signal('');
  readonly status = signal<WorkflowInstanceStatus | ''>('');
  readonly processKey = signal('');
  readonly definitionFilter = signal('');
  readonly scope = signal<'all' | 'mine'>('all');
  readonly from = signal('');
  readonly to = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(50);

  readonly hasFilters = computed(
    () => !!(this.query() || this.status() || this.processKey() || this.definitionFilter() || this.scope() !== 'all' || this.from() || this.to()),
  );

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor() {
    // Seed the filters from the link that opened the page (route inputs, or the tab's query).
    effect(() => {
      const query = this.tab?.query ?? {};
      const key = this.key() || query['key'] || '';
      const status = (this.initialStatus() || query['status'] || '').toUpperCase();
      const definitionId = this.definitionId() || query['definitionId'] || '';
      untracked(() => {
        this.processKey.set(key);
        this.definitionFilter.set(definitionId);
        this.status.set(STATUSES.includes(status as WorkflowInstanceStatus) ? (status as WorkflowInstanceStatus) : '');
        this.page.set(1);
        this.load();
      });
    });

    this.service.catalogue().subscribe({
      next: (list: WorkflowDefinitionSummary[]) => this.processes.set(list.map((p) => ({ key: p.key, name: p.name })).sort((a, b) => a.name.localeCompare(b.name))),
      error: () => undefined,
    });

    inject(DestroyRef).onDestroy(() => this.searchTimer && clearTimeout(this.searchTimer));
  }

  load(): void {
    const seq = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    const filter: ListInstancesFilter = {
      status: this.status(),
      key: this.processKey() || undefined,
      definitionId: this.definitionFilter() || undefined,
      search: this.query().trim() || undefined,
      scope: this.scope(),
      from: this.from() || undefined,
      to: this.to() || undefined,
      page: this.page(),
      pageSize: this.pageSize(),
    };
    this.service.listInstances(filter).subscribe({
      next: (result) => {
        if (seq !== this.seq) return;
        this.items.set(result.items);
        this.total.set(result.total);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        if (seq !== this.seq) return;
        this.error.set(this.notifications.httpErrorMessage(err, 'workflow_engine.load_failed'));
        this.loading.set(false);
      },
    });
  }

  link(path: string): string {
    return this.tenancy.urlFor(path);
  }

  onSearch(value: string): void {
    this.query.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.refilter(), SEARCH_DEBOUNCE_MS);
  }

  setStatus(status: WorkflowInstanceStatus | ''): void {
    this.status.set(status);
    this.refilter();
  }

  setProcess(key: string): void {
    this.processKey.set(key);
    this.definitionFilter.set('');
    this.refilter();
  }

  setScope(scope: 'all' | 'mine'): void {
    this.scope.set(scope);
    this.refilter();
  }

  setRange(from: string, to: string): void {
    this.from.set(from);
    this.to.set(to);
    this.refilter();
  }

  setPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  setPageSize(size: number): void {
    this.pageSize.set(size);
    this.refilter();
  }

  clearFilters(): void {
    this.query.set('');
    this.status.set('');
    this.processKey.set('');
    this.definitionFilter.set('');
    this.scope.set('all');
    this.from.set('');
    this.to.set('');
    this.refilter();
  }

  private refilter(): void {
    this.page.set(1);
    this.load();
  }

  tone(status: WorkflowInstanceStatus) {
    return instanceStatusTone(status);
  }

  statusKey(status: WorkflowInstanceStatus): string {
    return instanceStatusKey(status);
  }

  duration(run: WorkflowInstance): string {
    const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
    const minutes = Math.max(0, Math.round((end - new Date(run.createdAt).getTime()) / 60000));
    if (minutes < 60) return this.translate.instant('workflow_engine.unit.minutes_short', { count: minutes });
    const hours = Math.round(minutes / 6) / 10;
    if (hours < 48) return this.translate.instant('workflow_engine.unit.hours_short', { count: hours });
    return this.translate.instant('workflow_engine.unit.days_short', { count: Math.round(hours / 2.4) / 10 });
  }
}
