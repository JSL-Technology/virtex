import { Component, Input, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AuthInputComponent } from '../../../components/auth-input/auth-input.component';
import { PasswordValidatorComponent } from '../../../components/password-validator/password-validator.component';
import { HttpClient } from '@angular/common/http';
import { AsyncValidators } from '../../../../../shared/validators/async.validators';
import { LucideAngularModule, User, Mail, Lock, Phone, Briefcase, Camera, UserCircle, AlertCircle } from 'lucide-angular';

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

  avatarPreview = signal<string | null>(null);

  ngOnInit() {
    if (this.group) {
        const emailControl = this.group.get('email');
        if (emailControl) {
            emailControl.addAsyncValidators(AsyncValidators.createEmailValidator(this.http));
            emailControl.updateValueAndValidity();
        }
    }
  }

  onFileSelected(event: any) {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        this.avatarPreview.set(reader.result as string);
        this.group.patchValue({ avatarUrl: file });
      };
      reader.readAsDataURL(file);
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
