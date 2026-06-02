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
import { LucideAngularModule, Mail, CheckCircle, AlertCircle, Loader } from 'lucide-angular';
import { OtpComponent } from '../../../../../shared/components/otp/otp.component';
import { AuthService } from '../../../../../core/services/auth';

@Component({
  selector: 'app-step-email-verify',
  standalone: true,
  imports: [CommonModule, TranslateModule, LucideAngularModule, OtpComponent],
  templateUrl: './step-email-verify.html',
  styleUrls: ['./step-email-verify.scss'],
})
export class StepEmailVerify implements OnInit {
  @Input({ required: true }) email!: string;
  @Output() verified = new EventEmitter<string>();

  @ViewChild(OtpComponent) otpComponent?: OtpComponent;

  private authService = inject(AuthService);

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

    this.authService.sendPublicVerification(this.email, 'EMAIL_VERIFY').subscribe({
      next: () => {
        this.codeSent.set(true);
        this.isSending.set(false);
      },
      error: () => {
        this.sendError.set('No se pudo enviar el código. Por favor intenta de nuevo.');
        this.isSending.set(false);
      },
    });
  }

  onVerify(code: string) {
    if (this.isVerifying()) return;
    this.isVerifying.set(true);

    this.authService.verifyPublicCode(this.email, 'EMAIL_VERIFY', code).subscribe({
      next: (response) => {
        this.isVerifying.set(false);
        this.otpComponent?.handleSuccess('¡Correo verificado correctamente!');
        setTimeout(() => this.verified.emit(response.preVerifiedToken), 600);
      },
      error: (err) => {
        this.isVerifying.set(false);
        const msg = err?.error?.message || 'Código incorrecto. Inténtalo de nuevo.';
        this.otpComponent?.handleError(msg);
      },
    });
  }

  onResend() {
    this.sendCode();
  }
}
