import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FitWordDirective } from './fit-word.directive';

/** QA B1: «Purchasin / g» — a rail label broken inside its only word. */
describe('FitWordDirective', () => {
  @Component({
    standalone: true,
    imports: [FitWordDirective],
    template: `<div style="width: 60px"><span appFitWord>{{ label() }}</span></div>`,
  })
  class Host {
    readonly label = signal('Sales');
  }

  // jsdom has no layout and no canvas: 6px per character at 10px, and a 60px box.
  beforeEach(() => {
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (word: string) => ({ width: word.length * 6 }),
    } as unknown as CanvasRenderingContext2D);
    jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(60);
    jest.spyOn(window, 'getComputedStyle').mockReturnValue({
      fontSize: '10px',
      fontWeight: '500',
      fontFamily: 'Inter',
    } as CSSStyleDeclaration);
  });

  afterEach(() => jest.restoreAllMocks());

  function render(label: string) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.label.set(label);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('span') as HTMLElement;
  }

  it('leaves a label whose words fit alone', () => {
    expect(render('HR & Payroll').style.fontSize).toBe('');
  });

  it('shrinks a label whose longest word is wider than its box, just enough', () => {
    // «Contabilidade»: 13 × 6 = 78px in a 60px box → 10 × 60/78 = 7.69 → floored at 8px.
    expect(render('Contabilidade').style.fontSize).toBe('8px');
    // «Purchasing»: 60px fits exactly.
    expect(render('Purchasing').style.fontSize).toBe('');
    // «Inventarios»: 66px → 9.0px.
    expect(render('Inventarios').style.fontSize).toBe('9px');
  });

  it('follows a change of language', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.label.set('Contabilidade');
    fixture.detectChanges();
    const span = fixture.nativeElement.querySelector('span') as HTMLElement;
    expect(span.style.fontSize).toBe('8px');

    fixture.componentInstance.label.set('Sales');
    fixture.detectChanges();
    expect(span.style.fontSize).toBe('');
  });
});
