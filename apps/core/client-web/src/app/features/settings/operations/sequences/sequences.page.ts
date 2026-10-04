import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { environment } from '../../../../../environments/environment';
import { NotificationService } from '../../../../core/services/notification';

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
 * e-CF) is not this: it is the ranges the authority grants, in «Facturación electrónica».
 */
@Component({
  selector: 'app-sequence-settings-page',
  standalone: true,
  imports: [TranslateModule, RouterLink],
  templateUrl: './sequences.page.html',
  styleUrls: ['./sequences.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SequenceSettingsPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly notifications = inject(NotificationService);
  private readonly url = `${environment.apiUrl}/document-sequences`;

  readonly rows = signal<DocumentSequenceRow[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly savingType = signal<string | null>(null);
  /** Edits by type, until saved. */
  readonly drafts = signal<Record<string, { prefix: string; nextNumber: number }>>({});

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.http.get<DocumentSequenceRow[]>(this.url).subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.drafts.set({});
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
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

  save(row: DocumentSequenceRow): void {
    if (!this.changed(row) || this.goesBack(row)) return;
    const draft = this.draftOf(row);
    this.savingType.set(row.type);
    this.http
      .patch<DocumentSequenceRow>(`${this.url}/${row.type}`, {
        ...(draft.prefix !== row.prefix ? { prefix: draft.prefix } : {}),
        ...(draft.nextNumber !== row.nextNumber ? { nextNumber: draft.nextNumber } : {}),
      })
      .subscribe({
        next: (saved) => {
          this.savingType.set(null);
          this.rows.update((rows) => rows.map((r) => (r.type === saved.type ? saved : r)));
          this.drafts.update((drafts) => {
            const next = { ...drafts };
            delete next[row.type];
            return next;
          });
          this.notifications.showSuccess('settings.sequences.saved');
        },
        error: (error: unknown) => {
          this.savingType.set(null);
          this.notifications.showHttpError(error, 'settings.sequences.save_failed');
        },
      });
  }
}
