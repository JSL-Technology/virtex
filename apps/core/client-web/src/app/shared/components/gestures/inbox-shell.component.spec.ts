import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { InboxShellComponent, InboxSection } from './inbox-shell.component';

/**
 * Una bandeja responde una sola pregunta: ¿he terminado?
 *
 * Las dos pantallas que este armazón sustituye la respondían en cuatro pestañas cada una, así que
 * había que mirar en cuatro sitios para saberlo. Estas pruebas fijan lo contrario: todo en un
 * recorrido, con el total pendiente arriba, los tramos vacíos dichos en vez de escondidos, y la
 * acción que resuelve cada elemento junto a él.
 */
@Component({
  standalone: true,
  imports: [InboxShellComponent],
  template: `
    <vx-inbox-shell
      titleKey="MY_WORK.MY_WORK"
      [sections]="sections()"
      [loading]="loading()"
      [error]="error()"
      [itemActions]="decide"
      (reload)="reloads = reloads + 1"
    ></vx-inbox-shell>

    <ng-template #decide let-item>
      <button class="approve" type="button" (click)="decided = item.id">ok</button>
    </ng-template>
  `,
})
class Host {
  readonly sections = signal<InboxSection[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  reloads = 0;
  decided = '';
}

describe('InboxShellComponent', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let el: HTMLElement;

  const item = (id: string, overdue = false) => ({
    id,
    title: `Factura ${id}`,
    detail: 'Paso 1',
    when: '2026-09-01',
    overdue,
    link: null,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host, TranslateModule.forRoot()],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('dice cuántas cosas esperan, sumando todos los tramos', () => {
    // El número que responde «¿he terminado?». Con pestañas había que sumarlo a ojo.
    host.sections.set([
      { labelKey: 'A', items: [item('1'), item('2')] },
      { labelKey: 'B', items: [item('3')] },
    ]);
    fixture.detectChanges();

    expect(el.querySelector('.ib__count')?.textContent?.trim()).toBe('3');
    expect(el.querySelectorAll('.ib__item').length).toBe(3);
  });

  it('un tramo vacío se dice, no se esconde', () => {
    // «No hay nada» también es una respuesta; esconderla obliga a comprobarlo por otro camino.
    host.sections.set([
      { labelKey: 'A', items: [item('1')] },
      { labelKey: 'B', items: [] },
    ]);
    fixture.detectChanges();

    expect(el.querySelectorAll('.ib__section').length).toBe(2);
    expect(el.textContent).toContain('SHELL.INBOX_SECTION_CLEAR');
  });

  it('la bandeja vacía se celebra en vez de parecer una avería', () => {
    host.sections.set([{ labelKey: 'A', items: [] }]);
    fixture.detectChanges();

    expect(el.querySelector('.ib__state--clear')?.textContent).toContain('SHELL.INBOX_ALL_CLEAR');
    expect(el.querySelector('.ib__count')).toBeNull();
  });

  it('lo vencido se marca sin depender del color', () => {
    host.sections.set([{ labelKey: 'A', items: [item('1', true)] }]);
    fixture.detectChanges();

    const row = el.querySelector('.ib__item--overdue');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('SHELL.INBOX_OVERDUE');
  });

  it('la acción que resuelve el elemento viaja con él', () => {
    host.sections.set([{ labelKey: 'A', items: [item('req-9')] }]);
    fixture.detectChanges();

    (el.querySelector('.ib__item-actions .approve') as HTMLButtonElement).click();

    expect(host.decided).toBe('req-9');
  });

  it('un error no se confunde con una bandeja vacía', () => {
    // La afirmación más cara que esta pantalla puede hacer es «no tienes nada pendiente».
    host.error.set('MY_WORK.LOAD_FAILED');
    fixture.detectChanges();

    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.querySelector('.ib__state--clear')).toBeNull();

    (el.querySelector('.ib__retry') as HTMLButtonElement).click();
    expect(host.reloads).toBe(1);
  });

  it('mientras carga tampoco dice que no hay nada', () => {
    host.loading.set(true);
    fixture.detectChanges();

    expect(el.querySelector('.ib__skeleton')?.getAttribute('aria-busy')).toBe('true');
    expect(el.querySelector('.ib__state--clear')).toBeNull();
  });
});
