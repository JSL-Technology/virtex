import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  signal,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Phone, AlertCircle, Loader } from 'lucide-angular';
import { ReCaptchaV3Service, RecaptchaV3Module } from 'ng-recaptcha-19';
import { recaptchaToken$ } from '../../../../../core/auth/recaptcha-token';
import { switchMap } from 'rxjs/operators';
import { OtpComponent } from '../../../../../shared/components/otp/otp.component';
import { AuthService } from '../../../../../core/services/auth';

@Component({
  selector: 'app-step-phone-verify',
  standalone: true,
  imports: [CommonModule, TranslateModule, LucideAngularModule, OtpComponent, RecaptchaV3Module],
  templateUrl: './step-phone-verify.html',
  styleUrls: ['./step-phone-verify.scss'],
})
export class StepPhoneVerify implements OnInit {
  @Input({ required: true }) phone!: string;
  @Output() verified = new EventEmitter<string>();
  /**
   * The SMS channel itself is down — no provider configured, or the provider refused.
   *
   * Emitted so the wizard can stop gating on a verification that cannot happen. `RegisterUserDto`
   * declares `phone` and `phoneVerificationCode` optional precisely so signup does not depend on
   * SMS ("mandatory SMS at signup is real friction for corporate buyers"), and the server answers
   * an unconfigured provider with "use email verification instead" — but the wizard demanded the
   * code anyway, so a deployment without Twilio could not register a single account.
   */
  @Output() unavailable = new EventEmitter<void>();

  @ViewChild(OtpComponent) otpComponent?: OtpComponent;

  private authService = inject(AuthService);
  private recaptchaV3Service = inject(ReCaptchaV3Service, { optional: true });

  readonly PhoneIcon = Phone;
  readonly AlertCircleIcon = AlertCircle;
  readonly LoaderIcon = Loader;

  isSending = signal(false);
  codeSent = signal(false);
  sendError = signal<string | null>(null);
  /** True once the channel has failed server-side: the step becomes skippable rather than a wall. */
  channelDown = signal(false);
  isVerifying = signal(false);

  /** The phone is optional. With no number there is nothing to verify, so the step becomes a skip. */
  get hasPhone(): boolean {
    return !!this.phone?.trim();
  }

  ngOnInit() {
    // Don't fire an SMS — or surface an error — for a step the user legitimately left blank.
    if (this.hasPhone) {
      this.sendCode();
    }
  }

  sendCode() {
    if (this.isSending() || !this.hasPhone) return;
    this.isSending.set(true);
    this.sendError.set(null);

    // reCAPTCHA is best-effort: an invalid site key, an ad-blocker or a domain mismatch must not be
    // able to block phone verification. The server decides whether a token is required (it honours
    // RECAPTCHA_DISABLED via the guard's skipIf), so a failure here degrades to "no token" instead
    // of tearing down the whole flow with a script error the user can do nothing about.
    const token$ = recaptchaToken$(this.recaptchaV3Service, 'phone_verify_send');

    token$.pipe(
      switchMap((recaptchaToken) =>
        this.authService.sendPublicVerification(this.phone, 'PHONE_VERIFY', recaptchaToken)
      )
    ).subscribe({
      next: () => {
        this.codeSent.set(true);
        this.isSending.set(false);
      },
      error: (err) => {
        this.sendError.set('auth.step_phone_verify.sms_send_failed');
        this.isSending.set(false);

        // 5xx is the channel, not the number: an unconfigured or failing provider. Retrying will
        // not help the user, so the step says so and stops blocking the wizard. A 4xx stays a
        // retryable user error (a malformed number, a rate limit) and keeps the gate.
        const status = Number(err?.status ?? 0);
        if (status >= 500 || status === 0) {
          this.channelDown.set(true);
          this.unavailable.emit();
        }
      },
    });
  }

  onVerify(code: string) {
    if (this.isVerifying()) return;
    this.isVerifying.set(true);

    const token$ = recaptchaToken$(this.recaptchaV3Service, 'phone_verify_check');

    token$.pipe(
      switchMap((recaptchaToken) =>
        this.authService.verifyPublicCode(this.phone, 'PHONE_VERIFY', code, recaptchaToken)
      )
    ).subscribe({
      next: (response) => {
        this.isVerifying.set(false);
        this.otpComponent?.handleSuccess('register.verify.phone_ok');
        setTimeout(() => this.verified.emit(response.preVerifiedToken), 600);
      },
      error: (err) => {
        this.isVerifying.set(false);
        const msg = err?.error?.message || 'register.errors.code_invalid';
        this.otpComponent?.handleError(msg);
      },
    });
  }

  onResend() {
    this.sendCode();
  }
}
