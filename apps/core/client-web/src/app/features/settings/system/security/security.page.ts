import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../core/services/auth';
import { DialogService } from '../../../../core/services/dialog.service';
import { NotificationService } from '../../../../core/services/notification';
import { VX_DATE } from '../../../../shared/components/date';
import { VX_SELECT } from '../../../../shared/components/select';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../../../shared/validators/password.validator';
import { UsersService } from '../../data/users.service';
import { SettingsChanges, SettingsSaveBarComponent, SettingsShellService } from '../../shell';
import { SettingsGroupComponent } from '../../shared';
import { VxEmptyStateComponent, VxErrorStateComponent, VxSpinnerComponent } from '../../../../shared/components/feedback';
import { History, SearchX } from 'lucide-angular';

/** The action types the trail records (`ActionType` on the server). */
export const AUDIT_ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'REFRESH', 'IMPERSONATE', 'READ', 'EXPORT'] as const;
type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditRow {
  id: string;
  userId: string | null;
  actorName: string | null;
  entity: string;
  entityId: string;
  /** The record's number or name from the row's snapshot, when it carries one. */
  recordLabel?: string | null;
  actionType: AuditAction;
  ipAddress?: string | null;
  previousValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  timestamp: string;
}

interface AuditPage {
  rows: AuditRow[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

interface AuditFilters {
  userId: string | null;
  actionType: AuditAction | null;
  entity: string | null;
  from: string | null;
  to: string | null;
  /** Leave out what the system did on its own. On by default: the trail is read for people. */
  peopleOnly: boolean;
}

const NO_FILTERS: AuditFilters = { userId: null, actionType: null, entity: null, from: null, to: null, peopleOnly: true };

interface Person {
  id: string;
  name: string;
}

/** One changed field of a trail row, as shown when the row is opened. */
export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

const PAGE_SIZE = 50;

/**
 * Organisation security and the audit trail, as two sections of one component (`view`).
 *
 * They were one screen, «Seguridad y auditoría», where the trail — a report, not a setting — took
 * most of its four screens of scroll. Now `policy` holds what the company decides (second factor,
 * password policy) and `trail` the record of who did what, each with its own permission.
 *
 * History (QA M-09: «Seguridad y auditoría» said «En desarrollo»):
 *
 * Everything shown here was already enforced or recorded by the server and unreachable:
 * - the organisation-wide second-factor requirement (`MfaEnrolmentGuard` enforces it; nothing
 *   could switch it on but the API);
 * - the password policy every password is held to (`password-policy.ts`), which nobody could read;
 * - the audit trail (`GET /audit`), recorded for every financial document and every sign-in, with
 *   no screen to read it.
 */
@Component({
  selector: 'app-security-settings-page',
  standalone: true,
  imports: [...VX_FORM_A11Y, 
    FormsModule,
    RouterLink,
    TranslateModule,
    SettingsGroupComponent,
    SettingsSaveBarComponent,
    VxEmptyStateComponent,
    VxErrorStateComponent,
    VxSpinnerComponent,
    ...VX_SELECT,
    ...VX_DATE,
    ...FORMAT_PIPES,
  ],
  templateUrl: './security.page.html',
  styleUrls: ['./security.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecuritySettingsPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly users = inject(UsersService);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);
  private readonly translate = inject(TranslateService);
  private readonly shell = inject(SettingsShellService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  protected readonly HistoryIcon = History;
  protected readonly SearchXIcon = SearchX;

  /** `policy`: second factor and password policy. `trail`: the audit trail. */
  readonly view = input<'policy' | 'trail'>('policy');

  protected readonly passwordMin = PASSWORD_MIN_LENGTH;
  protected readonly passwordMax = PASSWORD_MAX_LENGTH;
  protected readonly actions = AUDIT_ACTIONS;

  /** The trail is privileged reading (`audit:view_trail`); without it the section is not offered. */
  readonly canReadTrail = this.auth.hasPermissions(['audit:view_trail']);
  /** Changing the policy is the owner's; anyone who may open the section may read it. */
  readonly canEdit = computed(() => this.shell?.canEdit() ?? true);

  /** What the server has. */
  readonly requireMfa = signal<boolean | null>(null);
  /** What the form shows: changed with the checkbox, sent with the save bar like every other form. */
  readonly draftMfa = signal<boolean | null>(null);
  readonly savingMfa = signal(false);
  readonly policyError = signal<string | null>(null);
  readonly dirty = computed(() => this.requireMfa() !== null && this.draftMfa() !== this.requireMfa());

  /**
   * The policy saved itself the moment the box was ticked, the only form of the window that did
   * (GUA-02). It now holds the change until «Guardar», and the window asks before throwing it away.
   */
  private readonly policyChanges: SettingsChanges = {
    dirty: this.dirty,
    save: () => this.save(),
    discard: () => this.discard(),
  };

  readonly trail = signal<AuditPage | null>(null);
  readonly trailLoading = signal(false);
  readonly trailError = signal<string | null>(null);
  readonly entities = signal<string[]>([]);
  readonly people = signal<Person[]>([]);
  readonly expanded = signal<string | null>(null);
  readonly filters = signal<AuditFilters>({ ...NO_FILTERS });
  /** Any filter beyond the default one is applied. */
  readonly filtered = computed(() => {
    const { peopleOnly, ...rest } = this.filters();
    return !peopleOnly || Object.values(rest).some(Boolean);
  });
  /**
   * The IP column appears only when some row on the page has one. Rows written by the server for
   * its own work carry none, and a column of dashes was what the trail showed.
   */
  readonly showIp = computed(() => (this.trail()?.rows ?? []).some((row) => !!row.ipAddress));
  /** A filter that narrows the rows, beyond showing or hiding the system's own work. */
  readonly narrowed = computed(() => {
    const { userId, actionType, entity, from, to } = this.filters();
    return [userId, actionType, entity, from, to].some(Boolean);
  });
  readonly page = signal(1);

  readonly personLabel = (person: Person): string => person.name;
  readonly personValue = (person: Person): string => person.id;
  readonly actionLabel = (action: AuditAction): string => this.translate.instant(`settings.security.action.${action.toLowerCase()}`);
  readonly entityLabel = (entity: string): string => this.entityName(entity);

  ngOnInit(): void {
    if (this.view() === 'trail') {
      this.initTrail();
      return;
    }
    if (this.shell) {
      this.shell.register(this.policyChanges);
      this.destroyRef.onDestroy(() => this.shell?.unregister(this.policyChanges));
    }
    this.loadPolicy();
  }

  /** Reads the policy; a failure is said on the page, with a retry, not left as «Cargando…». */
  loadPolicy(): void {
    this.policyError.set(null);
    this.http.get<{ requireMfa: boolean }>(`${environment.apiUrl}/organizations/security-settings`).subscribe({
      next: ({ requireMfa }) => {
        this.requireMfa.set(requireMfa);
        this.draftMfa.set(requireMfa);
      },
      error: (error: unknown) => this.policyError.set(this.notifications.httpErrorMessage(error, 'settings.security.mfa_load_failed')),
    });
  }

  setDraftMfa(value: boolean): void {
    if (this.canEdit()) this.draftMfa.set(value);
  }

  discard(): void {
    this.draftMfa.set(this.requireMfa());
  }

  private initTrail(): void {
    if (!this.canReadTrail) return;
    this.http.get<string[]>(`${environment.apiUrl}/audit/entities`).subscribe({
      next: (entities) => this.entities.set(entities),
      error: () => this.entities.set([]),
    });
    // The member list is its own permission. Without it the trail still names every actor; only
    // the «who» filter is not offered.
    this.users.getUsers({ page: 1, pageSize: 100 }).subscribe({
      next: ({ data }) =>
        this.people.set(
          data.map((user) => ({ id: user.id, name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email })),
        ),
      error: () => this.people.set([]),
    });
    this.loadTrail();
  }

  /**
   * Sends the policy. Requiring a second factor interrupts the next sign-in of every member who
   * has none, so switching it on still asks first (ACC-04); declining keeps the edit unsaved.
   */
  async save(): Promise<boolean> {
    const next = this.draftMfa();
    if (!this.canEdit() || next === null || !this.dirty()) return false;
    if (next) {
      const confirmed = await this.dialog.confirm({
        title: 'settings.security.mfa_enable_title',
        message: 'settings.security.mfa_enable_message',
        confirmText: 'settings.security.mfa_enable_confirm',
        variant: 'warning',
      });
      if (!confirmed) return false;
    }
    this.savingMfa.set(true);
    return new Promise((resolve) => {
      this.http.patch<{ requireMfa: boolean }>(`${environment.apiUrl}/organizations/security-settings`, { requireMfa: next }).subscribe({
        next: ({ requireMfa }) => {
          this.savingMfa.set(false);
          this.requireMfa.set(requireMfa);
          this.draftMfa.set(requireMfa);
          this.notifications.showSuccess(requireMfa ? 'settings.security.mfa_enabled' : 'settings.security.mfa_disabled');
          resolve(true);
        },
        error: (error: unknown) => {
          this.savingMfa.set(false);
          this.notifications.showHttpError(error, 'settings.security.mfa_save_failed');
          resolve(false);
        },
      });
    });
  }

  setFilter(patch: Partial<AuditFilters>): void {
    this.filters.update((filters) => ({ ...filters, ...patch }));
    this.page.set(1);
    this.loadTrail();
  }

  clearFilters(): void {
    this.filters.set({ ...NO_FILTERS });
    this.page.set(1);
    this.loadTrail();
  }

  goToPage(page: number): void {
    this.page.set(Math.max(1, page));
    this.loadTrail();
  }

  loadTrail(): void {
    const filters = this.filters();
    if (filters.from && filters.to && filters.from > filters.to) {
      this.trailError.set(this.translate.instant('settings.security.range_invalid'));
      return;
    }
    let params = new HttpParams().set('page', String(this.page())).set('pageSize', String(PAGE_SIZE));
    for (const [key, value] of Object.entries(filters)) {
      if (value) params = params.set(key, String(value));
    }
    this.trailLoading.set(true);
    this.trailError.set(null);
    this.http.get<AuditPage>(`${environment.apiUrl}/audit`, { params }).subscribe({
      next: (page) => {
        this.trail.set(page);
        this.trailLoading.set(false);
      },
      error: (error: unknown) => {
        this.trailLoading.set(false);
        this.trailError.set(this.notifications.httpErrorMessage(error, 'settings.security.trail_load_failed'));
      },
    });
  }

  toggle(row: AuditRow): void {
    this.expanded.update((id) => (id === row.id ? null : row.id));
  }

  /**
   * The entity's name in the reader's language, or the identifier made readable.
   *
   * The trail writes entities two ways — a table (`bank_accounts`) or a class (`BankAccount`) —
   * so both are brought to snake case before the lookup. A key the catalogue lacks comes back as
   * itself in production and as `[[key]]` in development; neither may reach the screen.
   */
  entityName(entity: string): string {
    const snake = entity.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    const key = `settings.security.entity.${snake}`;
    const label = this.translate.instant(key);
    if (label && label !== key && label !== `[[${key}]]`) return label;
    return snake.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }

  /** The record as a person knows it: its number or name, else its type and a short id. */
  recordName(row: AuditRow): string {
    return row.recordLabel || `${this.translate.instant('settings.security.record_id')} ${row.entityId.slice(0, 8)}`;
  }

  /** What the row changed: every field whose value differs, or every field it recorded. */
  changes(row: AuditRow): FieldChange[] {
    const before = row.previousValue ?? {};
    const after = row.newValue ?? {};
    const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return fields
      .map((field) => ({ field, before: display(before[field]), after: display(after[field]) }))
      .filter((change) => change.before !== change.after);
  }
}

function display(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
