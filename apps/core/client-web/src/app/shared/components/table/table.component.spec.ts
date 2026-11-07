import { ApplicationRef, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VX_TABLE, VxTableComponent } from './index';

@Component({
  standalone: true,
  imports: [...VX_TABLE],
  template: `
    <vx-table [label]="label()" [layout]="layout()" [frame]="frame()" [busy]="busy()" [empty]="rows().length === 0" [maxHeight]="maxHeight()">
      <table>
        @if (caption()) { <caption>{{ caption() }}</caption> }
        <thead><tr><th>Producto</th><th class="numeric">Precio</th><th class="actions-column"><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>
          @for (row of rows(); track row.name) {
            <tr><td>{{ row.name }}</td><td class="numeric">{{ row.price }}</td><td class="actions-column"><button type="button">Editar</button></td></tr>
          }
        </tbody>
      </table>
    </vx-table>
  `,
})
class HostComponent {
  readonly label = signal<string | null>('Productos');
  readonly layout = signal<'list' | 'grid'>('list');
  readonly frame = signal<'box' | 'none'>('box');
  readonly busy = signal(false);
  readonly caption = signal<string | null>(null);
  readonly maxHeight = signal<string | null>(null);
  readonly rows = signal([
    { name: 'Resma', price: 285 },
    { name: 'Monitor', price: 9850 },
  ]);
}

@Component({
  standalone: true,
  imports: [...VX_TABLE],
  template: `
    <vx-table label="Productos" [empty]="true">
      <table><thead><tr><th>Producto</th></tr></thead><tbody></tbody></table>
      <p vxTableEmpty>Aún no hay productos.</p>
    </vx-table>
  `,
})
class OwnEmptyHostComponent {}

describe('VxTableComponent', () => {
  async function render() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
    await settle();
    const root = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      host: fixture.componentInstance,
      vx: root.querySelector('vx-table') as HTMLElement,
      table: root.querySelector('table') as HTMLTableElement,
      async update() {
        fixture.detectChanges();
        TestBed.inject(ApplicationRef).tick();
        await settle();
        fixture.detectChanges();
      },
    };
  }

  /** Lets the observers and the coalescing frame run. */
  async function settle() {
    await new Promise((resolve) => setTimeout(resolve));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  }

  it('frames a list by default, and says how it reads', async () => {
    const { vx } = await render();
    expect(vx.classList).toContain('vx-table');
    expect(vx.classList).toContain('vx-table--list');
    expect(vx.classList).toContain('vx-table--framed');
  });

  it('draws no frame inside a section that already delimits it, and keeps a grid a grid', async () => {
    const t = await render();
    t.host.frame.set('none');
    t.host.layout.set('grid');
    await t.update();
    expect(t.vx.classList).not.toContain('vx-table--framed');
    expect(t.vx.classList).toContain('vx-table--grid');
  });

  it('labels the cells from the header and gives the parts their roles', async () => {
    const { table } = await render();
    const cells = Array.from(table.tBodies[0].rows[0].cells);
    expect(cells.map((cell) => cell.getAttribute('data-label'))).toEqual(['Producto', 'Precio', null]);
    expect(table.getAttribute('role')).toBe('table');
    expect(cells[0].getAttribute('role')).toBe('cell');
  });

  it('labels a row added later, as the list grows', async () => {
    const t = await render();
    t.host.rows.update((rows) => [...rows, { name: 'Teclado', price: 1650 }]);
    await t.update();
    expect(t.table.tBodies[0].rows[2].cells[0].getAttribute('data-label')).toBe('Producto');
  });

  it('names the table with its label, unless the table has a caption of its own', async () => {
    const t = await render();
    const nameId = t.table.getAttribute('aria-labelledby')!;
    expect(document.getElementById(nameId)?.textContent).toBe('Productos');

    t.host.caption.set('Inventario');
    await t.update();
    expect(t.table.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('is not a tab stop while nothing scrolls', async () => {
    const { vx } = await render();
    const scroll = vx.querySelector('.vx-table__scroll')!;
    expect(scroll.hasAttribute('tabindex')).toBe(false);
    expect(scroll.hasAttribute('role')).toBe(false);
  });

  it('becomes a named, focusable region when its rows scroll', async () => {
    const t = await render();
    const scroll = t.vx.querySelector('.vx-table__scroll') as HTMLElement;
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, get: () => 900 });
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, get: () => 300 });
    t.host.maxHeight.set('300px');
    await t.update();
    expect(scroll.style.maxHeight).toBe('300px');
    expect(scroll.getAttribute('tabindex')).toBe('0');
    expect(scroll.getAttribute('role')).toBe('region');
    expect(document.getElementById(scroll.getAttribute('aria-labelledby')!)?.textContent).toBe('Productos');
  });

  it('says it is refreshing the rows it shows', async () => {
    const t = await render();
    t.host.busy.set(true);
    await t.update();
    expect(t.vx.getAttribute('aria-busy')).toBe('true');
    expect(t.vx.classList).toContain('vx-table--busy');
  });

  it('keeps the header and says there are no rows', async () => {
    const t = await render();
    t.host.rows.set([]);
    await t.update();
    expect(t.vx.querySelector('thead')).not.toBeNull();
    expect(t.vx.querySelector('.vx-table__empty')?.textContent?.trim()).toBe('shell.table.empty');
  });

  it('says it in the page’s own words when the page gives them', async () => {
    TestBed.configureTestingModule({ imports: [OwnEmptyHostComponent] });
    const fixture = TestBed.createComponent(OwnEmptyHostComponent);
    fixture.detectChanges();
    await settle();
    expect((fixture.nativeElement as HTMLElement).querySelector('.vx-table__empty')?.textContent?.trim()).toBe('Aún no hay productos.');
  });

  describe('stacking a list in a narrow box', () => {
    function size(el: HTMLElement, prop: 'clientWidth' | 'offsetWidth', value: number) {
      Object.defineProperty(el, prop, { configurable: true, get: () => value });
    }

    it('stacks the rows when the table does not fit', async () => {
      const t = await render();
      const scroll = t.vx.querySelector('.vx-table__scroll') as HTMLElement;
      size(t.vx, 'clientWidth', 390);
      size(scroll, 'clientWidth', 388);
      size(t.table, 'offsetWidth', 720);
      (t.fixture.debugElement.query((el) => el.componentInstance instanceof VxTableComponent).componentInstance as { updateLayout(): void }).updateLayout();
      expect(t.vx.classList).toContain('vx-table--stacked');
    });

    it('keeps a table that fits as a table, even on a phone', async () => {
      const t = await render();
      const scroll = t.vx.querySelector('.vx-table__scroll') as HTMLElement;
      size(t.vx, 'clientWidth', 390);
      size(scroll, 'clientWidth', 388);
      size(t.table, 'offsetWidth', 388);
      (t.fixture.debugElement.query((el) => el.componentInstance instanceof VxTableComponent).componentInstance as { updateLayout(): void }).updateLayout();
      expect(t.vx.classList).not.toContain('vx-table--stacked');
    });

    it('never stacks a grid, nor a list in a wide box', async () => {
      const t = await render();
      const scroll = t.vx.querySelector('.vx-table__scroll') as HTMLElement;
      const component = t.fixture.debugElement.query((el) => el.componentInstance instanceof VxTableComponent).componentInstance as { updateLayout(): void };
      size(scroll, 'clientWidth', 388);
      size(t.table, 'offsetWidth', 720);
      size(t.vx, 'clientWidth', 1200);
      component.updateLayout();
      expect(t.vx.classList).not.toContain('vx-table--stacked');

      size(t.vx, 'clientWidth', 390);
      t.host.layout.set('grid');
      await t.update();
      component.updateLayout();
      expect(t.vx.classList).not.toContain('vx-table--stacked');
    });
  });
});
