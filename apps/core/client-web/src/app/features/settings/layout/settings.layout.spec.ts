import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { SettingsLayout } from './settings.layout';
import { LoaderService } from '../../../shared/service/loader.service';
import { ActivatedRoute, NavigationEnd, NavigationStart, Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { LoaderComponent } from '../../../shared/components/loader/loader.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { AuthService } from '../../../core/services/auth';
import { MockAuthService } from '../../../core/services/testing/mock-auth.service';
import { signal } from '@angular/core';

describe('SettingsLayout', () => {
  let component: SettingsLayout;
  let fixture: ComponentFixture<SettingsLayout>;
  let loaderServiceMock: any;
  let routerEventsSubject: Subject<any>;
  let routerMock: any;

  beforeEach(async () => {
    loaderServiceMock = {
      isLoading: jest.fn().mockReturnValue(signal(false)), // Return a signal, not observable, if that's what the component expects
      show: jest.fn(),
      hide: jest.fn()
    };

    routerEventsSubject = new Subject<any>();
    routerMock = {
      events: routerEventsSubject.asObservable(),
      url: '/settings',
      navigate: jest.fn(),
      createUrlTree: jest.fn(),
      serializeUrl: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        SettingsLayout,
        CommonModule,
        LucideAngularModule,
        HasPermissionDirective,
        LoaderComponent,
        BrowserAnimationsModule
      ],
      providers: [
        { provide: LoaderService, useValue: loaderServiceMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } },
        { provide: AuthService, useClass: MockAuthService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsLayout);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should show loader on settings navigation start', () => {
    const navStart = new NavigationStart(1, '/settings/profile');
    routerEventsSubject.next(navStart);
    expect(loaderServiceMock.show).toHaveBeenCalledWith('settings');
  });

  it('should hide loader on settings navigation end', () => {
    const navEnd = new NavigationEnd(1, '/settings/profile', '/settings/profile');
    routerEventsSubject.next(navEnd);
    expect(loaderServiceMock.hide).toHaveBeenCalledWith('settings');
  });

  it('should NOT show loader on non-settings navigation', () => {
    // This logic relies on "includes /settings".
    // If we navigate to /dashboard, it shouldn't trigger 'settings' loader.
    const navStart = new NavigationStart(1, '/dashboard');
    routerEventsSubject.next(navStart);
    // Actually the component implementation checks if event.url includes /settings
    // If target is /dashboard, event.url is /dashboard.
    expect(loaderServiceMock.show).not.toHaveBeenCalled();
  });
});
