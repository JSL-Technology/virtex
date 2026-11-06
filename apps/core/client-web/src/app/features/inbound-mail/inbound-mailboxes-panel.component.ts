import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { LucideAngularModule, RefreshCw } from 'lucide-angular';
import { composeKey } from '@virteex/shared/types';
import { forkJoin } from 'rxjs';
import { DialogService } from '../../core/services/dialog.service';
import { NotificationService } from '../../core/services/notification';
import { AuthService } from '../../core/services/auth';
import { VxErrorStateComponent, VxNoticeComponent, VxSpinnerComponent } from '../../shared/components/feedback';
import { SettingsGroupComponent } from '../settings/shared';
import { SettingsChanges, SettingsSaveBarComponent, SettingsShellService } from '../settings/shell';
import { InboundMailbox, InboundMailPurpose, InboundMailService } from './inbound-mail.service';

const PURPOSES: InboundMailPurpose[] = ['BILLS', 'ORDERS'];

/** A sender the address accepts: a full address (ana@proveedor.com) or a domain (@proveedor.com). */
const SENDER = /^(?:[^\s@]+@[^\s@]+\.[^\s@]+|@[^\s@]+\.[^\s@]+)$/;

interface Draft {
  active: boolean;
  senders: string;
}

/**
 * The company's mail addresses: one for supplier bills, one for customer orders. Suppliers and
 * customers write to them; what arrives becomes drafts for a person to review. The address's
 * token is its secret, so it can be replaced, and who may write to it can be narrowed.
 *
 * Whether an address is on and who may write to it are settings, and are saved like every other
 * form of the settings window: with its save bar, which asks before closing with edits pending.
 * Each address had its own «Guardar remitentes» and a box that applied on the spot, and an edit in
 * the senders box was lost without a word when the window closed (GUA-01, GUA-02).
 */
@Component({
  selector: 'app-inbound-mailboxes-panel',
  standalone: true,
  imports: [TranslatePipe, LucideAngularModule, SettingsGroupComponent, SettingsSaveBarComponent, VxErrorStateComponent, VxNoticeComponent, VxSpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inbound-mailboxes-panel.component.html',
  styleUrl: './inbound-mailboxes-panel.component.scss',
})
export class InboundMailboxesPanelComponent implements OnInit {
  private readonly api = inject(InboundMailService);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly shell = inject(SettingsShellService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  readonly purposes = PURPOSES;
  readonly canManage = signal(false);
  readonly state = signal<'loading' | 'error' | 'ready'>('loading');
  readonly loadError = signal<string | null>(null);
  readonly configured = signal(true);
  readonly mailboxes = signal<Partial<Record<InboundMailPurpose, InboundMailbox>>>({});
  readonly drafts = signal<Partial<Record<InboundMailPurpose, Draft>>>({});
  readonly busy = signal<InboundMailPurpose | null>(null);
  readonly saving = signal(false);
  protected readonly RotateIcon = RefreshCw;
  protected readonly k = composeKey;

  /** The addresses whose settings differ from what is saved. */
  readonly changed = computed(() =>
    PURPOSES.filter((purpose) => {
      const mailbox = this.mailboxes()[purpose];
      const draft = this.drafts()[purpose];
      return !!mailbox && !!draft && (draft.active !== mailbox.active || sendersOf(draft.senders).join('\n') !== mailbox.allowedSenders.join('\n'));
    }),
  );
  readonly dirty = computed(() => this.changed().length > 0);

  /** Why it cannot be saved yet, said in the save bar (GUA-03). */
  readonly blockedKey = computed(() =>
    PURPOSES.some((purpose) => sendersOf(this.drafts()[purpose]?.senders ?? '').some((sender) => !SENDER.test(sender)))
      ? 'inbound_mail.invalid_sender'
      : null,
  );

  private readonly changes: SettingsChanges = {
    dirty: this.dirty,
    save: () => this.save(),
    discard: () => this.discard(),
  };

  ngOnInit(): void {
    this.canManage.set(this.auth.hasPermissions(['inbound_mail:manage']));
    if (!this.canManage()) return;
    if (this.shell) {
      this.shell.register(this.changes);
      this.destroyRef.onDestroy(() => this.shell?.unregister(this.changes));
    }
    this.load();
  }

  load(): void {
    this.state.set('loading');
    this.loadError.set(null);
    this.api.mailboxes().subscribe({
      next: ({ configured, mailboxes }) => {
        this.configured.set(configured);
        mailboxes.forEach((mailbox) => this.store(mailbox));
        this.state.set('ready');
      },
      error: (error: unknown) => {
        this.loadError.set(this.notifications.httpErrorMessage(error, 'inbound_mail.load_failed'));
        this.state.set('error');
      },
    });
  }

  patch(purpose: InboundMailPurpose, change: Partial<Draft>): void {
    this.drafts.update((drafts) => ({ ...drafts, [purpose]: { ...(drafts[purpose] as Draft), ...change } }));
  }

  /** Creating or replacing an address is an action, not a setting: it happens now, and replacing asks first. */
  async rotate(purpose: InboundMailPurpose): Promise<void> {
    if (!this.configured() || this.busy() === purpose) return;
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
      next: (mailbox) => {
        this.busy.set(null);
        this.storeAddress(mailbox);
      },
      error: (err) => this.failed(err),
    });
  }

  save(): Promise<boolean> {
    const changed = this.changed();
    if (!changed.length || this.blockedKey()) return Promise.resolve(false);
    this.saving.set(true);
    return new Promise((resolve) => {
      forkJoin(
        changed.map((purpose) => {
          const draft = this.drafts()[purpose] as Draft;
          return this.api.update(purpose, { active: draft.active, allowedSenders: sendersOf(draft.senders) });
        }),
      ).subscribe({
        next: (mailboxes) => {
          this.saving.set(false);
          mailboxes.forEach((mailbox) => this.store(mailbox));
          this.notifications.showSuccess('inbound_mail.saved');
          resolve(true);
        },
        error: (err) => {
          this.saving.set(false);
          this.notifications.showHttpError(err, 'inbound_mail.save_failed');
          resolve(false);
        },
      });
    });
  }

  discard(): void {
    Object.values(this.mailboxes()).forEach((mailbox) => mailbox && this.store(mailbox));
  }

  copy(address: string): void {
    void navigator.clipboard?.writeText(address).then(() => this.notifications.showSuccess('inbound_mail.copied'));
  }

  /** The saved mailbox, and the form reset to it. */
  private store(mailbox: InboundMailbox): void {
    this.mailboxes.update((map) => ({ ...map, [mailbox.purpose]: mailbox }));
    this.drafts.update((drafts) => ({ ...drafts, [mailbox.purpose]: { active: mailbox.active, senders: mailbox.allowedSenders.join('\n') } }));
  }

  /** A new address keeps whatever the person was editing in the form. */
  private storeAddress(mailbox: InboundMailbox): void {
    const draft = this.drafts()[mailbox.purpose];
    this.mailboxes.update((map) => ({ ...map, [mailbox.purpose]: mailbox }));
    if (!draft) this.store(mailbox);
  }

  private failed(err: unknown): void {
    this.busy.set(null);
    this.notifications.showHttpError(err, 'inbound_mail.save_failed');
  }
}

function sendersOf(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}
