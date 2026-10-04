import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { ReportsHubPage } from './reports-hub.page';

/** QA M-09: the home page's «Reportes» opened «módulo en construcción». */
describe('ReportsHubPage', () => {
  function create(granted: (permission: string) => boolean) {
    TestBed.configureTestingModule({
      imports: [ReportsHubPage, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { currentUser: signal(null), hasPermissions: (ps: string[]) => ps.every(granted) } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (p: string) => `/acme${p}` } },
      ],
    });
    return TestBed.createComponent(ReportsHubPage).componentInstance;
  }

  it('lists the reports of every module, as organisation links', () => {
    const page = create(() => true);
    const links = page.groups().flatMap((g) => g.reports.map((r) => r.link));
    expect(links).toContain('/acme/reports/financial-statements/balance-sheet');
    expect(links.every((link) => link.startsWith('/acme/'))).toBe(true);
    expect(links).not.toContain('/acme/reports');
  });

  it('offers only what the user may open', () => {
    const page = create((p) => p === 'reports:view_sales');
    const links = page.groups().flatMap((g) => g.reports.map((r) => r.link));
    expect(links).not.toContain('/acme/reports/financial-statements/balance-sheet');
    expect(links).toContain('/acme/reports/profitability-by-customer');
  });
});
