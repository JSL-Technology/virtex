import { Component, Input, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, ReactiveFormsModule, FormControl } from '@angular/forms';

@Component({
  selector: 'app-auth-input',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AuthInputComponent),
      multi: true
    }
  ],
  templateUrl: './auth-input.component.html',
  styleUrls: ['./auth-input.component.scss']
})
export class AuthInputComponent implements ControlValueAccessor {
  @Input() id = `input-${Math.random().toString(36).substr(2, 9)}`;
  @Input() label = '';
  @Input() type = 'text';
  @Input() placeholder = '';
  @Input() required = false;
  @Input() hasIcon = false;
  @Input() errorMessage = '';
  @Input() autocomplete = '';
  @Input() showForgotPassword = false; // Added property to support logic if needed, though currently controlled externally

  control = new FormControl();
  inputType = 'text';

  // Value Accessor methods
  onChange = (value: any) => {};
  onTouched = () => {};

  ngOnInit() {
    this.inputType = this.type;
  }

  togglePasswordVisibility() {
    this.inputType = this.inputType === 'password' ? 'text' : 'password';
  }

  get hasError(): boolean {
    return !!(this.control.invalid && (this.control.dirty || this.control.touched)) || !!this.errorMessage;
  }

  // ControlValueAccessor Interface Implementation
  writeValue(value: any): void {
    this.control.setValue(value, { emitEvent: false });
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
    this.control.valueChanges.subscribe(fn);
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  setDisabledState?(isDisabled: boolean): void {
    isDisabled ? this.control.disable() : this.control.enable();
  }
}
