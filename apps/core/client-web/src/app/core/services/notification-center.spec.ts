import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { Notification, NotificationCenterService } from './notification-center.service';
import { WebSocketService } from './websocket.service';
import { PushNotificationService } from './push-notification.service';

/** QA B-02: the bell shows the active company's notices, and each one opens what it is about. */
describe('NotificationCenterService', () => {
  const live = new Subject<Notification>();
  const ready = new Subject<void>();
  const router = { navigate: jest.fn(), navigateByUrl: jest.fn() };

  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: router },
        { provide: WebSocketService, useValue: { connectionReady$: ready, listen: () => live, connect: jest.fn() } },
        { provide: PushNotificationService, useValue: { subscribeToNotifications: jest.fn() } },
      ],
    });
    const service = TestBed.inject(NotificationCenterService);
    const http = TestBed.inject(HttpTestingController);
    ready.next();
    return { service, http };
  }

  const notice = (over: Partial<Notification> = {}): Notification => ({
    id: 'n-1',
    title: 'Aprobación pendiente',
    body: 'Espera tu aprobación',
    read: false,
    createdAt: '2026-10-04T10:00:00Z',
    ...over,
  });

  beforeEach(() => jest.clearAllMocks());

  it('loads the list when the company is known, and again when it changes', () => {
    const { service, http } = setup();
    service.setActiveOrganization('org-a');
    http.expectOne((r) => r.url.endsWith('/notifications')).flush([notice()]);
    service.setActiveOrganization('org-a');
    http.expectNone((r) => r.url.endsWith('/notifications'));
    service.setActiveOrganization('org-b');
    http.expectOne((r) => r.url.endsWith('/notifications')).flush([]);
    expect(service.notifications()).toEqual([]);
  });

  it('keeps a live notice about another company out of this one’s bell', () => {
    const { service, http } = setup();
    service.setActiveOrganization('org-a');
    http.expectOne((r) => r.url.endsWith('/notifications')).flush([]);
    live.next(notice({ id: 'other', organizationId: 'org-b' }));
    live.next(notice({ id: 'mine', organizationId: 'org-a' }));
    live.next(notice({ id: 'personal', organizationId: null }));
    expect(service.notifications().map((n) => n.id)).toEqual(['personal', 'mine']);
    expect(service.unreadCount()).toBe(2);
  });

  it('opens a path, opens settings from a fragment, and marks the notice read', () => {
    const { service, http } = setup();
    service.open(notice({ link: '/approvals' }));
    http.expectOne((r) => r.url.endsWith('/notifications/n-1/read')).flush({});
    expect(router.navigateByUrl).toHaveBeenCalledWith('/approvals');

    service.open(notice({ id: 'n-2', read: true, link: '#settings/users' }));
    http.expectNone((r) => r.url.endsWith('/notifications/n-2/read'));
    expect(router.navigate).toHaveBeenCalledWith([], { fragment: 'settings/users' });
  });
});
