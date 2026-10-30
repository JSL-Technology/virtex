import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { provideTranslateService } from '@ngx-translate/core';
import { LocaleStore, VxNumberInputDirective } from '@virteex/shared/ui-i18n';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, VxNumberInputDirective],
  template: `<form [formGroup]="form"><input type="number" step="0.01" min="0" formControlName="price" /></form>`,
})
class Host {
  readonly form = inject(FormBuilder).group({ price: [null as number | null, [Validators.required, Validators.min(0)]] });
}

/** A number is typed the way it is read: with the decimal comma the company chose, not the browser's point. */
describe('VxNumberInputDirective', () => {
  function build(numberFormat: 'dot_comma' | 'comma_dot' = 'dot_comma') {
    TestBed.configureTestingModule({ imports: [Host], providers: [provideTranslateService()] });
    const store = TestBed.inject(LocaleStore);
    store.setLanguage('es');
    store.setTenantContext({
      language: 'es', locale: 'es-DO', direction: 'ltr', countryCode: 'DO', currency: 'DOP',
      timezone: 'America/Santo_Domingo', booksLanguage: 'es', firstDayOfWeek: 0, companyFormat: { numberFormat },
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    return { fixture, input, control: fixture.componentInstance.form.controls.price, store };
  }

  const type = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  it('turns the field into text with a decimal keypad, so the browser does not drop the comma', () => {
    const { input } = build();
    expect(input.type).toBe('text');
    expect(input.getAttribute('inputmode')).toBe('decimal');
  });

  it('shows the value with the decimal mark in force and keeps a number in the control', () => {
    const { fixture, input, control } = build();
    control.setValue(1234.5);
    fixture.detectChanges();
    expect(input.value).toBe('1234,5');
    type(input, '1.250,75');
    expect(control.value).toBe(1250.75);
  });

  it('refuses the other mark with a message instead of guessing a thousandfold price', () => {
    const { input, control } = build();
    type(input, '12.5');
    expect(control.value).toBeNull();
    expect(control.hasError('localizedNumber')).toBe(true);
    expect(control.getError('localizedNumber')).toEqual({ decimal: ',', example: '1234,5' });
    type(input, '12,5');
    expect(control.hasError('localizedNumber')).toBe(false);
    expect(control.value).toBe(12.5);
  });

  it('keeps the validators speaking numbers', () => {
    const { input, control } = build('comma_dot');
    type(input, '-3');
    expect(control.hasError('min')).toBe(true);
    type(input, '');
    expect(control.hasError('required')).toBe(true);
  });

  it('steps with the arrow keys, within the bounds, without float noise', () => {
    const { input, control } = build();
    control.setValue(0.1);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(control.value).toBe(0.11);
    control.setValue(0);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(control.value).toBe(0);
  });

  it('follows a change of format', () => {
    const { fixture, input, control, store } = build();
    control.setValue(2.5);
    fixture.detectChanges();
    expect(input.value).toBe('2,5');
    store.setPersonalFormat({ numberFormat: 'comma_dot' });
    fixture.detectChanges();
    TestBed.tick();
    expect(input.value).toBe('2.5');
  });
});
