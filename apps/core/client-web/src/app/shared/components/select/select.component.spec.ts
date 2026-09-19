import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { Observable, Subject, of, throwError, timer } from 'rxjs';
import { map } from 'rxjs/operators';
import { VX_SELECT } from './index';

/**
 * Two unrelated entities, on purpose.
 *
 * The component's whole claim is that it does not know what it is selecting. A suite that only
 * ever selects one shape of thing cannot tell a generic component apart from the customer picker
 * under another name, so a customer (searched on the server, creatable) and a payment term (a
 * fixed list, filtered here) are both driven through the same class.
 */
interface Customer {
  id: string;
  companyName: string;
  taxId: string | null;
}

interface PaymentTerm {
  code: string;
  label: string;
}

const CUSTOMERS: Customer[] = [
  { id: 'c-1', companyName: 'Constructora del Este', taxId: '131-00000-1' },
  { id: 'c-2', companyName: 'Colmado La Esquina', taxId: null },
  { id: 'c-3', companyName: 'Ferretería Jiménez', taxId: '130-99999-9' },
];

const TERMS: PaymentTerm[] = [
  { code: 'CASH', label: 'Contado' },
  { code: 'NET15', label: 'Neto 15' },
  { code: 'NET30', label: 'Neto 30' },
];

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, ...VX_SELECT],
  template: `
    <label for="customer">Cliente</label>
    <vx-select
      inputId="customer"
      [formControl]="control"
      [search]="search"
      [resolveWith]="resolve"
      [displayWith]="name"
      [valueWith]="id"
      [describeWith]="taxId"
      [createWith]="create"
      [debounceMs]="200"
    ></vx-select>
  `,
})
class ServerHost {
  readonly control = new FormControl<string | null>('');
  readonly searches = signal<string[]>([]);
  /** Swapped per test: what the "server" answers, and how slowly. */
  respond: (query: string) => Observable<readonly Customer[]> = (query) =>
    of(CUSTOMERS.filter((c) => c.companyName.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  /** Swapped per test: what the creation dialog eventually answers. */
  creation = new Subject<Customer | null>();
  createCalls: string[] = [];

  readonly search = (query: string): Observable<readonly Customer[]> => {
    this.searches.update((all) => [...all, query]);
    return this.respond(query);
  };
  readonly resolve = (value: string): Observable<Customer | null> =>
    of(CUSTOMERS.find((c) => c.id === value) ?? null);
  readonly create = (query: string): Observable<Customer | null> => {
    this.createCalls.push(query);
    return this.creation.asObservable();
  };
  readonly name = (customer: Customer): string => customer.companyName;
  readonly id = (customer: Customer): string => customer.id;
  readonly taxId = (customer: Customer): string | null => customer.taxId;
}

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, ...VX_SELECT],
  template: `
    <vx-select
      [formControl]="control"
      [options]="terms"
      [displayWith]="label"
      [valueWith]="code"
      ariaLabel="Condiciones"
    ></vx-select>
  `,
})
class ClientHost {
  readonly control = new FormControl<string | null>('');
  readonly terms = TERMS;
  readonly label = (term: PaymentTerm): string => term.label;
  readonly code = (term: PaymentTerm): string => term.code;
}

describe('VxSelectComponent', () => {
  /** The combobox — which is also the search box; see the component's class comment. */
  function inputOf(fixture: ComponentFixture<unknown>): HTMLInputElement {
    return fixture.nativeElement.querySelector('input[role="combobox"]') as HTMLInputElement;
  }

  /** The panel lives in the CDK overlay container, not under the host element. */
  function panel(): HTMLElement | null {
    return document.querySelector('.vx-select__panel');
  }

  function rows(): HTMLElement[] {
    return Array.from(document.querySelectorAll('.vx-select__option'));
  }

  function labels(): (string | undefined)[] {
    return rows().map((row) => row.querySelector('.vx-select__label')?.textContent?.trim());
  }

  /**
   * Let the panel finish arriving.
   *
   * `cdk-virtual-scroll-viewport` measures itself in a microtask after its view initialises, and
   * only then asks the strategy which rows to render — so one `detectChanges()` sees an empty
   * viewport. This is that wait, not a sleep papering over a race: in a browser the same turns all
   * happen inside one frame.
   */
  function settle(fixture: ComponentFixture<unknown>, ms = 250): void {
    tick(ms);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
  }

  function type(fixture: ComponentFixture<unknown>, text: string): void {
    const input = inputOf(fixture);
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function press(fixture: ComponentFixture<unknown>, key: string, init: KeyboardEventInit = {}): void {
    inputOf(fixture).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
    fixture.detectChanges();
  }

  function clickInput(fixture: ComponentFixture<unknown>): void {
    inputOf(fixture).dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();
  }

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
  });

  // ── Modo servidor ──────────────────────────────────────────────────────────
  describe('con búsqueda en el servidor', () => {
    beforeEach(async () => {
      await TestBed.resetTestingModule()
        .configureTestingModule({ imports: [ServerHost, TranslateModule.forRoot()] })
        .compileComponents();
    });

    /**
     * Built inside the test, not in `beforeEach`.
     *
     * The debounce timer is scheduled in whatever zone the component was created in. Creating it
     * outside `fakeAsync` leaves that timer real, and `tick()` then advances a clock nothing is
     * waiting on — the field looks broken and is not.
     */
    function build(): ComponentFixture<ServerHost> {
      const fixture = TestBed.createComponent(ServerHost);
      fixture.detectChanges();
      return fixture;
    }

    it('no pregunta por un control que nace vacío', fakeAsync(() => {
      //  `['']` es como se declara cualquier campo opcional del producto, y el accessor recibe
      //  `writeValue('')` al construirse el formulario. Leerlo como valor manda un id vacío al
      //  servidor una vez por campo y por carga de página.
      const fixture = build();
      settle(fixture);
      expect(fixture.componentInstance.searches()).toEqual([]);
      flush();
    }));

    it('pide la primera página al abrirse, sin haber tecleado nada', fakeAsync(() => {
      const fixture = build();
      clickInput(fixture);
      settle(fixture);

      expect(fixture.componentInstance.searches()).toEqual(['']);
      //  En el orden en que el servidor los mandó: ordenar aquí sería una segunda opinión sobre
      //  algo que la consulta ya decidió, y las dos acabarían discrepando.
      expect(labels()).toEqual([
        'Constructora del Este',
        'Colmado La Esquina',
        'Ferretería Jiménez',
      ]);
      flush();
    }));

    it('espera a que se deje de teclear antes de preguntar', fakeAsync(() => {
      const fixture = build();
      clickInput(fixture);
      settle(fixture);

      type(fixture, 'f');
      tick(50);
      type(fixture, 'fe');
      tick(50);
      type(fixture, 'fer');
      settle(fixture);

      //  Una consulta por la apertura y UNA por las tres pulsaciones, no tres.
      expect(fixture.componentInstance.searches()).toEqual(['', 'fer']);
      flush();
    }));

    it('descarta la respuesta a una pregunta ya superada', fakeAsync(() => {
      const fixture = build();
      //  La primera consulta tarda 500 ms y la segunda 10. Sin `switchMap`, la lenta llega después
      //  y pinta los resultados de «fe» encima de los de «ferre».
      fixture.componentInstance.respond = (query) =>
        timer(query === 'fe' ? 500 : 10).pipe(
          map(() =>
            CUSTOMERS.filter((c) => c.companyName.toLocaleLowerCase().includes(query)),
          ),
        );

      clickInput(fixture);
      settle(fixture);

      type(fixture, 'fe');
      tick(250);
      type(fixture, 'ferre');
      settle(fixture, 1000);

      expect(labels()).toEqual(['Ferretería Jiménez']);
      flush();
    }));

    it('elige con el teclado y escribe el valor en el control', fakeAsync(() => {
      const fixture = build();
      //  La primera flecha abre y no mueve: si moviera, la fila que el usuario acaba de ver
      //  resaltarse no sería la primera de la lista sino la segunda.
      press(fixture, 'ArrowDown');
      settle(fixture);
      expect(rows()[0].classList).toContain('is-active');

      press(fixture, 'ArrowDown');
      press(fixture, 'Enter');

      expect(fixture.componentInstance.control.value).toBe('c-2');
      expect(inputOf(fixture).value).toBe('Colmado La Esquina');
      expect(panel()).toBeNull();
      flush();
    }));

    it('cierra con Escape sin cambiar nada', fakeAsync(() => {
      const fixture = build();
      fixture.componentInstance.control.setValue('c-1');
      fixture.detectChanges();

      press(fixture, 'ArrowDown');
      settle(fixture);
      type(fixture, 'colmado');
      settle(fixture);

      press(fixture, 'Escape');

      expect(fixture.componentInstance.control.value).toBe('c-1');
      //  Lo tecleado era una búsqueda, no un valor: al cerrar, el campo vuelve a decir lo que tiene.
      expect(inputOf(fixture).value).toBe('Constructora del Este');
      expect(panel()).toBeNull();
      flush();
    }));

    it('nombra el registro cuando el formulario llega con un id y nadie eligió nada', fakeAsync(() => {
      //  Es lo que hace «copiar de factura»: el id se escribe en el control sin pasar por la lista.
      const fixture = build();
      fixture.componentInstance.control.setValue('c-3');
      fixture.detectChanges();

      expect(inputOf(fixture).value).toBe('Ferretería Jiménez');
      flush();
    }));

    it('ofrece reintentar cuando la búsqueda falla, y no se queda muda para siempre', fakeAsync(() => {
      const fixture = build();
      fixture.componentInstance.respond = () => throwError(() => new Error('502'));

      clickInput(fixture);
      settle(fixture);

      const retry = document.querySelector('.vx-select__retry') as HTMLButtonElement;
      expect(retry).not.toBeNull();

      //  El fallo no puede haber terminado el flujo: si lo hubiera hecho, este segundo intento no
      //  produciría consulta alguna y el campo quedaría roto hasta recargar la página.
      fixture.componentInstance.respond = () => of(CUSTOMERS);
      retry.click();
      settle(fixture);

      expect(rows().length).toBe(CUSTOMERS.length);
      flush();
    }));

    it('crea sin sacar al usuario del formulario, y le devuelve el foco', fakeAsync(() => {
      const fixture = build();
      inputOf(fixture).focus();
      press(fixture, 'ArrowDown');
      settle(fixture);

      type(fixture, 'Bloques del Sur');
      settle(fixture);

      //  Sin resultados, crear es lo único que el panel puede ofrecer — y es donde hace más falta.
      expect(rows()).toEqual([]);
      const create = document.querySelector('.vx-select__create') as HTMLElement;
      expect(create).not.toBeNull();

      create.dispatchEvent(new MouseEvent('click'));
      fixture.detectChanges();

      //  Lo ya tecleado viaja al diálogo: nadie debería escribir el nombre dos veces.
      expect(fixture.componentInstance.createCalls).toEqual(['Bloques del Sur']);
      expect(panel()).toBeNull();

      fixture.componentInstance.creation.next({
        id: 'c-9',
        companyName: 'Bloques del Sur',
        taxId: null,
      });
      fixture.detectChanges();

      expect(fixture.componentInstance.control.value).toBe('c-9');
      expect(inputOf(fixture).value).toBe('Bloques del Sur');
      expect(document.activeElement).toBe(inputOf(fixture));
      flush();
    }));

    it('deja el campo como estaba si se cancela la creación', fakeAsync(() => {
      const fixture = build();
      fixture.componentInstance.control.setValue('c-1');
      fixture.detectChanges();
      inputOf(fixture).focus();

      press(fixture, 'ArrowDown');
      settle(fixture);
      type(fixture, 'nadie');
      settle(fixture);

      (document.querySelector('.vx-select__create') as HTMLElement).dispatchEvent(
        new MouseEvent('click'),
      );
      fixture.detectChanges();
      fixture.componentInstance.creation.next(null);
      fixture.detectChanges();

      expect(fixture.componentInstance.control.value).toBe('c-1');
      expect(document.activeElement).toBe(inputOf(fixture));
      flush();
    }));

    it('declara el combobox como manda ARIA', fakeAsync(() => {
      const fixture = build();
      const input = inputOf(fixture);
      expect(input.getAttribute('aria-expanded')).toBe('false');
      expect(input.getAttribute('aria-autocomplete')).toBe('list');
      expect(input.id).toBe('customer');

      press(fixture, 'ArrowDown');
      settle(fixture);

      expect(input.getAttribute('aria-expanded')).toBe('true');
      const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
      expect(input.getAttribute('aria-controls')).toBe(listbox.id);
      //  La fila activa tiene que EXISTIR en el DOM: un id que no existe no lo lee nadie.
      const active = input.getAttribute('aria-activedescendant');
      expect(active).toBeTruthy();
      expect(document.getElementById(active as string)).not.toBeNull();
      flush();
    }));

    it('se deshabilita con el control', fakeAsync(() => {
      const fixture = build();
      fixture.componentInstance.control.disable();
      fixture.detectChanges();
      expect(inputOf(fixture).disabled).toBe(true);

      clickInput(fixture);
      settle(fixture);
      expect(panel()).toBeNull();
      flush();
    }));
  });

  // ── Modo cliente ───────────────────────────────────────────────────────────
  describe('con una lista pequeña en el cliente', () => {
    beforeEach(async () => {
      await TestBed.resetTestingModule()
        .configureTestingModule({ imports: [ClientHost, TranslateModule.forRoot()] })
        .compileComponents();
    });

    function build(): ComponentFixture<ClientHost> {
      const fixture = TestBed.createComponent(ClientHost);
      fixture.detectChanges();
      return fixture;
    }

    it('filtra sin preguntarle a nadie', fakeAsync(() => {
      const fixture = build();
      clickInput(fixture);
      settle(fixture);
      expect(rows().length).toBe(TERMS.length);

      type(fixture, 'neto');
      settle(fixture);
      expect(labels()).toEqual(['Neto 15', 'Neto 30']);
      flush();
    }));

    it('ignora los acentos al filtrar', fakeAsync(() => {
      //  En un producto cuyo idioma por defecto es el español, ignorar los acentos no es un
      //  detalle: quien teclea sin ellos obtiene una lista vacía sobre datos que sí están.
      const fixture = build();
      clickInput(fixture);
      settle(fixture);

      type(fixture, 'CONTADO');
      settle(fixture);
      expect(labels()).toEqual(['Contado']);
      flush();
    }));

    it('no ofrece crear cuando el llamante no dijo cómo', fakeAsync(() => {
      const fixture = build();
      clickInput(fixture);
      settle(fixture);
      expect(document.querySelector('.vx-select__create')).toBeNull();
      flush();
    }));

    it('selecciona con el ratón y marca la fila elegida', fakeAsync(() => {
      const fixture = build();
      clickInput(fixture);
      settle(fixture);
      rows()[2].dispatchEvent(new MouseEvent('click'));
      fixture.detectChanges();

      expect(fixture.componentInstance.control.value).toBe('NET30');

      clickInput(fixture);
      settle(fixture);
      expect(
        document.querySelector('[aria-selected="true"] .vx-select__label')?.textContent?.trim(),
      ).toBe('Neto 30');
      flush();
    }));

    it('se vacía con el botón de quitar', fakeAsync(() => {
      const fixture = build();
      fixture.componentInstance.control.setValue('NET15');
      fixture.detectChanges();
      expect(inputOf(fixture).value).toBe('Neto 15');

      const clear = fixture.nativeElement.querySelector('.vx-select__button') as HTMLButtonElement;
      clear.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.control.value).toBeNull();
      expect(inputOf(fixture).value).toBe('');
      flush();
    }));
  });
});
