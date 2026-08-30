import { Component, signal, Input, Output, EventEmitter, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Shield, X, AlertCircle, Loader2, KeyRound } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Which credential the server will accept for this step-up. Decided by the server, not here.
 *
 * `'sso'` is not optional to support. An account provisioned through enterprise SSO or a social
 * provider has neither a password nor a TOTP secret, and the server answers `'sso'` for it. This
 * union used to omit that value, so the component fell through to the password prompt, sent a
 * password the account does not have, received 403, and rendered it as "too many attempts" — an
 * unbreakable loop that left every federated account unable to invite a colleague, change its
 * own email, revoke a session, open billing or enrol a second factor.
 */
export type StepUpFactor = 'password' | 'otp' | 'sso' | 'none';

/**
 * Re-authentication prompt shown before a sensitive action.
 *
 * It renders whichever factor the account actually uses. Asking for a password on an account
 * protected by TOTP is not a smaller version of the right prompt — it is a dead end, because the
 * server will reject a password for that account and the user has no way to supply what it wants.
 */
@Component({
  selector: 'app-password-confirm-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, TranslateModule],
  templateUrl: './password-confirm-modal.component.html',
  styleUrls: ['./password-confirm-modal.component.scss'],
})
export class PasswordConfirmModalComponent {
  @Input() isLoading = false;
  @Input() error: string | null = null;
  @Input() remainingAttempts: number | null = null;
  @Input() factor: StepUpFactor = 'password';
  /** Name of the identity provider, when the server named one. Shown on the federated prompt. */
  @Input() idpName: string | null = null;

  @Output() confirmed = new EventEmitter<string>();
  /** Raised when the user accepts being sent to their identity provider to re-authenticate. */
  @Output() federate = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  protected readonly ShieldIcon = Shield;
  protected readonly XIcon = X;
  protected readonly AlertIcon = AlertCircle;
  protected readonly LoaderIcon = Loader2;
  protected readonly KeyIcon = KeyRound;

  /** Holds whichever credential the current factor calls for. */
  credential = signal('');

  get isOtp(): boolean {
    return this.factor === 'otp';
  }

  /**
   * The account re-authenticates at its identity provider, so there is no credential to type
   * here — the prompt explains the redirect and asks for consent to leave the page.
   */
  get isFederated(): boolean {
    return this.factor === 'sso';
  }

  /** True when this prompt has an input to fill. */
  get needsCredential(): boolean {
    return this.factor === 'password' || this.factor === 'otp';
  }

  /**
   * True when the account has neither a password nor a second factor — a federated identity that
   * has never enrolled one. There is nothing to prompt for, so the modal explains the situation
   * instead of showing an input nothing will accept.
   */
  get cannotStepUp(): boolean {
    return this.factor === 'none';
  }

  onConfirm(): void {
    if (this.isLoading || this.cannotStepUp) return;
    if (this.isFederated) {
      this.federate.emit();
      return;
    }
    if (this.credential()) {
      this.confirmed.emit(this.credential());
    }
  }

  onCancel(): void {
    this.credential.set('');
    this.cancelled.emit();
  }

  /**
   * Escape closes the dialog.
   *
   * The backdrop's click handler is a mouse convenience; the keyboard equivalent for a modal is
   * Escape, handled at the document level so it works wherever focus happens to be. Satisfying the
   * template linter by putting `tabindex="0"` and `role="button"` on the backdrop instead would
   * have added a phantom tab stop in front of the dialog — a worse experience for exactly the
   * users the rule exists to protect.
   */
  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    this.onCancel();
  }

}
