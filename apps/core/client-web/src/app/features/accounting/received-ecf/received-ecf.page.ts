import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { VX_DATE } from '../../../shared/components/date';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { AuthService } from '../../../core/services/auth';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { saveFile } from '../../../core/api/data-transfer.service';
import { ReceivedEcf, ReceivedEcfService, ReceivedEcfStatus } from '../data/received-ecf.service';

const STATUS_TONE: Record<ReceivedEcfStatus, VxTone> = {
  RECEIVED: 'warning',
  APPROVED: 'ok',
  REJECTED: 'danger',
};

/** Business days a buyer has to answer a received e-CF before silence counts as acceptance. */
const ANSWER_BUSINESS_DAYS = 3;

/**
 * Comprobantes recibidos: what suppliers sent to the company's e-CF reception service.
 *
 * Each one was acknowledged on arrival (ARECF). What remains is the company's commercial verdict —
 * accept it, or dispute it with a reason — within three business days; silence counts as
 * acceptance, but a dispute never registered cannot be argued later. The deadline is shown so the
 * reader knows which ones cannot wait.
 */
@Component({
  selector: 'app-received-ecf-page',
  standalone: true,
  imports: [...VX_DATE, FormsModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent],
  templateUrl: './received-ecf.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReceivedEcfPage implements OnInit {
  private readonly service = inject(ReceivedEcfService);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);
  private readonly auth = inject(AuthService);

  readonly documents = signal<ReceivedEcf[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filter = signal<ReceivedEcfStatus | ''>('RECEIVED');
  readonly busy = signal<string | null>(null);
  readonly empty = computed(() => !this.loading() && this.documents().length === 0);
  readonly canAnswer = computed(() => this.auth.hasPermissions(['invoices:create']));
  readonly tone = STATUS_TONE;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.list(this.filter() || undefined).subscribe({
      next: (documents) => {
        this.documents.set(documents);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('received_ecf.load_error');
        this.loading.set(false);
      },
    });
  }

  setFilter(value: ReceivedEcfStatus | ''): void {
    this.filter.set(value);
    this.load();
  }

  /** The last day to answer: three business days after it was received. */
  deadline(document: ReceivedEcf): Date {
    return addBusinessDays(new Date(document.receivedAt), ANSWER_BUSINESS_DAYS);
  }

  overdue(document: ReceivedEcf): boolean {
    return document.status === 'RECEIVED' && this.deadline(document).getTime() < Date.now();
  }

  async approve(document: ReceivedEcf): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'received_ecf.approve_title',
      message: 'received_ecf.approve_message',
      messageParams: { ncf: document.ncf, supplier: document.issuerName ?? document.issuerRnc },
      confirmText: 'received_ecf.approve',
    });
    if (ok) this.answer(document, '1');
  }

  async reject(document: ReceivedEcf): Promise<void> {
    const reason = await this.dialog.prompt({
      title: 'received_ecf.reject_title',
      message: 'received_ecf.reject_message',
      messageParams: { ncf: document.ncf },
      confirmText: 'received_ecf.reject',
      variant: 'danger',
      minLength: 5,
      tooShort: 'received_ecf.reject_reason_short',
    });
    if (reason) this.answer(document, '2', reason.trim());
  }

  download(document: ReceivedEcf): void {
    this.service.xml(document.id).subscribe({
      next: (blob) => saveFile({ fileName: `${document.issuerRnc}-${document.ncf}.xml`, blob }),
      error: (err) => this.notifications.showHttpError(err, 'received_ecf.download_error'),
    });
  }

  private answer(document: ReceivedEcf, verdict: '1' | '2', reason?: string): void {
    this.busy.set(document.id);
    this.service.answer(document.id, verdict, reason).subscribe({
      next: () => {
        this.busy.set(null);
        this.notifications.showSuccess(verdict === '1' ? 'received_ecf.approved' : 'received_ecf.rejected');
        this.load();
      },
      error: (err) => {
        this.busy.set(null);
        this.notifications.showHttpError(err, 'received_ecf.answer_error');
      },
    });
  }
}

/** `days` business days after `from` (Monday to Friday; public holidays are not modelled). */
export function addBusinessDays(from: Date, days: number): Date {
  const date = new Date(from);
  let left = days;
  while (left > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return date;
}
