import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CompanySwitcherComponent } from './company-switcher.component';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Building, Check, ChevronsUpDown, Plus, Settings, Search } from 'lucide-angular';
import { AuthService } from '../../../../core/services/auth';
import { signal } from '@angular/core';

describe('CompanySwitcherComponent', () => {
  let component: CompanySwitcherComponent;
  let fixture: ComponentFixture<CompanySwitcherComponent>;
  let mockAuthService: { currentUser: ReturnType<typeof signal<any>> };

  const activeOrg = { id: '1', legalName: 'Test Org', logoUrl: '' };
  const otherOrg = { id: '2', legalName: 'Acme Industries', logoUrl: '' };

  beforeEach(async () => {
    // The switcher is driven by `user.organizations` — the real membership list the backend
    // resolves from the user_organizations join table. It previously rendered three hardcoded
    // placeholders ('Virtex Corp', 'Acme Industries', 'Globex Corporation') because the API never
    // exposed the field, so every tenant saw the same fictional list.
    mockAuthService = {
      currentUser: signal<any>({
        organization: activeOrg,
        organizations: [activeOrg, otherOrg],
      }),
    };

    await TestBed.configureTestingModule({
      imports: [
        CompanySwitcherComponent,
        HttpClientTestingModule,
        TranslateModule.forRoot(),
        LucideAngularModule.pick({ Building, Check, ChevronsUpDown, Plus, Settings, Search }),
      ],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compileComponents();

    fixture = TestBed.createComponent(CompanySwitcherComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should toggle dropdown', () => {
    expect(component.isOpen()).toBeFalsy();
    component.toggleDropdown();
    expect(component.isOpen()).toBeTruthy();
    component.toggleDropdown();
    expect(component.isOpen()).toBeFalsy();
  });

  it('lists the organizations the user actually belongs to', () => {
    expect(component.filteredOrganizations().map((o) => o.legalName)).toEqual([
      'Test Org',
      'Acme Industries',
    ]);
  });

  it('filters by legal name', () => {
    component.searchQuery.set('Acme');
    const filtered = component.filteredOrganizations();
    expect(filtered.length).toBe(1);
    expect(filtered[0].legalName).toContain('Acme');
  });

  it('shows nothing when the query matches no membership', () => {
    // With the old hardcoded list a user could see — and attempt to switch into — tenants they
    // had no membership in.
    component.searchQuery.set('Globex');
    expect(component.filteredOrganizations()).toEqual([]);
  });

  it('keeps the active organization visible even if the membership list omits it', () => {
    mockAuthService.currentUser.set({ organization: activeOrg, organizations: [] });
    expect(component.filteredOrganizations().map((o) => o.id)).toEqual(['1']);
  });

  it('renders an empty list rather than crashing when there is no user', () => {
    mockAuthService.currentUser.set(null);
    expect(component.filteredOrganizations()).toEqual([]);
  });
});
