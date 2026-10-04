import { ChangeDetectionStrategy, Component, computed, inject, signal, ElementRef, effect, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
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
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { DocumentNode, DocumentsService, DocumentTemplateType } from '../data/documents.service';

/** What a file can be marked as. `NONE` means an ordinary file. */
const TEMPLATE_TYPES: readonly DocumentTemplateType[] = ['INVOICE', 'QUOTE', 'EMAIL', 'CONTRACT', 'OTHER'];

/** The two ways of reading the repository: by folder, or the files marked as templates. */
export type RepositoryView = 'files' | 'templates';
import { CanOpenDirective } from '../../../core/modules/can-open.directive';
import { VX_SORT, sortable } from '../../../shared/components/sort';

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
 *
 * ## Templates are a view of it, not a second page
 *
 * A template here is a file marked with what it is a model of — the letterhead invoices are printed
 * on, the contract adapted per client. It lived on a page of its own («Plantillas») with its own
 * upload and delete, over the same files. It is now a view of this one: «Plantillas» lists every
 * marked file across the tree, and any file can be marked or unmarked from its row. Odoo's
 * Documents and NetSuite's File Cabinet treat it the same way — a facet of the library, not a
 * second library.
 */
@Component({
  selector: 'app-repository-page',
  standalone: true,
  imports: [...VX_SORT, CanOpenDirective, CommonModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent],
  templateUrl: './repository.page.html',
  styleUrls: ['./repository.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryPage {
  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.files(), { size: (item) => (item.kind === 'FOLDER' ? null : Number(item.fileSize)) });
  private readonly documents = inject(DocumentsService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);

  protected readonly FolderIcon = Folder;
  protected readonly UploadIcon = Upload;
  protected readonly DownloadIcon = Download;
  protected readonly DeleteIcon = Trash2;
  protected readonly RenameIcon = Pencil;
  protected readonly UpIcon = CornerLeftUp;

  protected readonly templateTypes = TEMPLATE_TYPES;

  /** By folder, or every file marked as a template wherever it is filed. */
  readonly view = signal<RepositoryView>('files');
  /** In the templates view, narrow to one kind; null shows all of them. */
  readonly templateFilter = signal<DocumentTemplateType | null>(null);
  /** What an upload made from the templates view is marked as. */
  readonly uploadType = signal<DocumentTemplateType>('INVOICE');
  readonly inTemplates = computed(() => this.view() === 'templates');

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

  showView(view: RepositoryView): void {
    if (this.view() === view) return;
    this.view.set(view);
    this.search.set('');
    this.newFolderOpen.set(false);
    this.reload();
  }

  filterTemplates(type: DocumentTemplateType | ''): void {
    this.templateFilter.set(type === '' ? null : type);
    this.reload();
  }

  /** Marks a file as a template of some kind, or (`NONE`) as an ordinary file again. */
  retag(node: DocumentNode, templateType: DocumentTemplateType): void {
    if (node.kind !== 'FILE' || node.templateType === templateType) return;
    this.busy.set(true);
    this.documents.update(node.id, { templateType }).subscribe({
      next: () => { this.busy.set(false); this.reload(); },
      error: (error) => this.fail(error),
    });
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /** The name field, focused when the row opens: the user just asked to type a name. */
  private readonly folderInput = viewChild<ElementRef<HTMLInputElement>>('folderInput');
  private readonly focusFolderInput = effect(() => this.folderInput()?.nativeElement.focus());

  /** What the new folder will be called, as typed. The row stays open until the server agrees. */
  readonly folderName = signal('');

  /**
   * The row closed before the server answered, so a refused name — one already used in this
   * folder — disappeared together with the reason (QA M-14). It now closes on success only.
   */
  createFolder(): void {
    const trimmed = this.folderName().trim();
    if (!trimmed) {
      this.notifications.showError('documents.repository.folder_name_required');
      return;
    }
    this.busy.set(true);
    this.documents.createFolder(trimmed, this.currentFolderId()).subscribe({
      next: () => {
        this.busy.set(false);
        this.folderName.set('');
        this.newFolderOpen.set(false);
        this.reload();
      },
      error: (error) => this.fail(error),
    });
  }

  onFileChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.busy.set(true);
    // From the templates view the file is filed at the root and marked; from a folder it is filed
    // there, unmarked, exactly as before.
    const options = this.inTemplates()
      ? { parentId: null, templateType: this.uploadType() }
      : { parentId: this.currentFolderId() };
    this.documents.upload(file, options).subscribe({
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

  async remove(node: DocumentNode): Promise<void> {
    // A folder takes everything under it, so the confirmation says which it is.
    const dialogKey = node.kind === 'FOLDER' ? 'dialog.delete_folder' : 'dialog.delete_document';
    const confirmed = await this.dialog.confirm({
      title: `${dialogKey}.TITLE`,
      message: `${dialogKey}.MESSAGE`,
      messageParams: { name: node.name },
      confirmText: 'common.delete',
      variant: 'danger',
    });
    if (!confirmed) return;

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

    const query = this.inTemplates()
      ? {
          // One or the other: the server reads `templatesOnly` as «any kind but NONE», which would
          // override a specific kind if both were sent.
          ...(this.templateFilter() ? { templateType: this.templateFilter() as DocumentTemplateType } : { templatesOnly: true }),
          search: this.search() || undefined,
        }
      : { parentId: this.currentFolderId(), search: this.search() || undefined };
    this.documents
      .list(query)
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

    const folderId = this.inTemplates() ? null : this.currentFolderId();
    if (folderId) {
      this.documents.breadcrumb(folderId).subscribe({
        next: (trail) => this.breadcrumb.set(trail),
        error: () => this.breadcrumb.set([]),
      });
    } else {
      this.breadcrumb.set([]);
    }
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    this.notifications.showHttpError(error, 'documents.repository.action_failed');
  }
}
