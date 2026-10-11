import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VxCardBrandComponent } from './index';
import { normalizeCardBrand, cardBrandLabel } from './card-brand.util';

describe('normalizeCardBrand', () => {
  it('folds every spelling of a network to one brand', () => {
    // The whole reason the map exists: three sources write Amex three ways and must draw one logo.
    expect(normalizeCardBrand('amex')).toBe('amex');
    expect(normalizeCardBrand('American Express')).toBe('amex');
    expect(normalizeCardBrand('AMERICAN-EXPRESS')).toBe('amex');
    expect(normalizeCardBrand('american_express')).toBe('amex');
  });

  it('treats an unknown or empty brand as a drawable fallback, never an error', () => {
    // A network we have no art for must still resolve to something the component can draw.
    expect(normalizeCardBrand('sodexo')).toBe('unknown');
    expect(normalizeCardBrand('')).toBe('unknown');
    expect(normalizeCardBrand(null)).toBe('unknown');
    expect(normalizeCardBrand(undefined)).toBe('unknown');
  });

  it('names a brand as the proper noun it is, and the fallback as a generic card', () => {
    expect(cardBrandLabel(normalizeCardBrand('visa'))).toBe('Visa');
    expect(cardBrandLabel(normalizeCardBrand('mastercard'))).toBe('Mastercard');
    expect(cardBrandLabel(normalizeCardBrand('nope'))).toBe('Card');
  });
});

@Component({
  standalone: true,
  imports: [VxCardBrandComponent],
  template: `<vx-card-brand [brand]="brand" [decorative]="decorative" />`,
})
class Host {
  brand: string | null = 'visa';
  decorative = false;
}

describe('VxCardBrandComponent', () => {
  function build() {
    TestBed.configureTestingModule({ imports: [Host] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  function el(fixture: ReturnType<typeof build>): HTMLElement {
    return fixture.nativeElement.querySelector('vx-card-brand');
  }

  it('carries the brand in a class so the face can tint itself from the same signal', () => {
    const fixture = build();
    expect(el(fixture).className).toContain('vx-card-brand--visa');

    fixture.componentInstance.brand = 'mastercard';
    fixture.detectChanges();
    expect(el(fixture).className).toContain('vx-card-brand--mastercard');
  });

  it('draws the generic card for a brand it has no art for', () => {
    const fixture = build();
    fixture.componentInstance.brand = 'totally-made-up';
    fixture.detectChanges();
    expect(el(fixture).className).toContain('vx-card-brand--unknown');
  });

  it('announces its brand to a screen reader when it stands alone', () => {
    const fixture = build();
    expect(el(fixture).getAttribute('role')).toBe('img');
    expect(el(fixture).getAttribute('aria-label')).toBe('Visa');
  });

  it('goes silent when it is decoration inside something already labelled', () => {
    const fixture = build();
    fixture.componentInstance.decorative = true;
    fixture.detectChanges();
    expect(el(fixture).getAttribute('role')).toBeNull();
    expect(el(fixture).getAttribute('aria-hidden')).toBe('true');
  });
});
