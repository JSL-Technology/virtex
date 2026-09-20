import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VxBadgeComponent, VxTone } from './index';

@Component({
  standalone: true,
  imports: [VxBadgeComponent],
  template: `<vx-badge [tone]="tone" [struck]="struck" [size]="size">Pagada</vx-badge>`,
})
class Host {
  tone: VxTone = 'neutral';
  struck = false;
  size: 'sm' | 'md' = 'md';
}

describe('VxBadgeComponent', () => {
  function build() {
    TestBed.configureTestingModule({ imports: [Host] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  function badge(fixture: ReturnType<typeof build>): HTMLElement {
    return fixture.nativeElement.querySelector('vx-badge');
  }

  it('lleva el tono en una clase, para que el tema decida el color', () => {
    const fixture = build();
    expect(badge(fixture).className).toContain('vx-badge--neutral');

    fixture.componentInstance.tone = 'danger';
    fixture.detectChanges();
    expect(badge(fixture).className).toContain('vx-badge--danger');
    expect(badge(fixture).className).not.toContain('vx-badge--neutral');
  });

  it('distingue «anulado» de «sin empezar»', () => {
    //  Los dos eran gris en el registro de facturas. Una anulada ya no admite trabajo y una
    //  borrador sí: tacharla es lo que separa los dos hechos sin depender del matiz de gris.
    const fixture = build();
    expect(badge(fixture).className).not.toContain('vx-badge--struck');

    fixture.componentInstance.struck = true;
    fixture.detectChanges();
    expect(badge(fixture).className).toContain('vx-badge--struck');
  });

  it('pinta lo que le proyecten y no sabe qué es', () => {
    //  La traducción del estado es del dominio. Si la insignia supiera qué es «Pagada», habría
    //  que enseñarle también qué es «Conciliado» y qué es «En nómina».
    expect(badge(build()).textContent?.trim()).toBe('Pagada');
  });

  it('acepta el tamaño denso para una celda de tabla', () => {
    const fixture = build();
    fixture.componentInstance.size = 'sm';
    fixture.detectChanges();
    expect(badge(fixture).className).toContain('vx-badge--sm');
  });
});
