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
  let mockAuthService: any;

  beforeEach(async () => {
    mockAuthService = {
      currentUser: signal({
        organization: { id: '1', name: 'Test Org', logoUrl: '' }
      })
    };

    await TestBed.configureTestingModule({
      imports: [
        CompanySwitcherComponent,
        HttpClientTestingModule,
        TranslateModule.forRoot(),
        LucideAngularModule.pick({ Building, Check, ChevronsUpDown, Plus, Settings, Search })
      ],
      providers: [
        { provide: AuthService, useValue: mockAuthService }
      ]
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

  it('should filter organizations based on search query', () => {
    component.searchQuery.set('Acme');
    const filtered = component.filteredOrganizations();
    expect(filtered.length).toBe(1);
    expect(filtered[0].name).toContain('Acme');
  });
});
