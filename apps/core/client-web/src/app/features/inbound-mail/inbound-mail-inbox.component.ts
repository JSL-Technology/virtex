import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { LucideAngularModule, Mail, RotateCcw, X } from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { composeKey } from '@virteex/shared/types';
import { VxBadgeComponent, VxTone } from '../../shared/components/badge/badge.component';
import { InboundMailPurpose, InboundMailService, InboundMessage, InboundMessageStatus } from './inbound-mail.service';

/** One thing in a message a person has to finish, as the purpose's module described it. */
export interface InboxReviewItem {
  key: string;
  label: string;
  reasons: string[];
  /** Where to finish it: the form, prefilled. */
  link: unknown[];
  queryParams: Record<string, string>;
}

const OPEN: InboundMessageStatus[] = ['RECEIVED', 'PROCESSING', 'NEEDS_REVIEW', 'FAILED', 'REJECTED', 'PROCESSED'];

/**
 * What arrived by mail for one purpose: what became a draft (to open), what waits for a person (to
 * finish in the form), what failed (to retry). Shown on the list it feeds — supplier bills, quotes.
 */
@Component({
  selector: 'app-inbound-mail-inbox',
  standalone: true,
  imports: [RouterLink, TranslatePipe, LucideAngularModule, VxBadgeComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inbound-mail-inbox.component.html',
  styleUrl: './inbound-mail-inbox.component.scss',
})
export class InboundMailInboxComponent implements OnInit {
  private readonly api = inject(InboundMailService);

  readonly purpose = input.required<InboundMailPurpose>();
  readonly messages = signal<InboundMessage[]>([]);
  readonly busy = signal<string | null>(null);
  readonly failed = signal(false);
  readonly visible = computed(() => this.messages().filter((message) => message.status !== 'DISMISSED'));

  protected readonly MailIcon = Mail;
  protected readonly RetryIcon = RotateCcw;
  protected readonly DismissIcon = X;
  protected readonly k = composeKey;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.api.messages(this.purpose(), OPEN).subscribe({
      next: (list) => {
        this.messages.set(list.slice(0, 20));
        this.failed.set(false);
      },
      // Without the permission, or without mail set up, there is simply nothing to show.
      error: () => this.failed.set(true),
    });
  }

  tone(status: InboundMessageStatus): VxTone {
    return status === 'PROCESSED' ? 'ok' : status === 'NEEDS_REVIEW' ? 'warning' : status === 'FAILED' || status === 'REJECTED' ? 'danger' : 'info';
  }

  /** The items of a message a person has to finish, in the purpose's own terms. */
  reviewItems(message: InboundMessage): InboxReviewItem[] {
    const review = message.review ?? {};
    if (this.purpose() === 'BILLS') {
      const bills = (review['bills'] as Array<{ attachmentId: string; fileName: string; reasons: string[]; purchaseOrder: { id: string } | null }>) ?? [];
      return bills.map((bill) => ({
        key: bill.attachmentId,
        label: bill.fileName,
        reasons: bill.reasons.map((reason) => composeKey('inbound_mail.bill_reason', reason)),
        link: ['/accounts-payable/new'],
        queryParams: { fromMail: message.id, attachment: bill.attachmentId, ...(bill.purchaseOrder ? { purchaseOrderId: bill.purchaseOrder.id } : {}) },
      }));
    }
    const order = review['order'] as { reasons: string[] } | undefined;
    return order
      ? [{ key: message.id, label: message.subject, reasons: order.reasons.map((reason) => composeKey('inbound_mail.order_reason', reason)), link: ['/quotes/new'], queryParams: { fromMail: message.id } }]
      : [];
  }

  retry(message: InboundMessage): void {
    this.busy.set(message.id);
    this.api.retry(this.purpose(), message.id).subscribe({
      next: () => {
        this.busy.set(null);
        this.load();
      },
      error: () => this.busy.set(null),
    });
  }

  dismiss(message: InboundMessage): void {
    this.busy.set(message.id);
    this.api.dismiss(this.purpose(), message.id).subscribe({
      next: () => {
        this.busy.set(null);
        this.messages.update((list) => list.filter((item) => item.id !== message.id));
      },
      error: () => this.busy.set(null),
    });
  }

  open(message: InboundMessage, attachmentId: string): void {
    this.api.attachment(this.purpose(), message.id, attachmentId).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
    });
  }
}
