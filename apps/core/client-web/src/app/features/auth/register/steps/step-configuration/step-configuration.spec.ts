import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { throwError } from 'rxjs';
import { StepConfiguration } from './step-configuration';
import { CountryService } from '../../../../../core/services/country.service';
import { MockCountryService, US_CONFIG } from '../../../../../../testing/country.service.mock';

/**
 * The same shape `RegisterPage` builds. `taxpayerKind` and the `fiscalProfile` sub-group are part
 * of the contract now: the country decides which extra fiscal fields exist and the parent adds the
 * controls, so the component renders whatever is in the group rather than a fixed list.
 */
const makeGroup = () =>
  new FormGroup({
    country: new FormControl('DO'),
    taxpayerKind: new FormControl('company'),
    taxId: new FormControl(''),
    address: new FormControl(''),
    city: new FormControl(''),
    state: new FormControl(''),
    postalCode: new FormControl(''),
    fiscalProfile: new FormGroup({}),
  });

describe('StepConfiguration', () => {
  let component: StepConfiguration;
  let fixture: ComponentFixture<StepConfiguration>;
  let countryService: MockCountryService;
  const mockRouter = { url: '/es/do/auth/register', navigateByUrl: jest.fn() };

  const build = async () => {
    await TestBed.configureTestingModule({
      imports: [StepConfiguration, ReactiveFormsModule, TranslateModule.forRoot()],
      providers: [
        { provide: CountryService, useClass: MockCountryService },
        { provide: Router, useValue: mockRouter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StepConfiguration);
    component = fixture.componentInstance;
    countryService = TestBed.inject(CountryService) as unknown as MockCountryService;
    component.group = makeGroup();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await build();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('country list', () => {
    it('comes from the server, not a list hardcoded in the component', () => {
      // The hardcoded list offered eight countries; two of them had no fiscal region on the
      // server, so choosing one produced a tenant with no chart of accounts and no taxes.
      expect(countryService.getSupportedCountries).toHaveBeenCalled();
      expect(component.countries().map((c) => c.countryCode)).toEqual(['DO', 'US']);
    });

    it('reports a failure instead of falling back to a stale list', async () => {
      TestBed.resetTestingModule();
      const failing = new MockCountryService();
      failing.getSupportedCountries = jest.fn(() => throwError(() => new Error('offline')));

      await TestBed.configureTestingModule({
        imports: [StepConfiguration, ReactiveFormsModule, TranslateModule.forRoot()],
        providers: [
          { provide: CountryService, useValue: failing },
          { provide: Router, useValue: mockRouter },
        ],
      }).compileComponents();

      const f = TestBed.createComponent(StepConfiguration);
      f.componentInstance.group = makeGroup();
      f.detectChanges();

      expect(f.componentInstance.countries()).toEqual([]);
      expect(f.componentInstance.countriesFailed()).toBe(true);
    });
  });

  it('loads the country config and keeps the URL in step on change', () => {
    component.onCountryChange({ target: { value: 'US' } } as unknown as Event);

    expect(countryService.getCountryConfig).toHaveBeenCalledWith('US');
    expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/es/us/auth/register');
  });

  describe('country-specific labels', () => {
    it('labels the tax id with the country terminology and shows a real example', () => {
      // These came from `formSchema`, a field no backend endpoint ever populated, so every country
      // showed the generic "Tax ID" label and an empty placeholder.
      expect(component.taxIdLabel()).toBe('RNC / Cédula');
      expect(component.taxIdPlaceholder()).toBe('131-12345-7');
      expect(component.divisionLabel()).toBe('Provincia');
    });

    it('follows the country when it changes', () => {
      countryService.setConfig(US_CONFIG);
      fixture.detectChanges();

      expect(component.taxIdLabel()).toBe('EIN');
      expect(component.divisionLabel()).toBe('State');
      expect(component.postalCodeLabel()).toBe('ZIP code');
      expect(component.postalCodeRequired()).toBe(true);
    });

    it('offers the coded divisions the country publishes', () => {
      expect(component.divisions()).toEqual(
        expect.arrayContaining([{ code: '01', name: 'Distrito Nacional' }]),
      );
    });

    it('explains the invoicing regime that makes the address mandatory', () => {
      expect(component.invoicingNotice()).toBe('DGII e-CF');

      countryService.setConfig(US_CONFIG);
      fixture.detectChanges();
      expect(component.invoicingNotice()).toBeNull();
    });
  });
});
