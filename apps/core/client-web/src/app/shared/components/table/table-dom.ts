/**
 * What `vx-table` does to the native `<table>` it wraps, written as plain functions over the DOM so
 * they can be tested without Angular and read in one place.
 *
 * The page keeps writing a semantic table — `<thead>`, `<th>`, `@for` rows — and the component adds
 * only what the page cannot be trusted to remember on every row of every table:
 *
 * - **`data-label` on each cell**, taken from its column's header. On a narrow screen a list stacks
 *   each row as «label: value» pairs, and the label has to come from somewhere. Written by hand it
 *   was missing on most tables and stale after a header was renamed.
 * - **Explicit ARIA roles** (`table`, `rowgroup`, `row`, `columnheader`, `rowheader`, `cell`). A
 *   stacked row is `display: block`, and browsers drop a table's semantics once its parts stop
 *   being table boxes — a screen reader would hear a list of loose words. The roles keep the
 *   relationships whatever the layout.
 * - **Header offsets** for a header of several rows, so each row sticks below the one above it.
 */

/** Marks a `data-label` this component wrote, so it can update it and never overwrite the page's own. */
export const AUTO_LABEL = 'data-vx-label';

/** Columns whose cells carry no label when stacked: their content explains itself. */
const UNLABELLED_COLUMNS = ['actions-column', 'select-column'];

/** The text a header shows: its `aria-label` when it names an icon, else its words. */
export function headerText(cell: Element | null | undefined): string {
  if (!cell) return '';
  const named = cell.getAttribute('aria-label');
  if (named?.trim()) return named.trim();
  return (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The cells of a row group laid out on a grid, so a cell's column is known whatever the colspans
 * and rowspans before it. `grid[r][c]` is the cell covering row `r`, column `c`.
 */
export function cellGrid(rows: ArrayLike<HTMLTableRowElement>): HTMLTableCellElement[][] {
  const grid: HTMLTableCellElement[][] = [];
  Array.from(rows).forEach((row, r) => {
    const line = (grid[r] ??= []);
    let c = 0;
    for (const cell of Array.from(row.cells)) {
      while (line[c]) c++;
      // `rowspan="0"` means «to the end of the group»; one row is the safe reading.
      const rowSpan = Math.max(1, cell.rowSpan || 1);
      const colSpan = Math.max(1, cell.colSpan || 1);
      for (let i = 0; i < rowSpan; i++) {
        const target = (grid[r + i] ??= []);
        for (let j = 0; j < colSpan; j++) target[c + j] = cell;
      }
      c += colSpan;
    }
  });
  return grid;
}

/**
 * The label of every column, read from the header: the lowest header cell over each column, which
 * for a grouped header is the specific one («Debe») rather than the group («Movimientos»).
 */
export function columnLabels(table: HTMLTableElement): string[] {
  const head = table.tHead;
  if (!head || head.rows.length === 0) return [];
  const grid = cellGrid(head.rows);
  const width = Math.max(...grid.map((line) => line.length));
  const labels: string[] = [];
  for (let c = 0; c < width; c++) {
    let cell: HTMLTableCellElement | undefined;
    for (let r = grid.length - 1; r >= 0 && !cell; r--) cell = grid[r][c];
    const unlabelled = cell && UNLABELLED_COLUMNS.some((name) => cell!.classList.contains(name));
    labels.push(unlabelled ? '' : headerText(cell));
  }
  return labels;
}

function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

/**
 * Writes each body and footer cell's `data-label` from its column's header.
 *
 * A label the page wrote itself is kept. A cell spanning several columns gets none — it is a
 * subtotal's caption, an empty-state message or a detail row, not one column's value — and neither
 * do the actions and selection columns.
 */
export function labelCells(table: HTMLTableElement): void {
  const labels = columnLabels(table);
  const groups = [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])];
  for (const group of groups) {
    const grid = cellGrid(group.rows);
    const seen = new Set<HTMLTableCellElement>();
    grid.forEach((line) =>
      line.forEach((cell, c) => {
        if (!cell || seen.has(cell)) return;
        seen.add(cell);
        if (cell.hasAttribute('data-label') && !cell.hasAttribute(AUTO_LABEL)) return;
        const own = UNLABELLED_COLUMNS.some((name) => cell.classList.contains(name));
        const label = !own && (cell.colSpan || 1) === 1 ? labels[c] : '';
        if (label) {
          setAttr(cell, 'data-label', label);
          setAttr(cell, AUTO_LABEL, '');
        } else if (cell.hasAttribute(AUTO_LABEL)) {
          cell.removeAttribute('data-label');
          cell.removeAttribute(AUTO_LABEL);
        }
      }),
    );
  }
}

function setRole(el: Element, role: string): void {
  // A role the page chose on purpose stays (`presentation` on a layout table, for one).
  if (!el.hasAttribute('role')) el.setAttribute('role', role);
}

/** Gives the table and its parts their roles explicitly, so they survive any `display`. */
export function applyRoles(table: HTMLTableElement): void {
  setRole(table, 'table');
  const groups = [table.tHead, ...Array.from(table.tBodies), table.tFoot].filter(
    (group): group is HTMLTableSectionElement => !!group,
  );
  for (const group of groups) {
    setRole(group, 'rowgroup');
    const inHead = group.tagName === 'THEAD';
    for (const row of Array.from(group.rows)) {
      setRole(row, 'row');
      for (const cell of Array.from(row.cells)) {
        setRole(cell, cell.tagName === 'TH' ? (inHead ? 'columnheader' : 'rowheader') : 'cell');
      }
    }
  }
}

/**
 * For a header of several rows, the `top` at which each row sticks: right below the rows above it.
 * One row needs nothing — it sticks at 0 from the stylesheet.
 */
export function stickHeaderRows(table: HTMLTableElement): void {
  const head = table.tHead;
  if (!head || head.rows.length < 2) return;
  let top = 0;
  for (const row of Array.from(head.rows)) {
    const value = top === 0 ? null : `${top}px`;
    for (const cell of Array.from(row.cells)) {
      if ((cell.style.top || null) !== value) cell.style.top = value ?? '';
    }
    top += row.getBoundingClientRect().height;
  }
}

/** Whether the table has a name of its own: a caption, `aria-label` or `aria-labelledby`. */
export function hasOwnName(table: HTMLTableElement, ownLabelId: string): boolean {
  if (table.caption?.textContent?.trim()) return true;
  if (table.getAttribute('aria-label')?.trim()) return true;
  const by = table.getAttribute('aria-labelledby');
  return !!by && by !== ownLabelId;
}
