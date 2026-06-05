
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PasswordConfirmModalComponent } from './password-confirm-modal.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LucideAngularModule, Shield, X, AlertCircle, Loader2 } from 'lucide-angular';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

describe('PasswordConfirmModalComponent', () => {
  let component: PasswordConfirmModalComponent;
  let fixture: ComponentFixture<PasswordConfirmModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        CommonModule,
        FormsModule,
        LucideAngularModule.pick({ Shield, X, AlertCircle, Loader2 }),
        TranslateModule.forRoot(),
        PasswordConfirmModalComponent
      ],
      providers: [TranslateService]
    }).compileComponents();

    fixture = TestBed.createComponent(PasswordConfirmModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit confirm event with password when onConfirm is called', () => {
    const password = 'test-password';
    component.password.set(password);
    jest.spyOn(component.confirm, 'emit');

    component.onConfirm();

    expect(component.confirm.emit).toHaveBeenCalledWith(password);
  });

  it('should not emit confirm event if password is empty', () => {
    component.password.set('');
    jest.spyOn(component.confirm, 'emit');

    component.onConfirm();

    expect(component.confirm.emit).not.toHaveBeenCalled();
  });

  it('should emit cancel event and clear password when onCancel is called', () => {
    component.password.set('some-password');
    jest.spyOn(component.cancel, 'emit');

    component.onCancel();

    expect(component.password()).toBe('');
    expect(component.cancel.emit).toHaveBeenCalled();
  });

  it('should show loading icon when isLoading is true', () => {
    component.isLoading = true;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as any;
    expect(compiled.querySelector('.spin')).toBeTruthy();
  });

  it('should show error message when error is provided', () => {
    const errorMessage = 'Invalid password';
    component.error = errorMessage;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as any;
    expect(compiled.querySelector('.error-container')).toBeTruthy();
    expect(compiled.querySelector('.error-text')?.textContent).toContain(errorMessage);
  });
});
