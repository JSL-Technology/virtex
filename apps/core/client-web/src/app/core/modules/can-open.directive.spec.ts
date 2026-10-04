import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth';
import { CanOpenDirective } from './can-open.directive';

/** QA M-01: a Member was offered «Nueva factura de venta» and every other door its role cannot open. */
describe('CanOpenDirective', () => {
  const permissions = signal<string[]>([]);
  const auth = {
    hasPermissions: (required: string[]) => required.every((p) => permissions().includes(p) || permissions().includes('*')),
  };

  @Component({
    standalone: true,
    imports: [RouterLink, CanOpenDirective],
    template: `
      <a listActions id="new-invoice" [routerLink]="['/invoices/new']">new</a>
      <a listActions id="unknown" routerLink="/nowhere/at/all">?</a>
      <button id="new-warehouse" vxRequires="wms:manage">new warehouse</button>
      <button id="new-account" vxCanOpen="/accounting/chart-of-accounts/new">new account</button>
    `,
  })
  class Host {}

  function render() {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const hidden = (id: string) => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`#${id}`)!.hidden;
    return { fixture, hidden };
  }

  it('hides what the seat cannot open, asking the route manifest', () => {
    permissions.set(['invoices:view']);
    const { hidden } = render();
    expect(hidden('new-invoice')).toBe(true);
    expect(hidden('new-warehouse')).toBe(true);
    expect(hidden('new-account')).toBe(true);
  });

  it('shows it to a seat that may, and leaves an unknown path to the router', () => {
    permissions.set(['*']);
    const { hidden } = render();
    expect(hidden('new-invoice')).toBe(false);
    expect(hidden('new-warehouse')).toBe(false);
    expect(hidden('unknown')).toBe(false);
  });
});
