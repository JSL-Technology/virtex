import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ListSelectionService } from '../context-menu/list-selection.service';
import { VX_TABLE } from './index';

interface Row {
  id: string;
  name: string;
}

@Component({
  standalone: true,
  imports: [...VX_TABLE],
  providers: [ListSelectionService],
  template: `
    <vx-table label="Productos">
      <vx-bulk-bar><button type="button" class="archive">Archivar</button></vx-bulk-bar>
      <table>
        <thead><tr><th vxSelectAll></th><th>Producto</th></tr></thead>
        <tbody>
          @for (row of rows; track row.id) {
            <tr (click)="opened.push(row.id)"><td [vxSelect]="row.id" [vxSelectLabel]="row.name"></td><td>{{ row.name }}</td></tr>
          }
        </tbody>
      </table>
    </vx-table>
  `,
})
class HostComponent {
  readonly selection = inject<ListSelectionService<Row>>(ListSelectionService);
  readonly opened: string[] = [];
  rows: Row[] = [
    { id: 'a', name: 'Resma' },
    { id: 'b', name: 'Monitor' },
    { id: 'c', name: 'Teclado' },
  ];
  constructor() {
    this.selection.setItems(this.rows, (row) => row.id);
  }
}

describe('table selection', () => {
  function render() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const boxes = () => Array.from(root.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]'));
    const all = () => root.querySelector<HTMLInputElement>('thead input[type="checkbox"]')!;
    const click = (box: HTMLInputElement, shiftKey = false) => {
      box.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey }));
      fixture.detectChanges();
    };
    return { fixture, root, host: fixture.componentInstance, boxes, all, click };
  }

  it('names each box after its row, and the header box after what it does', () => {
    const { boxes, all } = render();
    expect(boxes()[0].getAttribute('aria-label')).toBe('actions.select_named');
    expect(all().getAttribute('aria-label')).toBe('actions.select_all');
  });

  it('selects a row without opening it', () => {
    const { host, boxes, click } = render();
    click(boxes()[1]);
    expect(host.selection.isSelected('b')).toBe(true);
    expect(host.opened).toEqual([]);
  });

  it('selects a range with Shift+click, and the clicked box shows it', () => {
    const { host, boxes, click } = render();
    click(boxes()[0]);
    click(boxes()[2], true);
    expect(host.selection.count()).toBe(3);
    expect(boxes().every((box) => box.checked)).toBe(true);
  });

  it('marks the header box as mixed while only some rows are selected', () => {
    const { boxes, all, click } = render();
    click(boxes()[0]);
    expect(all().indeterminate).toBe(true);
    expect(all().checked).toBe(false);
    click(all());
    expect(all().checked).toBe(true);
    expect(all().indeterminate).toBe(false);
    expect(boxes().every((box) => box.checked)).toBe(true);
  });

  it('stops counting the header box as checked when a new row arrives unselected', () => {
    const { fixture, host, all, click } = render();
    click(all());
    expect(all().checked).toBe(true);
    host.rows = [...host.rows, { id: 'd', name: 'Ratón' }];
    host.selection.setItems(host.rows, (row) => row.id);
    fixture.detectChanges();
    expect(all().checked).toBe(false);
    expect(all().indeterminate).toBe(true);
  });

  it('shows what a selection can do only while there is one, and clears it', () => {
    const { root, fixture, boxes, click, host } = render();
    expect(root.querySelector('.vx-bulk-bar')).toBeNull();
    click(boxes()[0]);
    click(boxes()[1]);
    const bar = root.querySelector('.vx-bulk-bar')!;
    expect(bar).not.toBeNull();
    expect(bar.querySelector('.archive')).not.toBeNull();
    expect(root.querySelector('vx-bulk-bar [role="status"]')?.textContent).toContain('shell.table.selected.other');

    (Array.from(bar.querySelectorAll('button')).find((b) => b.textContent?.includes('actions.clear_selection')) as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.selection.count()).toBe(0);
    expect(root.querySelector('.vx-bulk-bar')).toBeNull();
  });
});
