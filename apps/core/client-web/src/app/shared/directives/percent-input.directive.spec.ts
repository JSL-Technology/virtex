import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { PercentInputDirective, toFraction, toPercent } from './percent-input.directive';

/** QA M-05: typing 18 in a field that wanted 0.18 charged 99,000 of tax on 5,500. */
describe('PercentInputDirective', () => {
  @Component({
    standalone: true,
    imports: [ReactiveFormsModule, PercentInputDirective],
    template: `<input type="number" appPercent [formControl]="rate" />`,
  })
  class Host {
    readonly rate = new FormControl<number | null>(0.18, [Validators.max(1)]);
  }

  function render() {
    const fixture = TestBed.configureTestingModule({ imports: [Host] }).createComponent(Host);
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    return { fixture, input, host: fixture.componentInstance };
  }

  it('shows a fraction as the percentage people write', () => {
    expect(render().input.value).toBe('18');
  });

  it('stores what is typed as a fraction, so maths and validators are unchanged', () => {
    const { input, host } = render();
    input.value = '10';
    input.dispatchEvent(new Event('input'));
    expect(host.rate.value).toBe(0.1);
    input.value = '150';
    input.dispatchEvent(new Event('input'));
    expect(host.rate.value).toBe(1.5);
    expect(host.rate.hasError('max')).toBe(true);
  });

  it('reads an emptied field as no value, and a comma as a decimal point', () => {
    const { input, host } = render();
    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(host.rate.value).toBeNull();
    expect(toFraction(Number('12,5'.replace(',', '.')))).toBe(0.125);
  });

  it('converts without floating-point residue', () => {
    expect(toPercent(0.07)).toBe(7);
    expect(toFraction(7)).toBe(0.07);
  });
});
