import { Component, Input, signal } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { AuthInputComponent } from '../../../components/auth-input/auth-input.component';
import { PasswordValidatorComponent } from '../../../components/password-validator/password-validator.component';
import { LucideAngularModule, User, Phone, Briefcase, Mail, Lock, AlertCircle } from 'lucide-angular';

@Component({
  selector: 'app-step-account',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslateModule,
    AuthInputComponent,
    PasswordValidatorComponent,
    LucideAngularModule
  ],
  templateUrl: './step-account.html',
  styleUrls: ['./step-account.scss']
})
export class StepAccount {
  @Input() group!: FormGroup;

  readonly UserIcon = User;
  readonly PhoneIcon = Phone;
  readonly JobIcon = Briefcase;
  readonly MailIcon = Mail;
  readonly LockIcon = Lock;
  readonly AlertCircleIcon = AlertCircle;

  getErrorMessage(controlName: string): string {
    const control = this.group.get(controlName);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'REGISTER.ERRORS.REQUIRED';
      if (control.errors['email']) return 'REGISTER.ERRORS.EMAIL_INVALID';
      if (control.errors['minlength']) return 'REGISTER.ERRORS.PASSWORD_LENGTH';
      if (control.errors['strongPassword']) return 'REGISTER.ERRORS.PASSWORD_WEAK';
      if (control.errors['passwordMismatch']) return 'REGISTER.ERRORS.PASSWORD_MISMATCH';
    }
    return '';
  }
}
