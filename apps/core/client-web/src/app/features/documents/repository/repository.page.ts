import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  LucideAngularModule,
  Folder,
  File as FileIcon,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  Upload,
  Download,
  Trash2,
  Pencil,
  CornerLeftUp,
} from 'lucide-angular';
import { ListShellComponent } from '../../../shared/components/gestures';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { NotificationService } from '../../../core/services/notification';
import {
  DocumentNode,
  DocumentsService,
} from '../../../core/api/documents.service';

/**
 * The tenant's document repository.
 *
 * ## What this was
 *
 * Two folders and four files written into the component — `Facturas de Proveedores, 15 archivos`,
 * `Reporte_Ventas_Q2_2025.pdf, 2.1 MB` — the same six rows for every tenant of the product. The
 * upload button uploaded nothing, the "New folder" button created nothing, the folders did not
 * open, and the search box filtered a list nobody could add to. The storage service it needed had
 * been there the whole time, serving avatars and journal-entry attachments.
 */
@Component({
  selector: 'app-repository-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent],
  templateUrl: './repository.page.html',
  styleUrls: ['./repository.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryPage {
  private readonly documents = inject(DocumentsService);
  private readonly notifications = inject(NotificationService);
  private readonly translate = inject(TranslateService);

  protected readonly FolderIcon = Folder;
  protected readonly UploadIcon = Upload;
  protected readonly DownloadIcon = Download;
  protected readonly DeleteIcon = Trash2;
  protected readonly RenameIcon = Pencil;
  protected readonly UpIcon = CornerLeftUp;

  /** Where we are. Null is the root. */
  readonly currentFolderId = signal<string | null>(null);
  readonly breadcrumb = signal<DocumentNode[]>([]);
  readonly items = signal<DocumentNode[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly busy = signal(false);

  /**
   * The search box.
   *
   * It used to filter an array that could never grow. It now searches the whole tree, because
   * "find the lease I scanned last year" is the question a repository is for, and it is not a
   * question about the folder you happen to be standing in.
   */
  readonly search = signal('');

  /** Which inline editor is open. Inline rather than a dialog: a rename is one field. */
  readonly newFolderOpen = signal(false);
  readonly renaming = signal<string | null>(null);

  readonly files = computed(() => this.items());
  readonly atRoot = computed(() => this.currentFolderId() === null);

  constructor() {
    this.reload();
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  open(node: DocumentNode): void {
    if (node.kind === 'FOLDER') {
      this.currentFolderId.set(node.id);
      this.search.set('');
      this.reload();
    } else {
      this.download(node);
    }
  }

  goTo(folderId: string | null): void {
    this.currentFolderId.set(folderId);
    this.search.set('');
    this.reload();
  }

  goUp(): void {
    const trail = this.breadcrumb();
    this.goTo(trail.length > 1 ? trail[trail.length - 2].id : null);
  }

  onSearch(term: string): void {
    this.search.set(term);
    this.reload();
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  createFolder(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.busy.set(true);
    this.documents.createFolder(trimmed, this.currentFolderId()).subscribe({
      next: () => { this.busy.set(false); this.reload(); },
      error: (error) => this.fail(error),
    });
  }

  onFileChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.busy.set(true);
    this.documents.upload(file, { parentId: this.currentFolderId() }).subscribe({
      next: () => {
        this.busy.set(false);
        // Clearing the input is what lets the same file be uploaded twice in a row.
        input.value = '';
        this.reload();
      },
      error: (error) => { input.value = ''; this.fail(error); },
    });
  }

  /**
   * Download through the API, not through a bare link.
   *
   * The route is authenticated; an `<a href>` carries no credentials, which is why the object URL
   * is built from a blob the client already fetched.
   */
  download(node: DocumentNode): void {
    this.documents.download(node.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = node.name;
        anchor.click();
        URL.revokeObjectURL(url);
      },
      error: (error) => this.fail(error),
    });
  }

  rename(node: DocumentNode, name: string): void {
    const trimmed = name.trim();
    if (!trimmed || trimmed === node.name) return;
    this.busy.set(true);
    this.documents.rename(node.id, trimmed).subscribe({
      next: () => { this.busy.set(false); this.reload(); },
      error: (error) => this.fail(error),
    });
  }

  remove(node: DocumentNode): void {
    // A folder takes everything under it, so the confirmation says which it is.
    const key = node.kind === 'FOLDER'
      ? 'DOCUMENTS.REPOSITORY.CONFIRM_DELETE_FOLDER'
      : 'DOCUMENTS.REPOSITORY.CONFIRM_DELETE_FILE';
    if (!window.confirm(this.translate.instant(key, { name: node.name }))) return;

    this.busy.set(true);
    this.documents.remove(node.id).subscribe({
      next: () => { this.busy.set(false); this.reload(); },
      error: (error) => this.fail(error),
    });
  }

  // ── Presentation ───────────────────────────────────────────────────────────

  iconFor(node: DocumentNode): unknown {
    if (node.kind === 'FOLDER') return Folder;
    const mime = node.mimeType ?? '';
    if (mime.startsWith('image/')) return ImageIcon;
    if (mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv') {
      return FileSpreadsheet;
    }
    if (mime === 'application/pdf' || mime.startsWith('text/') || mime.includes('word')) {
      return FileText;
    }
    return FileIcon;
  }

  /** `2.1 MB`. A folder has no size of its own, and saying "0 B" for one would be a lie. */
  sizeOf(node: DocumentNode): string {
    if (node.kind === 'FOLDER') return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = Number(node.fileSize) || 0;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private reload(): void {
    this.loading.set(true);
    this.failed.set(false);

    this.documents
      .list({ parentId: this.currentFolderId(), search: this.search() || undefined })
      .subscribe({
        next: (page) => {
          this.items.set(page.rows);
          this.loading.set(false);
        },
        error: () => {
          this.items.set([]);
          this.loading.set(false);
          this.failed.set(true);
        },
      });

    const folderId = this.currentFolderId();
    if (folderId) {
      this.documents.breadcrumb(folderId).subscribe({
        next: (trail) => this.breadcrumb.set(trail),
        error: () => this.breadcrumb.set([]),
      });
    } else {
      this.breadcrumb.set([]);
    }
  }

  private fail(error: { error?: { message?: string } }): void {
    this.busy.set(false);
    const message = error?.error?.message;
    this.notifications.showError(
      typeof message === 'string' ? message : 'DOCUMENTS.REPOSITORY.ACTION_FAILED',
    );
  }
}
