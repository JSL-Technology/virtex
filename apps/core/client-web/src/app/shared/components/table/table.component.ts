import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  ViewEncapsulation,
  afterNextRender,
  booleanAttribute,
  effect,
  inject,
  input,
  isDevMode,
  signal,
  viewChild,
} from '@angular/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { applyRoles, hasOwnName, labelCells, stickHeaderRows } from './table-dom';

let nextId = 0;

/** The class that turns a list's rows into «label: value» cards. Set here, by measuring. */
const STACKED = 'vx-table--stacked';
/** Below this width (in rem) a list that does not fit as a table stacks its rows. */
const STACK_BELOW_REM = 40;

/** How rows are read: one record per row, or a grid of figures to compare along both axes. */
export type VxTableLayout = 'list' | 'grid';
/** `box`: a bordered region on the page canvas. `none`: inside a section that already frames it. */
export type VxTableFrame = 'box' | 'none';
/** `auto` follows the person's density preference; the others fix it for this table. */
export type VxTableDensity = 'auto' | 'compact' | 'comfortable';

/**
 * The one table of the product: `<vx-table>` around a native, semantic `<table>`.
 *
 * ```html
 * <vx-table labelKey="invoices.list.title">
 *   <table [appSort]="table.sort" [appTableMenu]="menu">
 *     <thead><tr><th appSortHeader="number">…</th><th class="numeric">…</th><th class="actions-column"></th></tr></thead>
 *     <tbody>@for (row of table.rows(); track row.id) { <tr appRowLink [appRowMenu]="row">…</tr> }</tbody>
 *   </table>
 * </vx-table>
 * ```
 *
 * ## Why a wrapper around the native table, and not a table built from column definitions
 *
 * The rows stay where the page writes them — `@for`, its own cells, its links, its `appRowMenu` and
 * `appSort` — so a table keeps its semantics for screen readers, keeps every directive the product
 * already gives tables, and moves to this component without being rewritten. What the component
 * owns is what used to differ from page to page with nobody having decided it: the frame (a card
 * with a shadow on lists, nothing in Settings, a third look in reports), the header, the padding,
 * how amounts align, how a row reads on a phone, how the region scrolls and how it is reached with
 * the keyboard. One stylesheet, here, instead of five mixins and a hundred page rules.
 *
 * ## What it does to the table
 *
 * - Frames it: a 1px border on the canvas (`frame="box"`), or nothing inside a section that is
 *   already delimited (`frame="none"`). Never a shadow: nothing here floats (constitution, §7).
 * - Scrolls it inside its own region. In a column that gives it a height — a list in
 *   `vx-list-shell` — the header stays in view while the rows scroll; `maxHeight` does the same
 *   anywhere else. When the region scrolls it becomes a named, focusable region, so a keyboard can
 *   scroll it (WCAG 2.1.1).
 * - On a narrow container, a `list` stacks each row as «label: value» pairs; a `grid` (a report, a
 *   matrix, editable lines) keeps its columns and scrolls sideways, optionally with its first
 *   column fixed.
 * - Labels each cell from its header and gives every part its ARIA role (see `table-dom.ts`).
 * - Follows the person's density preference; a table may fix its own.
 *
 * ## The column vocabulary
 *
 * Cells say what they hold with a class, on the header and on the cells: `numeric` (amounts,
 * quantities: right-aligned, tabular figures), `actions-column` (the row's actions, at the end),
 * `select-column` (written by `vxSelect`/`vxSelectAll`), `text-center` (a short mark), `nowrap`,
 * and `title-column` (what identifies the row, when it is not the first column: it titles the
 * stacked card).
 */
@Component({
  selector: 'vx-table',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The table is the PAGE's markup, projected here: an encapsulated stylesheet could not reach it.
  // Every selector is anchored on `.vx-table` and its own scroll region, so nothing leaks out.
  encapsulation: ViewEncapsulation.None,
  styleUrl: './table.component.scss',
  host: {
    class: 'vx-table',
    '[class.vx-table--list]': "layout() === 'list'",
    '[class.vx-table--grid]': "layout() === 'grid'",
    '[class.vx-table--framed]': "frame() === 'box'",
    '[class.vx-table--sticky-column]': 'stickyColumn()',
    '[class.vx-table--compact]': "density() === 'compact'",
    '[class.vx-table--comfortable]': "density() === 'comfortable'",
    '[class.vx-table--bounded]': '!!maxHeight()',
    '[class.vx-table--busy]': 'busy()',
    '[class.vx-table--empty]': 'empty()',
    '[attr.aria-busy]': "busy() ? 'true' : null",
  },
  template: `
    <!-- El nombre de la tabla, una sola vez: lo leen la tabla y su región desplazable. -->
    <span class="vx-table__name" [id]="nameId" hidden>{{ label() ?? ((labelKey() ?? 'shell.table.unnamed') | translate) }}</span>
    <ng-content select="vx-bulk-bar" />
    <div
      #scroll
      class="vx-table__scroll"
      [style.max-height]="maxHeight()"
      [attr.role]="scrollable() ? 'region' : null"
      [attr.tabindex]="scrollable() ? 0 : null"
      [attr.aria-labelledby]="scrollable() ? nameId : null"
    >
      <ng-content />
    </div>
    @if (empty()) {
      <div class="vx-table__empty" role="status">
        <ng-content select="[vxTableEmpty]">{{ emptyKey() | translate }}</ng-content>
      </div>
    }
    <ng-content select="[vxTableFooter]" />
  `,
})
export class VxTableComponent {
  /**
   * The table's name, as an i18n key — the product's convention for any input that names something
   * (`titleKey`, `emptyKey`), and what the hard-coded-text scan recognises. It names the table for
   * screen readers unless the table has a caption or label of its own, and it names the scroll
   * region when there is one.
   */
  readonly labelKey = input<string | null>(null);
  /** The name as text already in the reader's language, for one built at runtime (a state, a chart). */
  readonly label = input<string | null>(null);
  readonly layout = input<VxTableLayout>('list');
  readonly frame = input<VxTableFrame>('box');
  /** In a `grid`, the first column stays in view while the others scroll sideways. */
  readonly stickyColumn = input(false, { transform: booleanAttribute });
  /** A height past which the rows scroll inside the table, under a header that stays in view. */
  readonly maxHeight = input<string | null>(null);
  readonly density = input<VxTableDensity>('auto');
  /** The rows shown are being refreshed: they stay, dimmed, and assistive technology is told. */
  readonly busy = input(false, { transform: booleanAttribute });
  /** No rows: the header stays for context and `[vxTableEmpty]` (or `emptyKey`) says so below it. */
  readonly empty = input(false, { transform: booleanAttribute });
  readonly emptyKey = input('shell.table.empty');

  protected readonly nameId = `vx-table-name-${++nextId}`;
  protected readonly scrollable = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scroll = viewChild.required<ElementRef<HTMLElement>>('scroll');
  private frame$ = 0;
  private warned = false;

  constructor() {
    afterNextRender(() => this.zone.runOutsideAngular(() => this.attach()));
    // What changes the table's name, its layout or its size is measured again: the label (a list
    // renamed by its filter), the layout, the height limit and the empty state. The observers see
    // the rows and the box; these are inputs, and an input changes nothing they can see at once.
    effect(() => {
      this.label();
      this.labelKey();
      this.layout();
      this.maxHeight();
      this.empty();
      this.schedule();
    });
  }

  /** The projected table, if there is one yet (it may sit inside an `@if`). */
  private table(): HTMLTableElement | null {
    const scroll = this.scroll()?.nativeElement;
    return (scroll?.querySelector(':scope > table') as HTMLTableElement | null) ?? null;
  }

  private attach(): void {
    const scroll = this.scroll().nativeElement;
    this.decorate();
    const mutations = new MutationObserver(() => this.schedule());
    mutations.observe(scroll, { childList: true, subtree: true, characterData: true });
    // The width the table HAS decides, not the window's: a list in a side panel stacks on a desktop.
    // Laid out here, in the observer, so the browser paints the right layout the first time; the
    // rest (labels, the scroll region) can wait for the next frame.
    const sizes =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            this.updateLayout();
            this.schedule();
          });
    sizes?.observe(this.host.nativeElement);
    sizes?.observe(scroll);
    this.destroyRef.onDestroy(() => {
      mutations.disconnect();
      sizes?.disconnect();
      if (this.frame$) cancelAnimationFrame(this.frame$);
    });
  }

  /** Coalesces a burst of changes — a hundred rows rendered at once — into one pass. */
  private schedule(): void {
    if (typeof requestAnimationFrame === 'undefined') {
      this.decorate();
      return;
    }
    if (this.frame$) return;
    this.frame$ = requestAnimationFrame(() => {
      this.frame$ = 0;
      this.decorate();
    });
  }

  private decorate(): void {
    const table = this.table();
    if (!table) {
      if (isDevMode() && !this.warned && !this.empty()) {
        this.warned = true;
        console.warn('vx-table: no <table> directly inside. Write the <table> as the direct child of <vx-table>.');
      }
      this.scrollable.set(false);
      return;
    }
    if (this.layout() === 'list') {
      applyRoles(table);
      labelCells(table);
    }
    stickHeaderRows(table);
    // The table's own caption or label wins; otherwise it takes the one given here.
    if (hasOwnName(table, this.nameId)) {
      if (table.getAttribute('aria-labelledby') === this.nameId) table.removeAttribute('aria-labelledby');
    } else if (this.label() || this.labelKey()) {
      table.setAttribute('aria-labelledby', this.nameId);
    }
    this.updateLayout();
    const scroll = this.scroll().nativeElement;
    this.scrollable.set(scroll.scrollWidth > scroll.clientWidth + 1 || scroll.scrollHeight > scroll.clientHeight + 1);
  }

  /**
   * Stacks a list's rows when — and only when — the table does not fit as a table in a narrow box.
   * Three short columns still read better as a table on a phone; eight do not. The table is
   * measured as a table (without the stacked rules) in the same frame, so nothing flickers.
   */
  protected updateLayout(): void {
    const host = this.host.nativeElement;
    const table = this.table();
    const width = host.clientWidth;
    let stack = false;
    if (table && this.layout() === 'list' && width > 0 && width < this.stackBelow()) {
      host.classList.remove(STACKED);
      stack = table.offsetWidth > this.scroll().nativeElement.clientWidth + 1;
    }
    host.classList.toggle(STACKED, stack);
  }

  private stackBelow(): number {
    const root = typeof getComputedStyle === 'undefined' ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize);
    return STACK_BELOW_REM * (root || 16);
  }
}
