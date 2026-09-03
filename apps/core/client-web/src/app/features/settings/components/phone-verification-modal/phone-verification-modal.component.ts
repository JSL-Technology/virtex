
import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy, signal, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Phone, X, Check } from 'lucide-angular';
import { AuthService } from '../../../../core/services/auth';
import { NotificationService } from '../../../../core/services/notification';
import { IntlPhoneInputComponent } from '../../../../shared/components/intl-phone-input/intl-phone-input.component';

@Component({
  selector: 'app-phone-verification-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TranslateModule, LucideAngularModule, IntlPhoneInputComponent],
  templateUrl: './phone-verification-modal.component.html',
  styleUrls: ['./phone-verification-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhoneVerificationModalComponent {
  @Input() isOpen = signal(false);
  @Output() closed = new EventEmitter<void>();
  @Output() verified = new EventEmitter<void>();

  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);

  protected readonly PhoneIcon = Phone;
  protected readonly XIcon = X;
  protected readonly CheckIcon = Check;

  // Holds an E.164 number. The IntlPhoneInputComponent bound to this control does the normalization
  // and validation with libphonenumber, so `sendPhoneOtp`/`verifyPhoneOtp` receive exactly the shape
  // the API's IsE164PhoneNumber validator requires.
  phoneControl = new FormControl('', [Validators.required]);
  otpControl = new FormControl('', [Validators.required, Validators.minLength(6)]);

  isLoading = signal(false);
  otpSent = signal(false);

  sendOtp() {
    if (this.phoneControl.invalid) return;
    this.isLoading.set(true);

    this.authService.sendPhoneOtp(this.phoneControl.value!).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.otpSent.set(true);
        this.notificationService.showSuccess('SETTINGS.PROFILE.OTP_SENT');
      },
      error: () => {
        this.isLoading.set(false);
        this.notificationService.showError('SETTINGS.PROFILE.ERRORS.OTP_SEND');
      }
    });
  }

  verifyOtp() {
    if (this.otpControl.invalid) return;
    this.isLoading.set(true);

    this.authService.verifyPhoneOtp(this.otpControl.value!, this.phoneControl.value!).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.notificationService.showSuccess('SETTINGS.PROFILE.PHONE_VERIFIED');
        this.verified.emit();
        this.closed.emit();
      },
      error: () => {
        this.isLoading.set(false);
        this.notificationService.showError('SETTINGS.PROFILE.ERRORS.OTP_INVALID');
      }
    });
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
    this.closed.emit();
  }

}
