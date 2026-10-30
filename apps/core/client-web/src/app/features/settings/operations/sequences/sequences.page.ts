import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { environment } from '../../../../../environments/environment';
import { NotificationService } from '../../../../core/services/notification';
import { DialogService } from '../../../../core/services/dialog.service';
import { TranslateService } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import { SettingsChanges, SettingsSaveBarComponent, SettingsShellService } from '../../shell';

interface DocumentSequenceRow {
  id: string;
  type: string;
  prefix: string;
  nextNumber: number;
  nextFormatted: string;
}

/**
 * The internal numbering of each document type (QA M-09: «Secuencias» said «En desarrollo»).
 *
 * Prefix and next number, per type. The next number only moves forward — the API refuses to move
 * it back, because a lower number may already be on an issued document. Fiscal numbering (NCF,
 * e-CF) is not this: it is the ranges the authority grants, in «Comprobantes fiscales».
 *
 * One save for the table, not one per row: five «Guardar» buttons was a fourth way of saving in
 * Settings (CG-15). Saving says what changes first — a new prefix applies to documents from now on,
 * and a jump in the number leaves a gap the series will show (CG-19).
 */
@Component({
  selector: 'app-sequence-settings-page',
  standalone: true,
  imports: [TranslateModule, RouterLink, SettingsSaveBarComponent],
  templateUrl: './sequences.page.html',
  styleUrls: ['./sequences.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SequenceSettingsPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly translate = inject(TranslateService);
  private readonly shell = inject(SettingsShellService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private readonly url = `${environment.apiUrl}/document-sequences`;

  readonly rows = signal<DocumentSequenceRow[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  /** The server refused to show the numbering at all: retrying will not change that (CG-17). */
  readonly forbidden = signal(false);
  readonly canEdit = computed(() => this.shell?.canEdit() ?? true);
  /** Edits by type, until saved. */
  readonly drafts = signal<Record<string, { prefix: string; nextNumber: number }>>({});

  /** Rows with an edit that differs from what is saved. */
  readonly changedRows = computed(() => this.rows().filter((row) => this.changed(row)));
  readonly dirty = computed(() => this.changedRows().length > 0);
  readonly invalid = computed(() => this.rows().some((row) => this.goesBack(row)));

  private readonly changes: SettingsChanges = {
    dirty: this.dirty,
    save: () => this.saveAll(),
    discard: () => this.drafts.set({}),
  };

  ngOnInit(): void {
    this.load();
    if (this.shell) {
      this.shell.register(this.changes);
      this.destroyRef.onDestroy(() => this.shell?.unregister(this.changes));
    }
  }

  /** Reads the numbering; after a failed save, keeps the edits so nothing typed is lost. */
  load(keepDrafts = false): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.http.get<DocumentSequenceRow[]>(this.url).subscribe({
      next: (rows) => {
        this.rows.set(rows);
        if (!keepDrafts) this.drafts.set({});
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.forbidden.set((error as { status?: number })?.status === 403);
        this.loadError.set(this.notifications.httpErrorMessage(error, 'settings.sequences.load_failed'));
      },
    });
  }

  draftOf(row: DocumentSequenceRow): { prefix: string; nextNumber: number } {
    return this.drafts()[row.type] ?? { prefix: row.prefix, nextNumber: row.nextNumber };
  }

  edit(row: DocumentSequenceRow, patch: Partial<{ prefix: string; nextNumber: number }>): void {
    this.drafts.update((drafts) => ({ ...drafts, [row.type]: { ...this.draftOf(row), ...patch } }));
  }

  changed(row: DocumentSequenceRow): boolean {
    const draft = this.drafts()[row.type];
    return !!draft && (draft.prefix !== row.prefix || draft.nextNumber !== row.nextNumber);
  }

  /** Said before the round trip; the API refuses it too. */
  goesBack(row: DocumentSequenceRow): boolean {
    return this.draftOf(row).nextNumber < row.nextNumber;
  }

  preview(row: DocumentSequenceRow): string {
    const draft = this.draftOf(row);
    return `${draft.prefix}${String(Math.max(1, Math.trunc(draft.nextNumber || 1))).padStart(8, '0')}`;
  }

  save(): void {
    void this.saveAll();
  }

  /** Saves every changed row, after saying what the change does. */
  async saveAll(): Promise<boolean> {
    const changed = this.changedRows();
    if (!this.canEdit() || changed.length === 0 || this.invalid()) return false;
    const lines = changed.map((row) => {
      const name = this.translate.instant('settings.sequences.type.' + row.type);
      return this.translate.instant('settings.sequences.confirm_line', { document: name, from: row.nextFormatted, to: this.preview(row) });
    });
    const jumps = changed.some((row) => this.draftOf(row).nextNumber > row.nextNumber);
    const confirmed = await this.dialog.confirm({
      title: 'settings.sequences.confirm_title',
      message: jumps ? 'settings.sequences.confirm_message_gap' : 'settings.sequences.confirm_message',
      messageParams: { changes: lines.join(' · ') },
      confirmText: 'settings.sequences.confirm_action',
      variant: 'warning',
    });
    if (!confirmed) return false;

    this.saving.set(true);
    return new Promise((resolve) =>
      forkJoin(
        changed.map((row) => {
          const draft = this.draftOf(row);
          return this.http.patch<DocumentSequenceRow>(`${this.url}/${row.type}`, {
            ...(draft.prefix !== row.prefix ? { prefix: draft.prefix } : {}),
            ...(draft.nextNumber !== row.nextNumber ? { nextNumber: draft.nextNumber } : {}),
          });
        }),
      ).subscribe({
        next: (saved) => {
          this.saving.set(false);
          const byType = new Map(saved.map((row) => [row.type, row]));
          this.rows.update((rows) => rows.map((r) => byType.get(r.type) ?? r));
          this.drafts.set({});
          this.notifications.showSuccess('settings.sequences.saved');
          resolve(true);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.notifications.showHttpError(error, 'settings.sequences.save_failed');
          // Some rows may have saved before the one that failed: show what the server holds.
          this.load(true);
          resolve(false);
        },
      }),
    );
  }
}
