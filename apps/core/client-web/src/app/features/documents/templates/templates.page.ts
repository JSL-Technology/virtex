import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, FileText, Upload, Download, Trash2 } from 'lucide-angular';
import { ListShellComponent } from '../../../shared/components/gestures';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import {
  DocumentNode,
  DocumentTemplateType,
  DocumentsService,
} from '../../../core/api/documents.service';

/** The kinds a file can be tagged as. `NONE` is not a template and is not offered here. */
const TEMPLATE_TYPES: DocumentTemplateType[] = ['INVOICE', 'QUOTE', 'EMAIL', 'CONTRACT', 'OTHER'];

/**
 * Document templates: the reusable models a business keeps.
 *
 * ## What this was
 *
 * Three templates written into the component — `Plantilla de Factura Estándar`, `Plantilla de
 * Cotización de Servicios`, `Email de Recordatorio de Pago` — which could not be opened, edited,
 * downloaded or replaced, and were identical for every tenant of the product.
 *
 * ## What a template honestly is here
 *
 * A file somebody uploaded and tagged. The product has no template *engine* — nothing that merges
 * a document into a letterhead or sends an email from a stored body — and a screen that implied one
 * existed was the misleading part. What it can do, and now does, is hold the models a business
 * actually works from: the letterhead their invoices are printed on, the contract they adapt per
 * client, the wording they paste into a reminder. They live in the same repository as everything
 * else and are simply marked.
 */
@Component({
  selector: 'app-templates-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent],
  templateUrl: './templates.page.html',
  styleUrls: ['./templates.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplatesPage {
  private readonly documents = inject(DocumentsService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);

  protected readonly FileIcon = FileText;
  protected readonly UploadIcon = Upload;
  protected readonly DownloadIcon = Download;
  protected readonly DeleteIcon = Trash2;

  readonly types = TEMPLATE_TYPES;
  readonly templates = signal<DocumentNode[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly busy = signal(false);
  /** What the next upload will be tagged as. */
  readonly uploadType = signal<DocumentTemplateType>('INVOICE');

  readonly isEmpty = computed(() => !this.loading() && this.templates().length === 0);

  constructor() {
    this.reload();
  }

  onFileChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.busy.set(true);
    this.documents.upload(file, { templateType: this.uploadType() }).subscribe({
      next: () => {
        this.busy.set(false);
        input.value = '';
        this.reload();
      },
      error: (error) => { input.value = ''; this.fail(error); },
    });
  }

  retag(node: DocumentNode, templateType: DocumentTemplateType): void {
    this.busy.set(true);
    this.documents.update(node.id, { templateType }).subscribe({
      next: () => { this.busy.set(false); this.reload(); },
      error: (error) => this.fail(error),
    });
  }

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

  async remove(node: DocumentNode): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'DIALOG.DELETE_DOCUMENT.TITLE',
      message: 'DIALOG.DELETE_DOCUMENT.MESSAGE',
      messageParams: { name: node.name },
      confirmText: 'COMMON.DELETE',
      variant: 'danger',
    });
    if (!confirmed) return;

    this.busy.set(true);
    this.documents.remove(node.id).subscribe({
      next: () => { this.busy.set(false); this.reload(); },
      error: (error) => this.fail(error),
    });
  }

  private reload(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.documents.list({ templatesOnly: true }).subscribe({
      next: (page) => { this.templates.set(page.rows); this.loading.set(false); },
      error: () => { this.templates.set([]); this.loading.set(false); this.failed.set(true); },
    });
  }

  private fail(error: { error?: { message?: string } }): void {
    this.busy.set(false);
    const message = error?.error?.message;
    this.notifications.showError(
      typeof message === 'string' ? message : 'DOCUMENTS.REPOSITORY.ACTION_FAILED',
    );
  }
}
