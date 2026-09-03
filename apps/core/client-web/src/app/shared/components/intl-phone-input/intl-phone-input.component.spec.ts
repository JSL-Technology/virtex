import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Component, viewChild } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { IntlPhoneInputComponent } from './intl-phone-input.component';
import { CountryService } from '../../../core/services/country.service';
import { MockCountryService } from '../../../../testing/country.service.mock';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, IntlPhoneInputComponent],
  template: `<app-intl-phone-input [formControl]="phone" [required]="required" />`,
})
class HostComponent {
  phone = new FormControl('');
  required = false;
  readonly input = viewChild.required(IntlPhoneInputComponent);
}

describe('IntlPhoneInputComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, TranslateModule.forRoot()],
      providers: [{ provide: CountryService, useClass: MockCountryService }],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('stores the E.164 number in the form control when a valid national number is typed', () => {
    const input = host.input();
    input.onRegionChange('US');
    input.onNationalInput('202-456-1414');

    expect(host.phone.value).toBe('+12024561414');
  });

  it('marks the control invalid for a number that is not valid for the region', () => {
    const input = host.input();
    input.onRegionChange('US');
    input.onNationalInput('123');

    expect(host.phone.valid).toBe(false);
    expect(host.phone.errors).toEqual({ invalidPhone: true });
  });

  it('keeps what the user typed on screen while the number is incomplete', () => {
    const input = host.input();
    input.onRegionChange('US');
    input.onNationalInput('202-456');

    // The raw text is preserved (not silently emptied) so the user can finish typing.
    expect(host.phone.value).toBe('202-456');
    expect(host.phone.valid).toBe(false);
  });

  it('is valid when empty and not required', () => {
    host.required = false;
    fixture.detectChanges();
    host.input().onNationalInput('');

    expect(host.phone.valid).toBe(true);
  });

  it('is invalid when empty and required', () => {
    host.required = true;
    fixture.detectChanges();
    host.input().onNationalInput('');

    expect(host.phone.errors).toEqual({ required: true });
  });

  it('renders an E.164 value written from the model as a national display string', () => {
    host.phone.setValue('+12024561414');
    fixture.detectChanges();

    const input = host.input();
    expect(input.region()).toBe('US');
    expect(input.national()).toBe('(202) 456-1414');
  });

  it('re-validates when the region changes', () => {
    const input = host.input();
    // 800 123 4567 is not a valid US number but the raw stays; switching region re-runs validation.
    input.onRegionChange('US');
    input.onNationalInput('202-456-1414');
    expect(host.phone.value).toBe('+12024561414');

    input.onRegionChange('DO');
    // The same digits are re-normalized under the new region on the next emit.
    expect(host.phone.valid).toBe(true);
  });
});
