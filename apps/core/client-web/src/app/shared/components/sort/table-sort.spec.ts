import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TableSort, compareCells } from './table-sort';
import { VX_SORT } from './sort.directive';

interface Row {
  name: string;
  total: string | null;
  date: string;
}

const rows: Row[] = [
  { name: 'Zeta', total: '900.00', date: '2026-03-01' },
  { name: 'árbol', total: '1000.00', date: '2026-01-15' },
  { name: 'FAC-10', total: null, date: '2026-02-01' },
  { name: 'FAC-9', total: '50', date: '2026-02-01' },
];

describe('TableSort (QA B-01)', () => {
  it('compares money strings as numbers, not as text', () => {
    expect(compareCells('900.00', '1000.00')).toBeLessThan(0);
  });

  it('puts empty cells last whichever way it sorts', () => {
    const sort = new TableSort<Row>();
    sort.toggle('total');
    expect(sort.apply(rows).map((r) => r.total)).toEqual(['50', '900.00', '1000.00', null]);
    sort.toggle('total');
    expect(sort.apply(rows).map((r) => r.total)).toEqual(['1000.00', '900.00', '50', null]);
  });

  it('orders text by the language, with accents and embedded numbers', () => {
    const sort = new TableSort<Row>();
    sort.toggle('name');
    expect(sort.apply(rows).map((r) => r.name)).toEqual(['árbol', 'FAC-9', 'FAC-10', 'Zeta']);
  });

  it('cycles ascending, descending, then back to the order the list arrived in', () => {
    const sort = new TableSort<Row>();
    sort.toggle('date');
    expect(sort.ariaSort('date')).toBe('ascending');
    sort.toggle('date');
    expect(sort.ariaSort('date')).toBe('descending');
    sort.toggle('date');
    expect(sort.ariaSort('date')).toBe('none');
    expect(sort.apply(rows)).toEqual(rows);
  });

  it('keeps equal values in their original order', () => {
    const sort = new TableSort<Row>();
    sort.toggle('date');
    expect(sort.apply(rows).map((r) => r.name)).toEqual(['árbol', 'FAC-10', 'FAC-9', 'Zeta']);
  });

  it('sorts by what the accessor reads, e.g. a translated label', () => {
    const labels: Record<string, string> = { Zeta: 'a', 'árbol': 'b', 'FAC-10': 'c', 'FAC-9': 'd' };
    const sort = new TableSort<Row, 'label'>({ label: (row) => labels[row.name] });
    sort.toggle('label');
    expect(sort.apply(rows)[0].name).toBe('Zeta');
  });

  it('renders a keyboard-reachable header that announces its order', () => {
    @Component({
      standalone: true,
      imports: [...VX_SORT],
      template: `<table [vxSort]="sort"><thead><tr><th vxSortHeader="name">Nombre</th></tr></thead>
        <tbody>@for (r of sorted(); track r.name) { <tr><td>{{ r.name }}</td></tr> }</tbody></table>`,
    })
    class Host {
      readonly sort = new TableSort<Row>();
      readonly sorted = this.sort.sorted(signal(rows));
    }
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const th: HTMLElement = fixture.nativeElement.querySelector('th');
    expect(th.getAttribute('aria-sort')).toBe('none');
    th.querySelector('button')!.click();
    fixture.detectChanges();
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    const cells = [...fixture.nativeElement.querySelectorAll('td')].map((td: HTMLElement) => td.textContent?.trim());
    expect(cells).toEqual(['árbol', 'FAC-9', 'FAC-10', 'Zeta']);
  });
});
