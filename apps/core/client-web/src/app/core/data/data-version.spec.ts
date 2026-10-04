import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TAB_CONTEXT } from '../tabs/tab-context';
import { TabStateService } from '../tabs/tab-state.service';
import { dataVersionInterceptor } from './data-version.interceptor';
import { DataVersionService, refreshWhenStale } from './data-version.service';

/** QA M-06: lists and documents did not follow changes made in another tab. */
describe('data freshness', () => {
  const activeTabId = signal<string | null>('tab-a');
  let reloads = 0;

  @Component({ standalone: true, template: '' })
  class Screen {
    constructor() {
      refreshWhenStale(() => reloads++);
    }
  }

  beforeEach(() => {
    reloads = 0;
    activeTabId.set('tab-a');
    TestBed.configureTestingModule({
      imports: [Screen],
      providers: [
        provideHttpClient(withInterceptors([dataVersionInterceptor])),
        provideHttpClientTesting(),
        { provide: TabStateService, useValue: { activeTabId } },
        { provide: TAB_CONTEXT, useValue: { tabId: 'tab-a' } },
      ],
    });
  });

  function mount() {
    const fixture = TestBed.createComponent(Screen);
    fixture.detectChanges();
    return fixture;
  }

  it('a successful write moves the version; a read, a failure or a session call does not', () => {
    const http = TestBed.inject(HttpClient);
    const backend = TestBed.inject(HttpTestingController);
    const data = TestBed.inject(DataVersionService);

    http.get('/x').subscribe();
    backend.expectOne('/x').flush({});
    http.post('/api/v1/auth/refresh', {}).subscribe();
    backend.expectOne('/api/v1/auth/refresh').flush({});
    http.post('/api/v1/invoices', {}).subscribe({ error: () => undefined });
    backend.expectOne('/api/v1/invoices').flush({}, { status: 400, statusText: 'Bad Request' });
    expect(data.version()).toBe(0);

    http.post('/api/v1/customer-payments', {}).subscribe();
    backend.expectOne('/api/v1/customer-payments').flush({});
    expect(data.version()).toBe(1);
  });

  it('reloads a screen when its tab comes back after a change elsewhere', () => {
    const fixture = mount();
    const data = TestBed.inject(DataVersionService);

    activeTabId.set('tab-b');
    fixture.detectChanges();
    data.changed(); // a payment, registered from tab B
    fixture.detectChanges();
    expect(reloads).toBe(0);

    activeTabId.set('tab-a');
    fixture.detectChanges();
    expect(reloads).toBe(1);
  });

  it('does not reload for its own writes, nor on return when nothing changed', () => {
    const fixture = mount();
    const data = TestBed.inject(DataVersionService);

    data.changed(); // this screen's own save, while on screen
    fixture.detectChanges();
    activeTabId.set('tab-b');
    fixture.detectChanges();
    activeTabId.set('tab-a');
    fixture.detectChanges();
    expect(reloads).toBe(0);
  });
});
