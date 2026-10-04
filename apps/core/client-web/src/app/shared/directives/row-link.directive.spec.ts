import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RowLinkDirective } from './row-link.directive';

@Component({
  standalone: true,
  imports: [RowLinkDirective],
  template: `<table><tbody><tr appRowLink>
    <td><a class="table-link" href="#" (click)="opened = opened + 1; $event.preventDefault()">2026-08</a></td>
    <td class="amount">1,000.00</td>
    <td><button type="button" (click)="pressed = pressed + 1">Aprobar</button></td>
  </tr></tbody></table>`,
})
class Host {
  opened = 0;
  pressed = 0;
}

describe('RowLinkDirective (QA B-02)', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('opens the row from any cell, through the row’s own link', () => {
    const { fixture, el } = render();
    (el.querySelector('.amount') as HTMLElement).click();
    expect(fixture.componentInstance.opened).toBe(1);
  });

  it('leaves the row’s own controls alone', () => {
    const { fixture, el } = render();
    el.querySelector('button')!.click();
    expect(fixture.componentInstance.pressed).toBe(1);
    expect(fixture.componentInstance.opened).toBe(0);
  });

  it('does not open twice when the link itself is clicked', () => {
    const { fixture, el } = render();
    (el.querySelector('a') as HTMLElement).click();
    expect(fixture.componentInstance.opened).toBe(1);
  });
});
