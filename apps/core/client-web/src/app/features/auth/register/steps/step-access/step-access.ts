import { 
  Component, 
  Input, 
  ChangeDetectionStrategy, 
  ChangeDetectorRef,
  inject
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { AuthInputComponent } from '../../../components/auth-input/auth-input.component';
import { PasswordValidatorComponent } from '../../../components/password-validator/password-validator.component';
import { LucideAngularModule, Mail, Lock, AlertCircle } from 'lucide-angular';

@Component({
  selector: 'app-step-access',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslateModule,
    AuthInputComponent,
    PasswordValidatorComponent,
    LucideAngularModule
  ],
  templateUrl: './step-access.html',
  styleUrls: ['./step-access.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StepAccess {
  @Input() parentForm!: FormGroup;
  
  readonly MailIcon = Mail;
  readonly LockIcon = Lock;
  readonly AlertCircleIcon = AlertCircle;
  
  private cdRef = inject(ChangeDetectorRef);

  get passwordGroup(): FormGroup | null {
    return this.parentForm?.get?.('passwordGroup') as FormGroup;
  }

  getErrorMessage(controlName: string): string {
    const control = controlName.includes('.')
      ? this.parentForm.get(controlName)
      : this.parentForm.get(controlName);

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
