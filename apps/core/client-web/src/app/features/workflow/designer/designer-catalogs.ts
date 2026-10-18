import { Injectable, computed, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Observable, map, of } from 'rxjs';
import { roleLabel } from '../../../shared/pipes/role-name.pipe';
import { eventFieldLabel } from '../data/workflow-labels';
import {
  WorkflowActionCatalogueItem,
  WorkflowAssignees,
  WorkflowEventCatalogue,
  WorkflowService,
  WorkflowVariable,
} from '../data/workflow.service';
import { ConditionVariable } from './condition-editor.component';
import { DesignerStore } from './designer-store';

export interface PersonOption {
  id: string;
  name: string;
  email: string;
  /** Holds the grant to answer tasks. Absent when unknown (a person resolved by id only). */
  canAct?: boolean;
}

export interface RoleOption {
  id: string;
  name: string;
  label: string;
  canAct?: boolean;
  members?: number;
}

/**
 * What the designer offers in its pickers, loaded once per designer: the actions with their
 * parameter forms, the business events with their fields, and the company's people and roles.
 *
 * It also answers «which variables can this condition read», merging the process container with
 * the trigger event's fields and every task form, so the condition editor offers names that will
 * actually exist at runtime.
 */
@Injectable()
export class DesignerCatalogs {
  private readonly service = inject(WorkflowService);
  private readonly translate = inject(TranslateService);
  private readonly store = inject(DesignerStore);

  readonly actions = signal<WorkflowActionCatalogueItem[]>([]);
  readonly events = signal<WorkflowEventCatalogue>({ customPrefix: 'custom.', events: [] });
  readonly people = signal<PersonOption[]>([]);
  readonly roles = signal<RoleOption[]>([]);
  readonly loaded = signal(false);
  /** Other processes of the company, for «start a sub-process». */
  readonly processes = signal<Array<{ key: string; name: string }>>([]);

  readonly peopleById = computed(() => new Map(this.people().map((p) => [p.id, p])));
  readonly rolesById = computed(() => new Map(this.roles().map((r) => [r.id, r])));

  /** Variables a condition (or a timer, or a template) may reference. */
  readonly availableVariables = computed<ConditionVariable[]>(() => {
    const out = new Map<string, ConditionVariable>();
    const add = (variable: WorkflowVariable, fallbackLabel?: string) => {
      if (!out.has(variable.name)) {
        out.set(variable.name, { name: variable.name, label: variable.label || fallbackLabel || variable.name, type: variable.type });
      }
    };
    for (const variable of this.store.variables()) add(variable);
    const trigger = this.store.trigger();
    if (trigger.mode === 'event' && trigger.event) {
      const event = this.events().events.find((e) => e.key === trigger.event);
      for (const field of event?.fields ?? []) add({ ...field, label: eventFieldLabel(this.translate, field.name, field.label) });
    }
    for (const node of this.store.nodes()) {
      for (const field of node.config?.form ?? []) add(field);
      // What automatic steps write: the same list the server's validation counts as declared.
      const action = node.type === 'action' ? node.config?.action : undefined;
      if (action === 'set_variable') {
        const name = String(node.config?.actionParams?.['name'] ?? '').trim();
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) add({ name, type: 'string', label: name });
      } else if (action === 'webhook') {
        add({ name: 'webhook.ok', type: 'boolean', label: this.translate.instant('workflow_engine.variable.webhook_ok') });
        add({ name: 'webhook.status', type: 'number', label: this.translate.instant('workflow_engine.variable.webhook_status') });
      } else if (action === 'document_decision') {
        add({ name: 'document.ok', type: 'boolean', label: this.translate.instant('workflow_engine.variable.document_ok') });
      }
    }
    add({ name: 'lastOutcome', type: 'string', label: this.translate.instant('workflow_engine.variable.last_outcome') });
    add({ name: 'lastComment', type: 'string', label: this.translate.instant('workflow_engine.variable.last_comment') });
    return [...out.values()];
  });

  load(): void {
    this.service.actions().subscribe({ next: (actions) => this.actions.set(actions) });
    this.service.events().subscribe({ next: (events) => this.events.set(events) });
    this.service.catalogue().subscribe({
      next: (list) => this.processes.set(list.map((item) => ({ key: item.key, name: item.name }))),
      error: () => undefined,
    });
    this.service.assignees().subscribe({
      next: (assignees) => {
        this.setAssignees(assignees);
        this.loaded.set(true);
      },
      // A viewer without the design permission cannot list people; the designer is read-only for
      // them anyway and shows ids it cannot resolve as «—».
      error: () => this.loaded.set(true),
    });
  }

  /**
   * Make sure the people a saved graph references have names, even when they are not on the first
   * page of the directory (a company with thousands of users).
   */
  resolvePeople(ids: Iterable<string | undefined | null>): void {
    const known = this.peopleById();
    const missing = [...new Set([...ids].filter((id): id is string => !!id && !known.has(id)))];
    if (!missing.length) return;
    this.service.assignees(undefined, missing.slice(0, 200)).subscribe({ next: (a) => this.mergePeople(a.users), error: () => undefined });
  }

  /** The option a stored id names, for `vx-select`'s resolveWith. */
  resolvePerson = (id: string): Observable<PersonOption | null> => {
    const known = this.peopleById().get(id);
    if (known) return of(known);
    return this.service.assignees(undefined, [id]).pipe(
      map((a) => {
        this.mergePeople(a.users);
        return a.users[0] ?? null;
      }),
    );
  };

  /** Server-side search for large companies (the first page arrives with `load`). */
  searchPeople = (query: string): Observable<PersonOption[]> =>
    this.service.assignees(query).pipe(
      map((assignees) => {
        this.mergePeople(assignees.users);
        return assignees.users;
      }),
    );

  personName(id: string | undefined | null): string {
    if (!id) return '';
    return this.peopleById().get(id)?.name ?? '—';
  }

  roleName(id: string | undefined | null): string {
    if (!id) return '';
    return this.rolesById().get(id)?.label ?? '—';
  }

  action(key: string | undefined): WorkflowActionCatalogueItem | undefined {
    return key ? this.actions().find((a) => a.key === key) : undefined;
  }

  private setAssignees(assignees: WorkflowAssignees): void {
    this.people.set(assignees.users);
    this.roles.set(
      assignees.roles.map((role) => ({ id: role.id, name: role.name, label: roleLabel(this.translate, role.name), canAct: role.canAct, members: role.members })),
    );
  }

  private mergePeople(users: PersonOption[]): void {
    const known = this.peopleById();
    const fresh = users.filter((u) => !known.has(u.id));
    if (fresh.length) this.people.update((list) => [...list, ...fresh]);
  }
}
