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
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LucideAngularModule, Mail, CheckCircle, AlertCircle, Loader } from 'lucide-angular';
import { ReCaptchaV3Service, RecaptchaV3Module } from 'ng-recaptcha-19';
import { recaptchaToken$ } from '../../../../../core/auth/recaptcha-token';
import { switchMap } from 'rxjs/operators';
import { OtpComponent } from '../../../../../shared/components/otp/otp.component';
import { AuthService } from '../../../../../core/services/auth';

@Component({
  selector: 'app-step-email-verify',
  standalone: true,
  imports: [CommonModule, TranslateModule, LucideAngularModule, OtpComponent, RecaptchaV3Module],
  templateUrl: './step-email-verify.html',
  styleUrls: ['./step-email-verify.scss'],
})
export class StepEmailVerify implements OnInit {
  @Input({ required: true }) email!: string;
  /**
   * The first name the wizard collected on the previous step, for the greeting on the email.
   *
   * Optional so the step still works if it is ever mounted before the name exists; absent, the
   * email greets without a name rather than with a placeholder.
   */
  @Input() firstName?: string;
  /** The country being registered in, for the country segment of the magic link. */
  @Input() country?: string;
  @Output() verified = new EventEmitter<string>();

  @ViewChild(OtpComponent) otpComponent?: OtpComponent;

  private authService = inject(AuthService);
  private recaptchaV3Service = inject(ReCaptchaV3Service, { optional: true });
  private translate = inject(TranslateService);

  readonly MailIcon = Mail;
  readonly CheckCircleIcon = CheckCircle;
  readonly AlertCircleIcon = AlertCircle;
  readonly LoaderIcon = Loader;

  isSending = signal(false);
  codeSent = signal(false);
  sendError = signal<string | null>(null);
  isVerifying = signal(false);

  ngOnInit() {
    this.sendCode();
  }

  sendCode() {
    if (this.isSending()) return;
    this.isSending.set(true);
    this.sendError.set(null);

    // reCAPTCHA is best-effort: a script/domain/key problem must not block email verification. The
    // server governs whether a token is required (RECAPTCHA_DISABLED via the guard's skipIf), so a
    // failure here degrades to "no token" rather than tearing the flow down.
    const token$ = recaptchaToken$(this.recaptchaV3Service, 'email_verify_send');

    token$.pipe(
      switchMap((recaptchaToken) =>
        this.authService.sendPublicVerification(this.email, 'EMAIL_VERIFY', recaptchaToken, {
          firstName: this.firstName,
          //  El idioma que el lector eligió, no el del servidor: decide el idioma del correo y el
          //  segmento de idioma del enlace mágico que lleva dentro.
          language: this.translate.currentLang,
          country: this.country,
        })
      )
    ).subscribe({
      next: () => {
        this.codeSent.set(true);
        this.isSending.set(false);
      },
      error: () => {
        this.sendError.set('REGISTER.ERRORS.CODE_SEND');
        this.isSending.set(false);
      },
    });
  }

  onVerify(code: string) {
    if (this.isVerifying()) return;
    this.isVerifying.set(true);

    const token$ = recaptchaToken$(this.recaptchaV3Service, 'email_verify_check');

    token$.pipe(
      switchMap((recaptchaToken) =>
        this.authService.verifyPublicCode(this.email, 'EMAIL_VERIFY', code, recaptchaToken)
      )
    ).subscribe({
      next: (response) => {
        this.isVerifying.set(false);
        this.otpComponent?.handleSuccess('REGISTER.VERIFY.EMAIL_OK');
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
