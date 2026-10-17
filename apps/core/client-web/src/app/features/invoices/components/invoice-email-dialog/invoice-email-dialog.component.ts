import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Sparkles } from 'lucide-angular';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { composeKey } from '@virteex/shared/types';
import { VxDialogComponent } from '../../../../shared/components/dialog';
import { InvoicesService, MessageTone } from '../../../../core/services/invoices';
import { NotificationService } from '../../../../core/services/notification';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_NOTE_CHARS = 1000;

/**
 * Sending an invoice by e-mail: to whom, and a personal note.
 *
 * The note can be drafted by the assistant in the tone the person picks; it arrives in the box for
 * them to read and edit, and is sent only when they press Send. The figures in a drafted note come
 * from the invoice — the server refuses a draft that states any other.
 */
@Component({
  selector: 'app-invoice-email-dialog',
  standalone: true,
  imports: [FormsModule, TranslateModule, LucideAngularModule, VxDialogComponent, ...VX_FORM_A11Y],
  templateUrl: './invoice-email-dialog.component.html',
  styleUrl: './invoice-email-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvoiceEmailDialogComponent {
  private readonly invoices = inject(InvoicesService);
  private readonly notifications = inject(NotificationService);

  readonly invoiceId = input.required<string>();
  readonly number = input<string>('');
  readonly customer = input<string>('');
  /** Whether the assistant may draft the note (permission and plan). */
  readonly canCompose = input(false);
  readonly busy = input(false);

  readonly sent = output<{ to?: string; message?: string }>();
  readonly dismissed = output<void>();

  protected readonly ComposeIcon = Sparkles;
  protected readonly MAX_NOTE_CHARS = MAX_NOTE_CHARS;
  protected readonly TONES: MessageTone[] = ['cordial', 'formal', 'firm'];
  protected readonly k = composeKey;

  readonly to = signal('');
  readonly message = signal('');
  readonly tone = signal<MessageTone>('cordial');
  readonly composing = signal(false);

  readonly addressInvalid = computed(() => {
    const address = this.to().trim();
    return !!address && !EMAIL.test(address);
  });
  readonly canSend = computed(() => !this.busy() && !this.composing() && !this.addressInvalid() && this.message().length <= MAX_NOTE_CHARS);

  compose(): void {
    if (this.composing()) return;
    this.composing.set(true);
    this.invoices.composeMessage(this.invoiceId(), this.tone()).subscribe({
      next: ({ message }) => {
        this.message.set(message);
        this.composing.set(false);
      },
      error: (err) => {
        this.composing.set(false);
        this.notifications.showHttpError(err, 'invoices.email.compose_failed');
      },
    });
  }

  send(): void {
    if (!this.canSend()) return;
    const to = this.to().trim();
    const message = this.message().trim();
    this.sent.emit({ to: to || undefined, message: message || undefined });
  }
}
