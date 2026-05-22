import { TestBed } from '@angular/core/testing';
import { PushNotificationService } from './push-notification.service';
import { SwPush } from '@angular/service-worker';
import { HttpClientTestingModule } from '@angular/common/http/testing';

class MockSwPush {
  isEnabled = false;
  requestSubscription = jest.fn();
}

describe('PushNotificationService', () => {
  let service: PushNotificationService;
  let swPush: SwPush;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        PushNotificationService,
        { provide: SwPush, useClass: MockSwPush }
      ]
    });
    service = TestBed.inject(PushNotificationService);
    swPush = TestBed.inject(SwPush);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should not request subscription if service worker is not enabled', () => {
    const spy = jest.spyOn(console, 'warn');
    service.subscribeToNotifications();
    expect(swPush.requestSubscription).not.toHaveBeenCalled();
    // Warning is suppressed in test/dev environment by default logic modification
    // So we expect it NOT to be called, unless we mock environment.production = true
    expect(spy).not.toHaveBeenCalled();
  });
});
