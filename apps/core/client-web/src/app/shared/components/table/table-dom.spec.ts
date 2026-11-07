import { AUTO_LABEL, applyRoles, cellGrid, columnLabels, hasOwnName, headerText, labelCells } from './table-dom';

function table(html: string): HTMLTableElement {
  const host = document.createElement('div');
  host.innerHTML = `<table>${html}</table>`;
  return host.querySelector('table')!;
}

describe('vx-table DOM helpers', () => {
  it('reads a header by its words, or by its aria-label when it names an icon', () => {
    const t = table(`<thead><tr><th>  Fecha de\n emisión </th><th aria-label="Adjuntos"><svg></svg></th></tr></thead>`);
    const [date, clip] = Array.from(t.tHead!.rows[0].cells);
    expect(headerText(date)).toBe('Fecha de emisión');
    expect(headerText(clip)).toBe('Adjuntos');
  });

  it('lays cells on a grid whatever the spans before them', () => {
    const t = table(`<tbody>
      <tr><td rowspan="2">A</td><td colspan="2">B</td></tr>
      <tr><td>C</td><td>D</td></tr>
    </tbody>`);
    const grid = cellGrid(t.tBodies[0].rows);
    expect(grid.map((line) => line.map((cell) => cell.textContent))).toEqual([
      ['A', 'B', 'B'],
      ['A', 'C', 'D'],
    ]);
  });

  it('labels each column with the most specific header over it', () => {
    const t = table(`<thead>
      <tr><th rowspan="2">Cuenta</th><th colspan="2">Movimientos</th><th rowspan="2" class="actions-column">Acciones</th></tr>
      <tr><th>Debe</th><th>Haber</th></tr>
    </thead>`);
    expect(columnLabels(t)).toEqual(['Cuenta', 'Debe', 'Haber', '']);
  });

  it('writes each cell its column label, and none on spanning, action and selection cells', () => {
    const t = table(`<thead><tr><th class="select-column"></th><th>Producto</th><th class="numeric">Precio</th><th class="actions-column">Acciones</th></tr></thead>
      <tbody>
        <tr><td class="select-column"><input type="checkbox"></td><td>Resma</td><td class="numeric">285</td><td class="actions-column"><button>…</button></td></tr>
        <tr><td colspan="4">Sin existencias</td></tr>
      </tbody>
      <tfoot><tr><td colspan="2">Total</td><td class="numeric">285</td><td></td></tr></tfoot>`);
    labelCells(t);
    const [row, message] = Array.from(t.tBodies[0].rows);
    expect(Array.from(row.cells).map((cell) => cell.getAttribute('data-label'))).toEqual([null, 'Producto', 'Precio', null]);
    expect(message.cells[0].hasAttribute('data-label')).toBe(false);
    const foot = Array.from(t.tFoot!.rows[0].cells).map((cell) => cell.getAttribute('data-label'));
    // Under the actions column, a footer cell has nothing to label either.
    expect(foot).toEqual([null, 'Precio', null]);
  });

  it('keeps a label the page wrote, and follows a header that changes', () => {
    const t = table(`<thead><tr><th>Cliente</th><th>Estado</th></tr></thead>
      <tbody><tr><td data-label="Razón social">Acme</td><td>Pagada</td></tr></tbody>`);
    labelCells(t);
    const [own, auto] = Array.from(t.tBodies[0].rows[0].cells);
    expect(own.getAttribute('data-label')).toBe('Razón social');
    expect(own.hasAttribute(AUTO_LABEL)).toBe(false);
    expect(auto.getAttribute('data-label')).toBe('Estado');

    t.tHead!.rows[0].cells[1].textContent = 'Status';
    labelCells(t);
    expect(auto.getAttribute('data-label')).toBe('Status');
  });

  it('gives the table and its parts their roles, keeping one the page chose', () => {
    const t = table(`<thead><tr><th>Cuenta</th><th>Saldo</th></tr></thead>
      <tbody><tr><th scope="row">1101</th><td>10</td></tr><tr role="presentation"><td>x</td><td>y</td></tr></tbody>
      <tfoot><tr><td>Total</td><td>10</td></tr></tfoot>`);
    applyRoles(t);
    expect(t.getAttribute('role')).toBe('table');
    expect(t.tHead!.getAttribute('role')).toBe('rowgroup');
    expect(t.tHead!.rows[0].cells[0].getAttribute('role')).toBe('columnheader');
    const [first, layout] = Array.from(t.tBodies[0].rows);
    expect(first.getAttribute('role')).toBe('row');
    expect(first.cells[0].getAttribute('role')).toBe('rowheader');
    expect(first.cells[1].getAttribute('role')).toBe('cell');
    expect(layout.getAttribute('role')).toBe('presentation');
    expect(t.tFoot!.rows[0].cells[1].getAttribute('role')).toBe('cell');
  });

  it('knows when the table already has a name of its own', () => {
    expect(hasOwnName(table('<caption>Facturas</caption>'), 'x')).toBe(true);
    const labelled = table('');
    labelled.setAttribute('aria-labelledby', 'title');
    expect(hasOwnName(labelled, 'x')).toBe(true);
    labelled.setAttribute('aria-labelledby', 'x');
    expect(hasOwnName(labelled, 'x')).toBe(false);
    expect(hasOwnName(table(''), 'x')).toBe(false);
  });
});
