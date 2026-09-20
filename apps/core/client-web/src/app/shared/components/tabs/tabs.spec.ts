import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { VxTab, VxTabsComponent } from './index';

const TABS: VxTab[] = [
  { id: 'content', labelKey: 'invoices.new.content' },
  { id: 'finance', labelKey: 'invoices.new.tax_collection', badge: 3 },
  { id: 'audit', labelKey: 'common.actions', disabled: true },
];

@Component({
  standalone: true,
  imports: [TranslateModule, VxTabsComponent],
  template: `
    <vx-tabs #tabs [tabs]="TABS" [(active)]="active" ariaLabel="Secciones" />
    <div role="tabpanel" [id]="tabs.panelId('content')" [attr.aria-labelledby]="tabs.tabId('content')"></div>
  `,
})
class Host {
  readonly TABS = TABS;
  readonly active = signal('content');
}

describe('VxTabsComponent', () => {
  function build() {
    TestBed.configureTestingModule({ imports: [Host, TranslateModule.forRoot()] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  function tabs(fixture: ReturnType<typeof build>): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('[role="tab"]'));
  }

  /** La tecla llega a la pestaña que tiene el foco, que es la activa (tabindex rotatorio). */
  function press(fixture: ReturnType<typeof build>, key: string): void {
    const active = tabs(fixture).find((tab) => tab.getAttribute('aria-selected') === 'true');
    active?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    fixture.detectChanges();
  }

  it('declara la tira como manda ARIA', () => {
    //  Las tres tiras que esto sustituye tenían CERO `role="tablist"` y cero `aria-selected`:
    //  para un lector de pantalla eran tres botones sin nombre de grupo.
    const fixture = build();
    expect(fixture.nativeElement.querySelector('[role="tablist"]')).not.toBeNull();
    expect(tabs(fixture)[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs(fixture)[1].getAttribute('aria-selected')).toBe('false');
  });

  it('enlaza cada pestaña con su panel en los dos sentidos', () => {
    const fixture = build();
    const panel = fixture.nativeElement.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(tabs(fixture)[0].getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs(fixture)[0].id);
  });

  it('es UNA parada de tabulación, no una por pestaña', () => {
    //  Ese es el motivo de que merezca un componente: con tres tiras a mano, llegar al primer
    //  campo de un formulario de cuatro pestañas costaba cuatro pulsaciones de Tab.
    const fixture = build();
    expect(tabs(fixture).map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);

    fixture.componentInstance.active.set('finance');
    fixture.detectChanges();
    expect(tabs(fixture).map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('las flechas mueven y dan la vuelta', () => {
    const fixture = build();
    press(fixture, 'ArrowRight');
    expect(fixture.componentInstance.active()).toBe('finance');

    //  «audit» está deshabilitada: la flecha la salta en vez de aterrizar en algo que no se puede
    //  elegir.
    press(fixture, 'ArrowRight');
    expect(fixture.componentInstance.active()).toBe('content');

    press(fixture, 'ArrowLeft');
    expect(fixture.componentInstance.active()).toBe('finance');
  });

  it('Inicio y Fin van a los extremos utilizables', () => {
    const fixture = build();
    press(fixture, 'End');
    expect(fixture.componentInstance.active()).toBe('finance');

    press(fixture, 'Home');
    expect(fixture.componentInstance.active()).toBe('content');
  });

  it('el foco sigue a la selección', () => {
    const fixture = build();
    tabs(fixture)[0].focus();
    press(fixture, 'ArrowRight');
    expect(document.activeElement).toBe(tabs(fixture)[1]);
  });

  it('no deja elegir una pestaña deshabilitada', () => {
    const fixture = build();
    tabs(fixture)[2].dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();
    expect(fixture.componentInstance.active()).toBe('content');
  });

  it('puede llevar un contador sin saber de qué', () => {
    expect(tabs(build())[1].querySelector('vx-badge')?.textContent?.trim()).toBe('3');
  });
});
