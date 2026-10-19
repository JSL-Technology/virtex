import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  signal,
  ViewChild,
  inject,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { LucideAngularModule, Phone, AlertCircle, Loader, Mail, Clock } from 'lucide-angular';
import { ReCaptchaV3Service, RecaptchaV3Module } from 'ng-recaptcha-19';
import { recaptchaToken$ } from '../../../../../core/auth/recaptcha-token';
import { switchMap } from 'rxjs/operators';
import { OtpComponent } from '../../../../../shared/components/otp/otp.component';
import { AuthService } from '../../../../../core/services/auth';
import { AppError, ErrorHandlerService, retryAfterOf } from '../../../../../core/services/error-handler.service';
import { NotificationService } from '../../../../../core/services/notification';
import { LanguageService } from '../../../../../core/services/language';
import { formatInternational } from '../../../../../shared/utils/phone.util';
import { relativeWait } from '../../../../../shared/utils/relative-wait';

/**
 * How the person chose to go on without confirming the number now (QA A-10).
 *
 *   - `later`: keep the number, unverified. It is saved as such and can be confirmed from the
 *     profile, where the same verification runs with a session behind it.
 *   - `email`: drop the number and rely on the email, which step 2 already verified. For somebody
 *     whose carrier does not deliver the SMS at all, a number that can never be confirmed is not
 *     worth keeping.
 */
export type PhoneSkipMode = 'later' | 'email';

/** Why the SMS did not go out, as the step words it. A catalogue key and its values. */
interface SendFailure {
  key: string;
  params?: Record<string, unknown>;
  /** Whether pressing "resend" could help now. */
  retryable: boolean;
}

@Component({
  selector: 'app-step-phone-verify',
  standalone: true,
  imports: [CommonModule, TranslateModule, LucideAngularModule, OtpComponent, RecaptchaV3Module],
  templateUrl: './step-phone-verify.html',
  styleUrls: ['./step-phone-verify.scss'],
})
export class StepPhoneVerify implements OnInit {
  /** Turns the API's error contract (`code`, `messageKey`, `params`) into the reader's sentence. */
  private readonly errorText = inject(NotificationService);
  private readonly errors = inject(ErrorHandlerService);
  private readonly language = inject(LanguageService);
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

  /** The person chose to continue without confirming the number now. See {@link PhoneSkipMode}. */
  @Output() skipped = new EventEmitter<PhoneSkipMode>();

  @ViewChild(OtpComponent) otpComponent?: OtpComponent;

  private authService = inject(AuthService);
  private recaptchaV3Service = inject(ReCaptchaV3Service, { optional: true });

  readonly PhoneIcon = Phone;
  readonly AlertCircleIcon = AlertCircle;
  readonly LoaderIcon = Loader;
  readonly MailIcon = Mail;
  readonly ClockIcon = Clock;

  isSending = signal(false);
  codeSent = signal(false);
  /** Why the last send failed, with what to say about it; null while nothing has failed. */
  sendFailure = signal<SendFailure | null>(null);
  /** True once the channel has failed server-side: the step becomes skippable rather than a wall. */
  channelDown = signal(false);
  isVerifying = signal(false);

  /**
   * The number as its own country writes it — `+1 202-555-0147`, `+52 55 1234 5678` — not the raw
   * E.164 the API stores (QA M-22). People recognise their number by its grouping.
   */
  readonly displayPhone = computed(() => formatInternational(this.phoneValue()));
  private readonly phoneValue = signal('');

  /** The phone is optional. With no number there is nothing to verify, so the step becomes a skip. */
  get hasPhone(): boolean {
    return !!this.phone?.trim();
  }

  ngOnInit() {
    this.phoneValue.set(this.phone ?? '');
    // Don't fire an SMS — or surface an error — for a step the user legitimately left blank.
    if (this.hasPhone) {
      this.sendCode();
    }
  }

  sendCode() {
    if (this.isSending() || !this.hasPhone) return;
    this.isSending.set(true);
    this.sendFailure.set(null);

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
        this.isSending.set(false);
        const failure = this.describeFailure(err);
        this.sendFailure.set(failure);

        // A channel that is down, or a number in a country the product does not text, will not
        // come back by pressing a button: the step stops being a gate and says so.
        if (!failure.retryable) {
          this.channelDown.set(true);
          this.unavailable.emit();
        }
      },
    });
  }

  /**
   * Say WHY the SMS did not go out, and how long to wait when waiting helps (QA A-10).
   *
   * It used to be one sentence for everything — "the verification SMS could not be sent, try
   * again" — while the server had said precisely that this number had already had too many codes
   * and would be refused for most of an hour. The person retried, failed, and left. The server's
   * code decides the wording now; the wait comes from the payload or the `Retry-After` header.
   */
  private describeFailure(err: unknown): SendFailure {
    const described = this.errors.describe(err as AppError);
    const wait = described.retryAfterSeconds ?? retryAfterOf(err as AppError);
    const when = wait ? relativeWait(wait, this.language.currentLocale()) : null;

    switch (described.code) {
      case 'SMS_NUMBER_LIMIT':
        return { key: 'auth.step_phone_verify.errors.number_limit', params: { when }, retryable: true };
      case 'SMS_COUNTRY_NOT_SUPPORTED':
        return { key: 'auth.step_phone_verify.errors.country_not_supported', retryable: false };
      case 'SMS_UNAVAILABLE':
        return { key: 'auth.step_phone_verify.sms_unavailable_continue', retryable: false };
    }
    if (described.status === 429) {
      return when
        ? { key: 'auth.step_phone_verify.errors.too_many_requests', params: { when }, retryable: true }
        : { key: 'errors.too_many_requests', retryable: true };
    }
    // 5xx or no answer at all is the channel, not the number: an unconfigured or failing
    // provider. A 4xx we do not recognise stays a retryable user error (a malformed number).
    if (described.status >= 500 || described.status === 0) {
      return { key: 'auth.step_phone_verify.sms_unavailable_continue', retryable: false };
    }
    return { key: described.messageKey || 'auth.step_phone_verify.sms_send_failed', params: described.params, retryable: true };
  }

  skip(mode: PhoneSkipMode): void {
    this.skipped.emit(mode);
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
        const msg = this.errorText.httpErrorMessage(err, 'register.errors.code_invalid');
        this.otpComponent?.handleError(msg);
      },
    });
  }

  onResend() {
    this.sendCode();
  }
}
