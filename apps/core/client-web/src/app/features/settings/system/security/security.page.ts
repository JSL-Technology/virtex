import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../core/services/auth';
import { DialogService } from '../../../../core/services/dialog.service';
import { NotificationService } from '../../../../core/services/notification';
import { VX_DATE } from '../../../../shared/components/date';
import { VX_SELECT } from '../../../../shared/components/select';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../../../shared/validators/password.validator';
import { UsersService } from '../../data/users.service';

/** The action types the trail records (`ActionType` on the server). */
export const AUDIT_ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'REFRESH', 'IMPERSONATE', 'READ', 'EXPORT'] as const;
type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditRow {
  id: string;
  userId: string | null;
  actorName: string | null;
  entity: string;
  entityId: string;
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
}

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
 * Organisation security and the audit trail (QA M-09: «Seguridad y auditoría» said «En desarrollo»).
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
  imports: [FormsModule, RouterLink, TranslateModule, ...VX_SELECT, ...VX_DATE, ...FORMAT_PIPES],
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

  protected readonly passwordMin = PASSWORD_MIN_LENGTH;
  protected readonly passwordMax = PASSWORD_MAX_LENGTH;
  protected readonly actions = AUDIT_ACTIONS;

  /** The trail is privileged reading (`audit:view_trail`); without it the section is not offered. */
  readonly canReadTrail = this.auth.hasPermissions(['audit:view_trail']);

  readonly requireMfa = signal<boolean | null>(null);
  readonly savingMfa = signal(false);

  readonly trail = signal<AuditPage | null>(null);
  readonly trailLoading = signal(false);
  readonly trailError = signal<string | null>(null);
  readonly entities = signal<string[]>([]);
  readonly people = signal<Person[]>([]);
  readonly expanded = signal<string | null>(null);
  readonly filters = signal<AuditFilters>({ userId: null, actionType: null, entity: null, from: null, to: null });
  readonly page = signal(1);

  readonly personLabel = (person: Person): string => person.name;
  readonly personValue = (person: Person): string => person.id;
  readonly actionLabel = (action: AuditAction): string => this.translate.instant(`settings.security.action.${action.toLowerCase()}`);
  readonly entityLabel = (entity: string): string => this.entityName(entity);

  ngOnInit(): void {
    this.http.get<{ requireMfa: boolean }>(`${environment.apiUrl}/organizations/security-settings`).subscribe({
      next: ({ requireMfa }) => this.requireMfa.set(requireMfa),
      error: (error: unknown) => this.notifications.showHttpError(error, 'settings.security.mfa_load_failed'),
    });

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

  async toggleMfa(next: boolean): Promise<void> {
    if (next) {
      // Switching it on interrupts the next sign-in of every member without a second factor.
      const confirmed = await this.dialog.confirm({
        title: 'settings.security.mfa_enable_title',
        message: 'settings.security.mfa_enable_message',
        confirmText: 'settings.security.mfa_enable_confirm',
        variant: 'warning',
      });
      if (!confirmed) return;
    }
    this.savingMfa.set(true);
    this.http.patch<{ requireMfa: boolean }>(`${environment.apiUrl}/organizations/security-settings`, { requireMfa: next }).subscribe({
      next: ({ requireMfa }) => {
        this.savingMfa.set(false);
        this.requireMfa.set(requireMfa);
        this.notifications.showSuccess(requireMfa ? 'settings.security.mfa_enabled' : 'settings.security.mfa_disabled');
      },
      error: (error: unknown) => {
        this.savingMfa.set(false);
        this.notifications.showHttpError(error, 'settings.security.mfa_save_failed');
      },
    });
  }

  setFilter(patch: Partial<AuditFilters>): void {
    this.filters.update((filters) => ({ ...filters, ...patch }));
    this.page.set(1);
    this.loadTrail();
  }

  clearFilters(): void {
    this.filters.set({ userId: null, actionType: null, entity: null, from: null, to: null });
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
      if (value) params = params.set(key, value);
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

  /** The entity's name in the reader's language, or the identifier made readable. */
  entityName(entity: string): string {
    const key = `settings.security.entity.${entity.toLowerCase()}`;
    const label = this.translate.instant(key);
    if (label !== key) return label;
    return entity.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
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
