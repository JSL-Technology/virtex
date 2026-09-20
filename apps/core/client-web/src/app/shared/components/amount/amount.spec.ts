import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { VxAmountComponent } from './index';

@Component({
  standalone: true,
  imports: [VxAmountComponent],
  template: `
    <vx-amount
      [value]="value"
      [currency]="currency"
      [signed]="signed"
      [colourNegative]="colourNegative"
      [suffix]="suffix"
    />
  `,
})
class Host {
  value: number | string | null = 1234.5;
  currency: string | null = 'DOP';
  signed = false;
  colourNegative = true;
  suffix = '';
}

describe('VxAmountComponent', () => {
  function build() {
    TestBed.configureTestingModule({ imports: [Host] });
    TestBed.inject(LocaleStore).setTenantContext({ countryCode: 'DO', currency: 'DOP' } as never);
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  function host(fixture: ReturnType<typeof build>): HTMLElement {
    return fixture.nativeElement.querySelector('vx-amount');
  }

  it('dice en qué moneda está la cifra', () => {
    //  51 importes de los cuatro estados financieros se pintaban sin moneda en ninguna parte de
    //  la pantalla. Una columna de números sin unidad no es un informe.
    const text = host(build()).textContent ?? '';
    expect(text).toMatch(/1[.,\s]?234/);
    expect(text.replace(/[\s\u00a0]/g, '')).toMatch(/\$|DOP/);
  });

  it('marca el negativo, que era invisible en 119 de 126 cifras', () => {
    const fixture = build();
    expect(host(fixture).className).not.toContain('vx-amount--negative');

    fixture.componentInstance.value = -80;
    fixture.detectChanges();
    expect(host(fixture).className).toContain('vx-amount--negative');
  });

  it('deja de marcarlo donde el negativo es de construcción', () => {
    //  Una retención es negativa siempre; pintarla en rojo no informa de nada.
    const fixture = build();
    fixture.componentInstance.value = -80;
    fixture.componentInstance.colourNegative = false;
    fixture.detectChanges();
    expect(host(fixture).className).not.toContain('vx-amount--negative');
  });

  it('no confunde «sin dato» con cero', () => {
    //  Un saldo que todavía no llegó del servidor y un saldo de cero son dos hechos distintos.
    const fixture = build();
    fixture.componentInstance.value = null;
    fixture.detectChanges();
    expect(host(fixture).textContent?.trim()).toBe('—');

    fixture.componentInstance.value = 0;
    fixture.detectChanges();
    expect(host(fixture).textContent?.trim()).not.toBe('—');
    expect(host(fixture).className).toContain('vx-amount--zero');
  });

  it('muestra el signo donde la dirección es el dato', () => {
    const fixture = build();
    fixture.componentInstance.signed = true;
    fixture.componentInstance.value = 500;
    fixture.detectChanges();
    expect(host(fixture).textContent?.trim().startsWith('+')).toBe(true);
  });

  it('acepta una cifra que llegó como cadena', () => {
    //  `numeric` de Postgres viaja como cadena en JSON; el componente no puede exigir que cada
    //  llamante se acuerde de convertirla.
    const fixture = build();
    fixture.componentInstance.value = '250.75';
    fixture.detectChanges();
    expect(host(fixture).textContent?.trim()).not.toBe('—');
  });

  it('sirve también para una magnitud que no es dinero', () => {
    const fixture = build();
    fixture.componentInstance.currency = null;
    fixture.componentInstance.value = 12;
    fixture.componentInstance.suffix = 'kg';
    fixture.detectChanges();
    expect(host(fixture).textContent).toContain('kg');
  });
});
