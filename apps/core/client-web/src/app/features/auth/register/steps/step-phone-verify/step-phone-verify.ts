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
import { switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
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

  @ViewChild(OtpComponent) otpComponent?: OtpComponent;

  private authService = inject(AuthService);
  private recaptchaV3Service = inject(ReCaptchaV3Service, { optional: true });

  readonly PhoneIcon = Phone;
  readonly AlertCircleIcon = AlertCircle;
  readonly LoaderIcon = Loader;

  isSending = signal(false);
  codeSent = signal(false);
  sendError = signal<string | null>(null);
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
    const token$ = this.recaptchaV3Service
      ? this.recaptchaV3Service.execute('phone_verify_send').pipe(catchError(() => of(undefined)))
      : of(undefined);

    token$.pipe(
      switchMap((recaptchaToken) =>
        this.authService.sendPublicVerification(this.phone, 'PHONE_VERIFY', recaptchaToken)
      )
    ).subscribe({
      next: () => {
        this.codeSent.set(true);
        this.isSending.set(false);
      },
      error: () => {
        this.sendError.set('No se pudo enviar el SMS. Por favor intenta de nuevo.');
        this.isSending.set(false);
      },
    });
  }

  onVerify(code: string) {
    if (this.isVerifying()) return;
    this.isVerifying.set(true);

    const token$ = this.recaptchaV3Service
      ? this.recaptchaV3Service.execute('phone_verify_check').pipe(catchError(() => of(undefined)))
      : of(undefined);

    token$.pipe(
      switchMap((recaptchaToken) =>
        this.authService.verifyPublicCode(this.phone, 'PHONE_VERIFY', code, recaptchaToken)
      )
    ).subscribe({
      next: (response) => {
        this.isVerifying.set(false);
        this.otpComponent?.handleSuccess('REGISTER.VERIFY.PHONE_OK');
        setTimeout(() => this.verified.emit(response.preVerifiedToken), 600);
      },
      error: (err) => {
        this.isVerifying.set(false);
        const msg = err?.error?.message || 'REGISTER.ERRORS.CODE_INVALID';
        this.otpComponent?.handleError(msg);
      },
    });
  }

  onResend() {
    this.sendCode();
  }
}
