import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MyProfilePage } from './my-profile.page';
import { AuthService } from '../../../core/services/auth';
import { UsersService } from '../../../core/api/users.service';
import { SecurityService } from '../../../core/api/security.service';
import { NotificationService } from '../../../core/services/notification';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-security-settings',
  standalone: true,
  template: ''
})
class MockSecuritySettingsComponent {}

@Component({
  selector: 'app-phone-verification-modal',
  standalone: true,
  template: '',
  inputs: ['isOpen']
})
class MockPhoneVerificationModalComponent {}

class MockAuthService {
  currentUser = () => ({
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.com',
    phone: '1234567890',
    jobTitle: 'Developer',
    preferredLanguage: 'en',
    isTwoFactorEnabled: false
  });
  checkAuthStatus = jest.fn().mockReturnValue(of({}));
}

class MockUsersService {
  updateProfile = jest.fn().mockReturnValue(of({}));
  getJobTitles = jest.fn().mockReturnValue(of(['CEO', 'Developer']));
}

class MockNotificationService {
  showSuccess = jest.fn();
  showError = jest.fn();
}

class MockSecurityService {
  getActiveSessions = jest.fn().mockReturnValue(of([]));
  generate2faSecret = jest.fn().mockReturnValue(of({ secret: 'XYZ', otpauthUrl: 'otpauth://...' }));
}

describe('MyProfilePage', () => {
  let component: MyProfilePage;
  let fixture: ComponentFixture<MyProfilePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        MyProfilePage,
        BrowserAnimationsModule,
        HttpClientTestingModule,
        TranslateModule.forRoot(),
        FormsModule,
        ReactiveFormsModule
      ],
      providers: [
        { provide: AuthService, useClass: MockAuthService },
        { provide: UsersService, useClass: MockUsersService },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: SecurityService, useClass: MockSecurityService }
      ]
    })
    .overrideComponent(MyProfilePage, {
      set: {
        imports: [
          CommonModule,
          ReactiveFormsModule,
          LucideAngularModule,
          TranslateModule,
          MockSecuritySettingsComponent,
          MockPhoneVerificationModalComponent
        ]
      }
    })
    .compileComponents();

    fixture = TestBed.createComponent(MyProfilePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize form with user data including phone and jobTitle', () => {
    expect(component.profileForm.get('phone')?.value).toBe('1234567890');
    expect(component.profileForm.get('jobTitle')?.value).toBe('Developer');
  });
});
