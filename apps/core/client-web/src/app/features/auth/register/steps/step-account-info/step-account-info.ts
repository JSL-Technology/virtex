import { Component, Input, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, FormGroupDirective } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AuthInputComponent } from '../../../components/auth-input/auth-input.component';
import { PasswordValidatorComponent } from '../../../components/password-validator/password-validator.component';
import { HttpClient } from '@angular/common/http';
import { AsyncValidators } from '../../../../../shared/validators/async.validators';

@Component({
  selector: 'app-step-account-info',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslateModule,
    AuthInputComponent,
    PasswordValidatorComponent
  ],
  templateUrl: './step-account-info.html',
})
export class StepAccountInfo implements OnInit {
  @Input() group!: FormGroup;
  private http = inject(HttpClient);

  ngOnInit() {
    if (this.group) {
        const emailControl = this.group.get('email');
        if (emailControl) {
            emailControl.addAsyncValidators(AsyncValidators.createEmailValidator(this.http));
            emailControl.updateValueAndValidity();
        }
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
