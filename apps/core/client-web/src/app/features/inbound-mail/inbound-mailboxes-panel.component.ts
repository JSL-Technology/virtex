import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { LucideAngularModule, Copy, RefreshCw } from 'lucide-angular';
import { composeKey } from '@virteex/shared/types';
import { DialogService } from '../../core/services/dialog.service';
import { NotificationService } from '../../core/services/notification';
import { AuthService } from '../../core/services/auth';
import { InboundMailbox, InboundMailPurpose, InboundMailService } from './inbound-mail.service';

const PURPOSES: InboundMailPurpose[] = ['BILLS', 'ORDERS'];

/**
 * The company's mail addresses: one for supplier bills, one for customer orders. Suppliers and
 * customers write to them; what arrives becomes drafts for a person to review. The address's
 * token is its secret, so it can be replaced, and who may write to it can be narrowed.
 */
@Component({
  selector: 'app-inbound-mailboxes-panel',
  standalone: true,
  imports: [TranslatePipe, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inbound-mailboxes-panel.component.html',
  styleUrl: './inbound-mail-inbox.component.scss',
})
export class InboundMailboxesPanelComponent implements OnInit {
  private readonly api = inject(InboundMailService);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);
  private readonly auth = inject(AuthService);

  readonly purposes = PURPOSES;
  readonly canManage = signal(false);
  readonly configured = signal(true);
  readonly mailboxes = signal<Partial<Record<InboundMailPurpose, InboundMailbox>>>({});
  readonly busy = signal<InboundMailPurpose | null>(null);
  protected readonly CopyIcon = Copy;
  protected readonly RotateIcon = RefreshCw;
  protected readonly k = composeKey;

  ngOnInit(): void {
    this.canManage.set(this.auth.hasPermissions(['inbound_mail:manage']));
    if (!this.canManage()) return;
    this.api.mailboxes().subscribe({
      next: ({ configured, mailboxes }) => {
        this.configured.set(configured);
        this.mailboxes.set(Object.fromEntries(mailboxes.map((mailbox) => [mailbox.purpose, mailbox])));
      },
      error: () => this.canManage.set(false),
    });
  }

  async rotate(purpose: InboundMailPurpose): Promise<void> {
    if (this.mailboxes()[purpose]) {
      const confirmed = await this.dialog.confirm({
        title: 'inbound_mail.rotate_title',
        message: 'inbound_mail.rotate_message',
        confirmText: 'inbound_mail.rotate',
        variant: 'danger',
      });
      if (!confirmed) return;
    }
    this.busy.set(purpose);
    this.api.rotate(purpose).subscribe({
      next: (mailbox) => this.store(mailbox),
      error: (err) => this.failed(err),
    });
  }

  setActive(purpose: InboundMailPurpose, active: boolean): void {
    this.busy.set(purpose);
    this.api.update(purpose, { active }).subscribe({ next: (mailbox) => this.store(mailbox), error: (err) => this.failed(err) });
  }

  saveSenders(purpose: InboundMailPurpose, text: string): void {
    const allowedSenders = text.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean);
    this.busy.set(purpose);
    this.api.update(purpose, { allowedSenders }).subscribe({
      next: (mailbox) => {
        this.store(mailbox);
        this.notifications.showSuccess('inbound_mail.senders_saved');
      },
      error: (err) => this.failed(err),
    });
  }

  copy(address: string): void {
    void navigator.clipboard?.writeText(address).then(() => this.notifications.showSuccess('inbound_mail.copied'));
  }

  private store(mailbox: InboundMailbox): void {
    this.mailboxes.update((map) => ({ ...map, [mailbox.purpose]: mailbox }));
    this.busy.set(null);
  }

  private failed(err: unknown): void {
    this.busy.set(null);
    this.notifications.showHttpError(err, 'inbound_mail.save_failed');
  }
}
