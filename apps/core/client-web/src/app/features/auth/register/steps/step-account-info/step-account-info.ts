import { Component, Input, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AuthInputComponent } from '../../../components/auth-input/auth-input.component';
import { PasswordValidatorComponent } from '../../../components/password-validator/password-validator.component';
import { HttpClient } from '@angular/common/http';
import { AsyncValidators } from '../../../../../shared/validators/async.validators';
import { LucideAngularModule, User, Mail, Lock, Phone, Briefcase, Camera, UserCircle, AlertCircle } from 'lucide-angular';
import { AuthService } from '../../../../../core/services/auth';

@Component({
  selector: 'app-step-account-info',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslateModule,
    AuthInputComponent,
    PasswordValidatorComponent,
    LucideAngularModule
  ],
  templateUrl: './step-account-info.html',
  styleUrls: ['./step-account-info.scss']
})
export class StepAccountInfo implements OnInit {
  @Input() group!: FormGroup;
  private http = inject(HttpClient);

  readonly UserIcon = User;
  readonly MailIcon = Mail;
  readonly LockIcon = Lock;
  readonly PhoneIcon = Phone;
  readonly JobIcon = Briefcase;
  readonly CameraIcon = Camera;
  readonly AvatarIcon = UserCircle;
  readonly AlertCircleIcon = AlertCircle;

  emailSent = signal(false);
  phoneSent = signal(false);
  emailVerified = signal(false);
  phoneVerified = signal(false);

  private authService = inject(AuthService);

  ngOnInit() {
    if (this.group) {
        const emailControl = this.group.get('email');
        if (emailControl) {
            emailControl.addAsyncValidators(AsyncValidators.createEmailValidator(this.http));
            emailControl.updateValueAndValidity();
        }
    }
  }

  sendEmailCode() {
    const email = this.group.get('email')?.value;
    if (email) {
      this.authService.sendPublicVerification(email, 'EMAIL_VERIFY' as any).subscribe(() => {
        this.emailSent.set(true);
      });
    }
  }

  verifyEmailCode() {
    const email = this.group.get('email')?.value;
    const code = this.group.get('emailCode')?.value;
    if (email && code) {
      this.authService.verifyPublicCode(email, 'EMAIL_VERIFY' as any, code).subscribe(() => {
        this.emailVerified.set(true);
      });
    }
  }

  sendPhoneCode() {
    const phone = this.group.get('phone')?.value;
    if (phone) {
      this.authService.sendPublicVerification(phone, 'PHONE_VERIFY' as any).subscribe(() => {
        this.phoneSent.set(true);
      });
    }
  }

  verifyPhoneCode() {
    const phone = this.group.get('phone')?.value;
    const code = this.group.get('phoneCode')?.value;
    if (phone && code) {
      this.authService.verifyPublicCode(phone, 'PHONE_VERIFY' as any, code).subscribe(() => {
        this.phoneVerified.set(true);
      });
    }
  }

  getErrorMessage(controlName: string): string {
    const control = this.group.get(controlName);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'REGISTER.ERRORS.REQUIRED';
      if (control.errors['email']) return 'REGISTER.ERRORS.EMAIL_INVALID';
      if (control.errors['emailExists']) return 'Este correo ya está registrado.';
      if (control.errors['minlength']) return 'REGISTER.ERRORS.PASSWORD_LENGTH';
      if (control.errors['strongPassword']) return 'REGISTER.ERRORS.PASSWORD_WEAK';
      if (control.errors['passwordMismatch']) return 'REGISTER.ERRORS.PASSWORD_MISMATCH';
    }
    return '';
  }
}
