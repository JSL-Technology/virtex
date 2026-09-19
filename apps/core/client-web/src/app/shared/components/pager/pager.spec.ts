import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { VxPagerComponent } from './index';

@Component({
  standalone: true,
  imports: [TranslateModule, VxPagerComponent],
  template: `
    <vx-pager
      [page]="page()"
      [pageSize]="pageSize()"
      [total]="total()"
      [hasMore]="hasMore()"
      (pageChange)="page.set($event)"
      (pageSizeChange)="pageSize.set($event)"
    />
  `,
})
class Host {
  readonly page = signal(1);
  readonly pageSize = signal(25);
  readonly total = signal<number | null>(200);
  readonly hasMore = signal(false);
}

describe('VxPagerComponent', () => {
  function build() {
    TestBed.configureTestingModule({ imports: [Host, TranslateModule.forRoot()] });
    //  Con traducciones de verdad, y no con las claves crudas: lo que se comprueba abajo es que
    //  los números LLEGAN a la frase, y con la clave sin resolver esa comprobación no existe.
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('es', {
      'common.pager_range': '{{first}}–{{last}} de {{total}}',
      'common.pager_page': 'Página {{page}}',
      'common.go_to_page': 'Ir a la página {{page}}',
      'common.previous_page': 'Página anterior',
      'common.next_page': 'Página siguiente',
      'common.rows_per_page': 'Filas por página',
      'common.pagination': 'Paginación',
    });
    translate.use('es');
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  function pages(): string[] {
    return Array.from(document.querySelectorAll('.vx-pager__page')).map(
      (node) => node.textContent?.trim() ?? '',
    );
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from(document.querySelectorAll('.vx-pager__button'));
  }

  afterEach(() => TestBed.resetTestingModule());

  it('dibuja todas las páginas cuando son pocas', () => {
    const fixture = build();
    fixture.componentInstance.total.set(75);
    fixture.detectChanges();
    expect(pages()).toEqual(['1', '2', '3']);
  });

  it('numera las páginas cuando el servidor dice cuántas filas hay', () => {
    build();
    //  Ocho páginas ya entran en la ventana recortada: primera, la de alrededor y la última.
    expect(pages()).toEqual(['1', '2', '3', '4', '8']);
  });

  it('no inventa páginas cuando el servidor solo dice «hay más»', () => {
    //  Deducir un total a partir de «hay más» produce una barra que miente sobre el tamaño de la
    //  lista. Tres de las cinco implementaciones que esto sustituye estaban en ese caso.
    const fixture = build();
    fixture.componentInstance.total.set(null);
    fixture.componentInstance.hasMore.set(true);
    fixture.detectChanges();

    expect(pages()).toEqual([]);
    expect(buttons()[1].disabled).toBe(false);
  });

  it('recorta la tira con elipsis en vez de dibujar ochocientos botones', () => {
    const fixture = build();
    fixture.componentInstance.total.set(20_000);
    fixture.componentInstance.page.set(400);
    fixture.detectChanges();

    expect(pages()).toEqual(['1', '399', '400', '401', '800']);
    expect(document.querySelectorAll('.vx-pager__gap').length).toBe(2);
  });

  it('no deja retroceder desde la primera ni avanzar desde la última', () => {
    const fixture = build();
    expect(buttons()[0].disabled).toBe(true);

    fixture.componentInstance.page.set(8);
    fixture.detectChanges();
    expect(buttons()[1].disabled).toBe(true);
  });

  it('dice qué filas hay en pantalla', () => {
    const fixture = build();
    fixture.componentInstance.page.set(3);
    fixture.detectChanges();
    const range = document.querySelector('.vx-pager__range')?.textContent ?? '';
    expect(range).toContain('51');
    expect(range).toContain('75');
  });

  it('marca la página actual para un lector de pantalla', () => {
    const fixture = build();
    fixture.componentInstance.page.set(3);
    fixture.detectChanges();

    const current = document.querySelectorAll('[aria-current="page"]');
    expect(current.length).toBe(1);
    expect(current[0].textContent?.trim()).toBe('3');
  });

  it('deja al lector elegir cuántas filas ve', () => {
    //  Ninguna de las cinco implementaciones lo permitía; el tamaño lo decidían tres constantes
    //  sin relación entre sí.
    const fixture = build();
    const select = document.querySelector('.vx-pager__size select') as HTMLSelectElement;
    select.value = '100';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.componentInstance.pageSize()).toBe(100);
  });
});
