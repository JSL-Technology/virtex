import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, DefaultUrlSerializer } from '@angular/router';
import { Subject } from 'rxjs';
import { TabRouterService } from './tab-router.service';
import { TabStateService } from './tab-state.service';
import { ActiveOrganizationService } from '../tenancy/active-organization.service';

/**
 * `bootRoute` is what decides whether a link, a bookmark or F5 is honoured over the saved
 * workspace. Each case below is a URL that used to land on whatever tab was active last.
 */
describe('TabRouterService.bootRoute', () => {
  const serializer = new DefaultUrlSerializer();
  let url: string;
  let inFlight: UrlTree | null;

  function setup(): TabRouterService {
    TestBed.configureTestingModule({
      providers: [
        TabRouterService,
        {
          provide: Router,
          useValue: {
            events: new Subject(),
            get url() {
              return url;
            },
            getCurrentNavigation: () => (inFlight ? { finalUrl: inFlight } : null),
            serializeUrl: (tree: UrlTree) => serializer.serialize(tree),
            navigateByUrl: jest.fn().mockResolvedValue(true),
          },
        },
        { provide: TabStateService, useValue: { activeTab: () => null, openTab: jest.fn() } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => `/e/acme/${path}` } },
      ],
    });
    return TestBed.inject(TabRouterService);
  }

  beforeEach(() => {
    url = '/';
    inFlight = null;
  });

  it('reads the page from the URL the browser opened', () => {
    url = '/e/acme/workflow-instances/run-1';
    expect(setup().bootRoute()).toEqual({ path: '/workflow-instances/run-1', query: {} });
  });

  it('reads the navigation in flight when the router has not settled on it yet', () => {
    inFlight = serializer.parse('/e/acme/workflow-instances/run-1?tab=history');
    expect(setup().bootRoute()).toEqual({ path: '/workflow-instances/run-1', query: { tab: 'history' } });
  });

  it('keeps the page under a settings link, so the link opens both', () => {
    url = '/e/acme/overview#settings/approvals';
    expect(setup().bootRoute()).toEqual({ path: '/overview', query: {} });
  });

  it('has nothing to honour at the root', () => {
    expect(setup().bootRoute()).toBeNull();
  });
});
