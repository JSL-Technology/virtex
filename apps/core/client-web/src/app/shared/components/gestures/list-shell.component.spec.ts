import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ListShellComponent } from './list-shell.component';

/**
 * The four states of a list are the ones that get forgotten when every page writes them itself.
 *
 * These tests exist because thirty-five lists in this product had thirty-five answers to "what does
 * loading look like", and roughly half had no answer at all to "what does empty look like". The
 * shell owns them so a page cannot omit one.
 */
@Component({
  standalone: true,
  imports: [ListShellComponent],
  template: `
    <vx-list-shell
      titleKey="INVENTORY.PRODUCTS.TITLE"
      [subtitleKey]="subtitle()"
      [count]="count()"
      [loading]="loading()"
      [error]="error()"
      [empty]="empty()"
      [searchable]="searchable()"
      [(search)]="search"
      (reload)="reloads = reloads + 1"
    >
      <button listActions class="new">Nuevo</button>
      <table class="rows">
        <tbody><tr><td>fila</td></tr></tbody>
      </table>
    </vx-list-shell>
  `,
})
class Host {
  readonly subtitle = signal<string | null>(null);
  readonly count = signal<number | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly empty = signal(false);
  readonly searchable = signal(false);
  readonly search = signal('');
  reloads = 0;
}

describe('ListShellComponent', () => {
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

  it('muestra la tabla proyectada cuando hay datos', () => {
    expect(el.querySelector('table.rows')).not.toBeNull();
    expect(el.querySelector('.ls__skeleton')).toBeNull();
  });

  it('mientras carga reserva el sitio de las filas y lo anuncia', () => {
    // A skeleton and not a "Cargando…" line: the text reserves no space, so the list jumps when the
    // rows arrive. `aria-busy` is what makes it perceivable without sight.
    host.loading.set(true);
    fixture.detectChanges();

    const skeleton = el.querySelector('.ls__skeleton');
    expect(skeleton).not.toBeNull();
    expect(skeleton?.getAttribute('aria-busy')).toBe('true');
    expect(el.querySelector('table.rows')).toBeNull();
  });

  it('un error se anuncia y ofrece reintentar', () => {
    // Without a retry the only way out is reloading the app, which closes every other window.
    host.error.set('No se pudo conectar con el servidor');
    fixture.detectChanges();

    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('No se pudo conectar');

    (el.querySelector('.ls__retry') as HTMLButtonElement).click();
    expect(host.reloads).toBe(1);
  });

  it('distingue vacío de verdad de vacío por el filtro', () => {
    // Two different situations with two different ways out: create the first record, or clear the
    // filter. One message for both is how someone concludes their data was lost.
    host.empty.set(true);
    host.searchable.set(true);
    fixture.detectChanges();
    expect(el.textContent).toContain('SHELL.EMPTY');

    host.search.set('tornillo');
    fixture.detectChanges();
    expect(el.textContent).toContain('SHELL.NO_MATCHES');
    expect(el.textContent).not.toContain('SHELL.EMPTY');
  });

  it('quitar el filtro desde el estado vacío devuelve el término a la página', () => {
    host.empty.set(true);
    host.searchable.set(true);
    host.search.set('tornillo');
    fixture.detectChanges();

    (el.querySelector('.ls__retry') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(host.search()).toBe('');
  });

  it('el recuento solo aparece con datos delante', () => {
    // A "0 registros" beside the title of a list that failed to load is a lie about the data.
    host.count.set(12);
    fixture.detectChanges();
    expect(el.querySelector('.ls__count')?.textContent?.trim()).toBe('12');

    host.error.set('caído');
    fixture.detectChanges();
    expect(el.querySelector('.ls__count')).toBeNull();
  });

  it('proyecta las acciones de la página en el encabezado', () => {
    expect(el.querySelector('.ls__actions .new')).not.toBeNull();
  });

  it('la búsqueda es de dos direcciones', () => {
    host.searchable.set(true);
    fixture.detectChanges();

    const input = el.querySelector('.ls__search-input') as HTMLInputElement;
    input.value = 'M6';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(host.search()).toBe('M6');

    host.search.set('M8');
    fixture.detectChanges();
    expect((el.querySelector('.ls__search-input') as HTMLInputElement).value).toBe('M8');
  });
});
