
import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Phone, X, Check } from 'lucide-angular';
import { AuthService } from '../../../../core/services/auth';
import { NotificationService } from '../../../../core/services/notification';

@Component({
  selector: 'app-phone-verification-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TranslateModule, LucideAngularModule],
  templateUrl: './phone-verification-modal.component.html',
  styleUrls: ['./phone-verification-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhoneVerificationModalComponent {
  @Input() isOpen = signal(false);
  @Output() close = new EventEmitter<void>();
  @Output() verified = new EventEmitter<void>();

  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);

  protected readonly PhoneIcon = Phone;
  protected readonly XIcon = X;
  protected readonly CheckIcon = Check;

  phoneControl = new FormControl('', [Validators.required]); // E.164 validation ideally
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
        this.close.emit();
      },
      error: () => {
        this.isLoading.set(false);
        this.notificationService.showError('SETTINGS.PROFILE.ERRORS.OTP_INVALID');
      }
    });
  }
}
