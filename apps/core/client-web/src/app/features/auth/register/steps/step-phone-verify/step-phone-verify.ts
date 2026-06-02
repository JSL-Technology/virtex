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
import { OtpComponent } from '../../../../../shared/components/otp/otp.component';
import { AuthService } from '../../../../../core/services/auth';

@Component({
  selector: 'app-step-phone-verify',
  standalone: true,
  imports: [CommonModule, TranslateModule, LucideAngularModule, OtpComponent],
  templateUrl: './step-phone-verify.html',
  styleUrls: ['./step-phone-verify.scss'],
})
export class StepPhoneVerify implements OnInit {
  @Input({ required: true }) phone!: string;
  @Output() verified = new EventEmitter<string>();

  @ViewChild(OtpComponent) otpComponent?: OtpComponent;

  private authService = inject(AuthService);

  readonly PhoneIcon = Phone;
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

    this.authService.sendPublicVerification(this.phone, 'PHONE_VERIFY').subscribe({
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

    this.authService.verifyPublicCode(this.phone, 'PHONE_VERIFY', code).subscribe({
      next: (response) => {
        this.isVerifying.set(false);
        this.otpComponent?.handleSuccess('¡Número verificado correctamente!');
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
