import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ChevronLeft, ChevronRight, LucideAngularModule } from 'lucide-angular';

/** A gap in the page list, so `1 … 7 8 9 … 42` is expressible as data. */
const GAP = '…' as const;
type PageSlot = number | typeof GAP;

/**
 * Moving through a list that does not fit on one screen.
 *
 * ## What this replaces
 *
 * Five implementations in two vocabularies: `.pager` in
 * `features/invoices/list/list.page.html:93`,
 * `features/accounting/journal-entries/journal-entries.page.html:68` and
 * `features/accounting/daily-journal/daily-journal.page.html:65`; `.pagination-*` in
 * `features/settings/user-management/user-management.page.html:122` and
 * `features/accounting/chart-of-accounts/chart-of-accounts.page.html:166`. Only one of the five
 * had page numbers; none let the reader choose how many rows to see, and the sizes were decided
 * by three unrelated constants (`journal-entries.page.ts:76`, `user-management.page.ts:157`,
 * `payroll.service.ts:192`).
 *
 * ## Two shapes, because the servers answer two different questions
 *
 * Some endpoints return a total; others only say whether another page exists. Pretending the
 * second is the first means inventing a page count, so this renders what it actually knows:
 * with `total`, numbered pages and a range; without it, previous/next driven by `hasMore`.
 */
@Component({
  selector: 'vx-pager',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule],
  templateUrl: './pager.component.html',
  styleUrls: ['./pager.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'vx-pager' },
})
export class VxPagerComponent {
  /** One-based, like the page number a person says out loud. */
  readonly page = input.required<number>();
  readonly pageSize = input(50);
  /** How many rows there are in total. Null when the endpoint does not say. */
  readonly total = input<number | null>(null);
  /** Whether another page exists. Only consulted when `total` is null. */
  readonly hasMore = input(false);
  /** The sizes on offer. Empty hides the selector, for a list whose size is not the reader's call. */
  readonly pageSizes = input<readonly number[]>([25, 50, 100]);
  readonly disabled = input(false);

  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();

  protected readonly PreviousIcon = ChevronLeft;
  protected readonly NextIcon = ChevronRight;

  protected readonly pageCount = computed(() => {
    const total = this.total();
    if (total === null) return null;
    return Math.max(1, Math.ceil(total / Math.max(1, this.pageSize())));
  });

  protected readonly canGoBack = computed(() => !this.disabled() && this.page() > 1);

  protected readonly canGoForward = computed(() => {
    if (this.disabled()) return false;
    const count = this.pageCount();
    return count === null ? this.hasMore() : this.page() < count;
  });

  /** The rows on screen, one-based and inclusive: "51–100 de 2.480". */
  protected readonly range = computed(() => {
    const first = (this.page() - 1) * this.pageSize() + 1;
    const total = this.total();
    const last = total === null ? first + this.pageSize() - 1 : Math.min(first + this.pageSize() - 1, total);
    return { first, last: Math.max(first, last) };
  });

  /**
   * The page buttons to draw: first, last, and a window around the current one.
   *
   * Capped on purpose. A tenant with 40.000 journal entries has 800 pages, and a strip of 800
   * buttons is not navigation — it is the same problem the list had, moved into the footer.
   */
  protected readonly slots = computed<PageSlot[]>(() => {
    const count = this.pageCount();
    if (count === null || count <= 1) return [];
    const current = Math.min(Math.max(1, this.page()), count);

    if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);

    const window = new Set<number>([1, count, current]);
    if (current - 1 > 1) window.add(current - 1);
    if (current + 1 < count) window.add(current + 1);
    if (current <= 3) [2, 3, 4].forEach((page) => page < count && window.add(page));
    if (current >= count - 2)
      [count - 3, count - 2, count - 1].forEach((page) => page > 1 && window.add(page));

    const pages = [...window].sort((a, b) => a - b);
    const slots: PageSlot[] = [];
    let previous = 0;
    for (const page of pages) {
      if (previous && page - previous > 1) slots.push(GAP);
      slots.push(page);
      previous = page;
    }
    return slots;
  });

  protected readonly gap = GAP;

  protected isGap(slot: PageSlot): slot is typeof GAP {
    return slot === GAP;
  }

  protected go(page: number): void {
    if (this.disabled() || page === this.page()) return;
    const count = this.pageCount();
    if (page < 1 || (count !== null && page > count)) return;
    this.pageChange.emit(page);
  }

  protected changeSize(event: Event): void {
    const size = Number((event.target as HTMLSelectElement).value);
    if (!Number.isFinite(size) || size <= 0) return;
    //  Cambiar el tamaño vuelve a la primera página. Mantener el número mientras cambia lo que
    //  significa deja al lector en un sitio que no eligió — y con 100 por página, la «página 9»
    //  de antes puede ni existir.
    this.pageSizeChange.emit(size);
  }
}
