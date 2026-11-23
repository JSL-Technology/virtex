import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { LocaleStore } from '@virtex/shared/ui-i18n';
import type { LocaleContextContract, LocalizedName } from '@virtex/shared/types';
import { VxNameTranslationsComponent } from './name-translations.component';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, VxNameTranslationsComponent],
  template: `<vx-name-translations [formControl]="control" idPrefix="qa-name" />`,
})
class HostComponent {
  readonly control = new FormControl<LocalizedName>({ en: 'Sales journal' }, { nonNullable: true });
}

/** A master's name in the languages other than the books'. */
describe('VxNameTranslationsComponent', () => {
  const dominican: LocaleContextContract = {
    language: 'en',
    locale: 'en-US',
    direction: 'ltr',
    countryCode: 'DO',
    currency: 'DOP',
    timezone: 'America/Santo_Domingo',
    booksLanguage: 'es',
    firstDayOfWeek: 0,
  };

  beforeEach(() => {
    localStorage.clear();
    const store = TestBed.inject(LocaleStore);
    store.setLanguage('en');
    store.setTenantContext(dominican);
  });

  const render = () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const input = (language: string) => fixture.nativeElement.querySelector(`#qa-name-${language}`) as HTMLInputElement | null;
    return { fixture, input };
  };

  it('offers every language but the books one, filled with what the master has', () => {
    const { input } = render();
    expect(input('es')).toBeNull();
    expect(input('en')?.value).toBe('Sales journal');
    expect(input('pt')?.value).toBe('');
    expect(input('pt')?.getAttribute('lang')).toBe('pt');
  });

  it('sends every language it shows — an emptied one too, so the server removes it', () => {
    const { fixture, input } = render();
    const en = input('en') as HTMLInputElement;
    en.value = '';
    en.dispatchEvent(new Event('input'));
    const pt = input('pt') as HTMLInputElement;
    pt.value = 'Diário de vendas';
    pt.dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.control.value).toEqual({ en: '', pt: 'Diário de vendas' });
  });

  it('follows the control when it is disabled', () => {
    const { fixture, input } = render();
    fixture.componentInstance.control.disable();
    fixture.detectChanges();
    expect(input('en')?.disabled).toBe(true);
  });
});
