import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AppLinkPipe } from './app-link.pipe';
import { ActiveOrganizationService } from './active-organization.service';

describe('AppLinkPipe (QA R3-M11)', () => {
  it('puts a server link in the active company and keeps its query as query parameters', () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => `/e/acme${path}` } },
      ],
    });
    const pipe = TestBed.runInInjectionContext(() => new AppLinkPipe());
    const tree = pipe.transform('/accounting/journal-entries?periodId=p1&status=draft,pending_approval')!;
    expect(TestBed.inject(Router).serializeUrl(tree)).toBe('/e/acme/accounting/journal-entries?periodId=p1&status=draft,pending_approval');
    expect(tree.queryParams).toEqual({ periodId: 'p1', status: 'draft,pending_approval' });
    expect(pipe.transform(null)).toBeNull();
  });
});
