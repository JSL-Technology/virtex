import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { DocumentShellComponent, DocumentTone } from './document-shell.component';

/**
 * Reading one record: what it is, what state it is in, and why it is in that state.
 *
 * In an ERP the state governs what may still be done — an issued invoice is not editable, a closed
 * period rejects entries — so finding out by pressing a button and reading an error is the most
 * expensive way to ask. It belongs in the header, always.
 */
@Component({
  standalone: true,
  imports: [DocumentShellComponent],
  template: `
    <vx-document-shell
      [title]="title()"
      [subtitle]="subtitle()"
      [statusKey]="statusKey()"
      [statusTone]="tone()"
      [loading]="loading()"
      [error]="error()"
      [hasAside]="hasAside()"
      [asideOpen]="asideOpen()"
      (toggleAside)="asideOpen.set(!asideOpen())"
      (reload)="reloads = reloads + 1"
    >
      <button documentActions class="issue">Emitir</button>
      <div class="lines">líneas</div>
      <div documentAside class="history">historia</div>
    </vx-document-shell>
  `,
})
class Host {
  readonly title = signal('Factura B0100000123');
  readonly subtitle = signal<string | null>('Nortex Comercial · 12/09/2026');
  readonly statusKey = signal<string | null>('INVOICES.STATUS.ISSUED');
  readonly tone = signal<DocumentTone>('ok');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly hasAside = signal(true);
  readonly asideOpen = signal(true);
  reloads = 0;
}

describe('DocumentShellComponent', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host, TranslateModule.forRoot()],
    }).compileComponents();

    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('el estado va junto al nombre, no escondido', () => {
    const status = el.querySelector('.ds__status');
    expect(status?.textContent?.trim()).toBe('INVOICES.STATUS.ISSUED');
    expect(el.querySelector('.ds__name')?.textContent?.trim()).toBe('Factura B0100000123');
  });

  it('el tono del estado es semántico y cambia con él', () => {
    expect(el.querySelector('.ds__status--ok')).not.toBeNull();

    host.tone.set('danger');
    fixture.detectChanges();
    expect(el.querySelector('.ds__status--danger')).not.toBeNull();
    expect(el.querySelector('.ds__status--ok')).toBeNull();
  });

  it('sin estado declarado no inventa uno', () => {
    host.statusKey.set(null);
    fixture.detectChanges();
    expect(el.querySelector('.ds__status')).toBeNull();
  });

  it('el panel lateral se pliega y quien no lo usa no lo paga en anchura', () => {
    expect(el.querySelector('.history')).not.toBeNull();

    (el.querySelector('.ds__aside-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el.querySelector('.history')).toBeNull();
    expect(el.querySelector('.ds__aside-toggle')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('sin panel no hay botón de panel', () => {
    host.hasAside.set(false);
    fixture.detectChanges();
    expect(el.querySelector('.ds__aside-toggle')).toBeNull();
  });

  it('un error sustituye el cuerpo y ofrece reintentar', () => {
    host.error.set('El documento no está disponible');
    fixture.detectChanges();

    expect(el.querySelector('[role="alert"]')?.textContent).toContain('no está disponible');
    expect(el.querySelector('.lines')).toBeNull();
    // El panel tampoco: mostrar la historia de un documento que no se pudo leer es afirmar algo
    // sobre datos que no se tienen.
    expect(el.querySelector('.history')).toBeNull();

    (el.querySelector('.ds__retry') as HTMLButtonElement).click();
    expect(host.reloads).toBe(1);
  });

  it('mientras carga anuncia que está ocupado', () => {
    host.loading.set(true);
    fixture.detectChanges();

    expect(el.querySelector('.ds__skeleton')?.getAttribute('aria-busy')).toBe('true');
    expect(el.querySelector('.lines')).toBeNull();
  });

  it('proyecta las acciones del documento', () => {
    expect(el.querySelector('.ds__actions .issue')).not.toBeNull();
  });
});
