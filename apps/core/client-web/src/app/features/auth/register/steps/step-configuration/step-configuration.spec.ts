import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StepConfiguration } from './step-configuration';
import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { CountryService } from '../../../../../core/services/country.service';
import { of } from 'rxjs';
import { Router } from '@angular/router';

describe('StepConfiguration', () => {
  let component: StepConfiguration;
  let fixture: ComponentFixture<StepConfiguration>;
  let mockCountryService: any;
  let mockRouter: any;

  beforeEach(async () => {
    mockCountryService = {
      currentCountry: jest.fn().mockReturnValue({ code: 'DO', name: 'Dominican Republic', currencyCode: 'DOP' }),
      currentCountryCode: jest.fn().mockReturnValue('do'),
      getCountryConfig: jest.fn().mockReturnValue(of({}))
    };

    mockRouter = {
      url: '/es/do/auth/register',
      navigateByUrl: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [StepConfiguration, ReactiveFormsModule, TranslateModule.forRoot()],
      providers: [
        { provide: CountryService, useValue: mockCountryService },
        { provide: Router, useValue: mockRouter }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(StepConfiguration);
    component = fixture.componentInstance;
    component.group = new FormGroup({
      country: new FormControl('DO'),
      taxId: new FormControl('')
    });
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should call getCountryConfig and navigate on country change', () => {
    const event = { target: { value: 'US' } };
    component.onCountryChange(event);

    expect(mockCountryService.getCountryConfig).toHaveBeenCalledWith('US');
    expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/es/us/auth/register');
  });
});
