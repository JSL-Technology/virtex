import { Component, signal, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Shield, X, AlertCircle, Loader2, KeyRound } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';

/** Which credential the server will accept for this step-up. Decided by the server, not here. */
export type StepUpFactor = 'password' | 'otp' | 'none';

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

  @Output() confirm = new EventEmitter<string>();
  @Output() cancel = new EventEmitter<void>();

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
   * True when the account has neither a password nor a second factor — a federated identity that
   * has never enrolled one. There is nothing to prompt for, so the modal explains the situation
   * instead of showing an input nothing will accept.
   */
  get cannotStepUp(): boolean {
    return this.factor === 'none';
  }

  onConfirm(): void {
    if (this.credential() && !this.isLoading && !this.cannotStepUp) {
      this.confirm.emit(this.credential());
    }
  }

  onCancel(): void {
    this.credential.set('');
    this.cancel.emit();
  }
}
