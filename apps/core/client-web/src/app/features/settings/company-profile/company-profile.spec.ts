import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { of } from 'rxjs';

import { CompanyProfilePage } from './company-profile.page';
import { OrganizationService } from '../../../shared/service/organization.service';
import { CountryService } from '../../../core/services/country.service';
import { NotificationService } from '../../../core/services/notification';

/**
 * QA A-02: what signup collected was saved but not shown, the country was free text, and the
 * EIN read `129007988`.
 */
describe('CompanyProfilePage', () => {
  let component: CompanyProfilePage;
  let fixture: ComponentFixture<CompanyProfilePage>;
  const organizations = {
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
  };
  const countries = {
    getCountryConfig: jest.fn(),
  };

  beforeEach(async () => {
    organizations.getProfile.mockReturnValue(
      of({
        id: 'org-1',
        legalName: 'QA LLC',
        taxId: '129007988',
        address: '1600 Pennsylvania Ave NW',
        city: 'Washington',
        state: 'DC',
        postalCode: '20500',
        industry: 'TECHNOLOGY',
        country: 'US',
        countryLocked: true,
      }),
    );
    organizations.updateProfile.mockReturnValue(of({ taxId: '129007988' }));
    countries.getCountryConfig.mockReturnValue(
      of({
        countryCode: 'US',
        taxIdLabel: 'EIN',
        taxIdExample: '12-3456789',
        address: { divisionLabel: 'State', divisions: [{ code: 'DC', name: 'District of Columbia' }], postalCodeLabel: 'ZIP code', postalCodeRequired: true },
      }),
    );

    await TestBed.configureTestingModule({
      imports: [CompanyProfilePage, TranslateModule.forRoot()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: OrganizationService, useValue: organizations },
        { provide: CountryService, useValue: countries },
        { provide: NotificationService, useValue: { showSuccess: jest.fn(), showError: jest.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CompanyProfilePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows the address, city, state, postal code and industry given at signup', () => {
    expect(component.profileForm.getRawValue()).toMatchObject({
      address: '1600 Pennsylvania Ave NW',
      city: 'Washington',
      state: 'DC',
      postalCode: '20500',
      industry: 'TECHNOLOGY',
      country: 'US',
    });
  });

  it('writes the tax id in the country\'s format', () => {
    expect(component.profileForm.get('taxId')?.value).toBe('12-9007988');
    expect(component.taxIdLabel()).toBe('EIN');
  });

  it('locks the country once the fiscal pack depends on it, and never sends it', () => {
    expect(component.countryLocked()).toBe(true);
    expect(component.profileForm.get('country')?.disabled).toBe(true);

    component.profileForm.get('city')?.setValue('Arlington');
    component.profileForm.get('city')?.markAsDirty();
    component.saveProfile();

    expect(organizations.updateProfile).toHaveBeenCalledWith({ city: 'Arlington' });
  });

  it('offers this country\'s division catalogue and an example phone of this country', () => {
    expect(component.divisions()).toEqual([{ code: 'DC', name: 'District of Columbia' }]);
    expect(component.phoneExample()).toMatch(/\(\d{3}\) \d{3}-\d{4}/);
  });
});
